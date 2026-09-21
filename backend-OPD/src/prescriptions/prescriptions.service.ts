import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { randomBytes } from 'crypto';
import { Op } from 'sequelize';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import { ConsultationSession } from '../database/models/consultation-session.model';
import { EPrescription } from '../database/models/e-prescription.model';
import { EPrescriptionMedicine } from '../database/models/e-prescription-medicine.model';
import { AiTrainingSample } from '../database/models/ai-training-sample.model';
import { PrescriptionPdfService } from './prescription-pdf.service';
import { MedicinesService } from '../medicines/medicines.service';
import { StorageService } from '../uploads/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UpdatePrescriptionDto } from './dto/prescription.dto';
import { ActivityLogService } from '../activity/activity-log.service';
import { ActivityAction } from '../common/enums';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  MedicineSource,
  NotificationType,
  PrescriptionMode,
  PrescriptionStatus,
  TrainingSampleKind,
} from '../common/enums';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { readableDate } from '../common/utils/clinic-time';

/** How long the WhatsApp link serves the PDF. Long enough to be read on the day and found again the week after. */
const SHARE_LINK_DAYS = 7;
/** A link with less than this left is re-minted rather than sent almost expired. */
const SHARE_LINK_RENEW_BELOW_MS = 24 * 60 * 60 * 1000;

/**
 * The doctor's e-prescription: read the draft, edit it, issue it.
 *
 * Issuing is the only step that reaches the patient, and it is deliberately
 * explicit — an AI draft never becomes a real prescription without the doctor
 * pressing the button.
 */
@Injectable()
export class PrescriptionsService {
  private readonly logger = new Logger(PrescriptionsService.name);

  constructor(
    @InjectModel(Appointment) private readonly appointmentModel: typeof Appointment,
    @InjectModel(Doctor) private readonly doctorModel: typeof Doctor,
    @InjectModel(EPrescription)
    private readonly prescriptionModel: typeof EPrescription,
    @InjectModel(EPrescriptionMedicine)
    private readonly medicineModel: typeof EPrescriptionMedicine,
    @InjectModel(ConsultationSession)
    private readonly sessionModel: typeof ConsultationSession,
    @InjectModel(AiTrainingSample)
    private readonly trainingModel: typeof AiTrainingSample,
    private readonly pdf: PrescriptionPdfService,
    private readonly medicines: MedicinesService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityLogService,
    private readonly config: ConfigService,
  ) {}

  /** The appointment's prescription, creating an empty draft on first open. */
  async get(appointmentId: string, user: AuthUser) {
    await this.assertAccess(appointmentId, user);
    const prescription = await this.findOrCreate(appointmentId);
    return this.toView(prescription);
  }

  /** Save the doctor's edits. Rejected once issued. */
  async update(
    appointmentId: string,
    dto: UpdatePrescriptionDto,
    user: AuthUser,
  ) {
    await this.assertAccess(appointmentId, user);
    const prescription = await this.findOrCreate(appointmentId);
    this.assertEditable(prescription);

    await prescription.update({
      // Editing the structured fields makes this a structured prescription.
      mode: PrescriptionMode.STRUCTURED,
      diagnosis: dto.diagnosis?.trim() || null,
      previous_history: dto.previous_history?.trim() || null,
      advice: dto.advice?.trim() || null,
      follow_up_date: dto.follow_up_date || null,
    } as any);

    if (dto.medicines) {
      await this.replaceMedicines(prescription, dto.medicines);
    }

    return this.toView(await this.reload(prescription.id));
  }

  /**
   * Save a handwritten prescription image (drawn on a tablet). The strokes are
   * a transparent PNG; issuing composites them onto the doctor's letterhead.
   */
  async saveHandwriting(
    appointmentId: string,
    file: Express.Multer.File,
    user: AuthUser,
  ) {
    const appointment = await this.assertAccess(appointmentId, user);
    const prescription = await this.findOrCreate(appointmentId);
    this.assertEditable(prescription);
    if (!file) throw new AppException(ErrorCode.FILE_REQUIRED);

    const { key } = await this.storage.uploadImage(
      file,
      `prescriptions/${appointment.doctor_id}/handwriting`,
    );
    // Replace any previous drawing for this visit.
    if (prescription.handwriting_image_key) {
      await this.storage.delete(prescription.handwriting_image_key);
    }
    await prescription.update({
      mode: PrescriptionMode.HANDWRITTEN,
      handwriting_image_key: key,
    } as any);

    return this.toView(await this.reload(prescription.id));
  }

  /**
   * The saved handwriting strokes as the PNG they were uploaded as, so the pad
   * can pick up where the doctor left off. Served through the API rather than
   * by presigned URL: drawing a cross-origin image onto a canvas taints it, and
   * a tainted canvas cannot be exported again.
   */
  async handwritingFile(
    appointmentId: string,
    user: AuthUser,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    await this.assertAccess(appointmentId, user);
    const prescription = await this.prescriptionModel.findOne({
      where: { appointment_id: appointmentId },
    });
    if (!prescription?.handwriting_image_key) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'This visit has no handwritten prescription.',
      });
    }
    return this.storage.downloadWithType(prescription.handwriting_image_key);
  }

  /**
   * Issue the prescription: freeze it, render the PDF, tell the patient, and
   * record what the doctor changed so the model can learn from it.
   */
  async issue(appointmentId: string, user: AuthUser) {
    const appointment = await this.assertAccess(appointmentId, user);
    const prescription = await this.findOrCreate(appointmentId);
    this.assertEditable(prescription);

    const medicines = await this.medicinesFor(prescription.id);
    this.assertIssuable(prescription, medicines);

    const doctor = await this.doctorModel.findByPk(appointment.doctor_id);
    if (!doctor) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Doctor profile not found.',
      });
    }

    // 1. Render and store the PDF.
    const buffer = await this.pdf.render(prescription, medicines, appointment, doctor);
    const { key } = await this.storage.uploadDocument(
      {
        buffer,
        originalname: `prescription-${appointment.id}.pdf`,
        mimetype: 'application/pdf',
        size: buffer.length,
      } as Express.Multer.File,
      `prescriptions/${appointment.doctor_id}`,
    );

    // 2. Freeze it.
    await prescription.update({
      status: PrescriptionStatus.ISSUED,
      issued_at: new Date(),
      pdf_key: key,
    } as any);

    // 3. Grow the tenant's medicine vocabulary from what was actually issued.
    //    Best-effort: the prescription is already frozen by this point, so a
    //    catalogue failure must not surface as a failed issue.
    try {
      await this.medicines.recordUsage(
        medicines.map((m) => ({
          name: m.medicine_name,
          strength: m.strength,
          form: m.form,
        })),
        appointment.doctor_id,
      );
    } catch (err) {
      this.logger.warn(`Could not record medicine usage: ${(err as Error).message}`);
    }

    // 4. Capture the training pair. Best-effort: a logging failure must never
    //    cost the patient their prescription.
    try {
      await this.captureTrainingSample(appointment, prescription, medicines);
    } catch (err) {
      this.logger.warn(`Could not record training sample: ${(err as Error).message}`);
    }

    // 5. Tell the patient.
    await this.notifications.create(
      appointment.patient_mobile,
      NotificationType.PRESCRIPTION_READY,
      'Your prescription is ready',
      `Dr. ${doctor.name} has issued your prescription for ${appointment.appointment_date}.`,
      { appointmentId: appointment.id, prescriptionId: prescription.id },
      appointment.doctor_id,
    );

    // Written straight through, not batched: this is the moment a document
    // reached a patient, and it is the row someone would later ask to see.
    this.activity.recordForUser(user, {
      action: ActivityAction.PRESCRIPTION_ISSUED,
      summary:
        `Issued a prescription for ${appointment.patient_name} ` +
        `(${appointment.appointment_date}) with ${medicines.length} medicine(s).`,
      entity_type: 'prescription',
      entity_id: prescription.id,
      doctor_id: appointment.doctor_id,
      metadata: {
        appointment_id: appointment.id,
        patient_mobile: appointment.patient_mobile,
        medicine_count: medicines.length,
        medicines: medicines.map((m) => m.medicine_name),
      },
    });

    return this.toView(await this.reload(prescription.id));
  }

  /**
   * The issued PDF's bytes, for a client that wants the document itself rather
   * than a link — the doctor sharing a prescription into WhatsApp hands the
   * share sheet a real file.
   *
   * Deliberately served through the API instead of handing out the presigned
   * S3 URL: the bucket returns no `Access-Control-Allow-Origin`, so a browser
   * `fetch` of that URL is blocked before it can read a byte. This route
   * carries the API's own CORS policy, and the same permission check as every
   * other view of the prescription.
   */
  async pdfFile(
    appointmentId: string,
    user: AuthUser,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const appointment = await this.assertAccess(appointmentId, user);
    const prescription = await this.prescriptionModel.findOne({
      where: {
        appointment_id: appointmentId,
        status: PrescriptionStatus.ISSUED,
      },
    });
    if (!prescription?.pdf_key) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'This visit has no issued prescription yet.',
      });
    }

    return {
      buffer: await this.storage.download(prescription.pdf_key),
      filename: this.pdfFilename(appointment),
    };
  }

  /**
   * The draft rendered exactly as issuing would render it — same service, same
   * letterhead, same page — but nothing is frozen, stored or sent.
   *
   * Issuing is one-way from the patient's side: they are notified and can open
   * the document. Withdrawing undoes it, but only after they have already seen
   * it. So the doctor gets to look at the real page first rather than at the
   * editor's approximation of it.
   *
   * Deliberately not `assertIssuable`: a half-written draft is exactly what a
   * doctor wants to preview, and refusing to render one would make the button
   * useless at the point it is most wanted.
   *
   * `letterhead: false` is the print copy — header space left blank for the
   * doctor's own pre-printed pad. Also used for an issued prescription, since
   * the stored PDF carries the header and the frozen data renders identically.
   */
  async previewFile(
    appointmentId: string,
    user: AuthUser,
    opts: { letterhead?: boolean } = {},
  ): Promise<{ buffer: Buffer; filename: string }> {
    const appointment = await this.assertAccess(appointmentId, user);
    const prescription = await this.findOrCreate(appointmentId);
    const medicines = await this.medicinesFor(prescription.id);

    const doctor = await this.doctorModel.findByPk(appointment.doctor_id);
    if (!doctor) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Doctor profile not found.',
      });
    }

    return {
      buffer: await this.pdf.render(prescription, medicines, appointment, doctor, opts),
      filename: this.pdfFilename(appointment, opts.letterhead === false ? 'print' : 'preview'),
    };
  }

  /** `prescription-ramesh-kulkarni-2026-09-02.pdf` — readable once saved. */
  private pdfFilename(appointment: Appointment, suffix?: string): string {
    const who = (appointment.patient_name || 'patient')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    return [
      'prescription',
      suffix,
      who || 'patient',
      appointment.appointment_date,
    ]
      .filter(Boolean)
      .join('-') + '.pdf';
  }

  /**
   * The link a doctor sends the patient over WhatsApp, and the message it
   * goes in.
   *
   * WhatsApp will open a chat with any number from a URL — saved contact or
   * not — but will not carry a file, so the prescription travels as a link
   * to `GET /rx/:token`, which serves the issued PDF without a login. A
   * draft is issued first: the link must point at the frozen document the
   * patient also has in their account, not at whatever the editor holds.
   *
   * The token is random, lives on the row, and is reused while it has more
   * than a day left; withdrawing clears it. Anyone holding the URL can open
   * the PDF until it expires, which is the same trust as the WhatsApp
   * message it sits in.
   */
  async whatsappLink(appointmentId: string, user: AuthUser) {
    const appointment = await this.assertAccess(appointmentId, user);
    let prescription = await this.prescriptionModel.findOne({
      where: { appointment_id: appointmentId },
    });
    if (!prescription || prescription.status !== PrescriptionStatus.ISSUED) {
      await this.issue(appointmentId, user);
      prescription = (await this.prescriptionModel.findOne({
        where: { appointment_id: appointmentId },
      }))!;
    }

    const now = Date.now();
    const fresh =
      prescription.share_token &&
      prescription.share_token_expires_at &&
      prescription.share_token_expires_at.getTime() - now > SHARE_LINK_RENEW_BELOW_MS;
    if (!fresh) {
      await prescription.update({
        share_token: randomBytes(24).toString('base64url'),
        share_token_expires_at: new Date(now + SHARE_LINK_DAYS * 24 * 60 * 60 * 1000),
      } as any);
    }

    const doctor = await this.doctorModel.findByPk(appointment.doctor_id);
    const link = `${this.config.get<string>('apiPublicBase')}/rx/${prescription.share_token}`;
    const doctorName = doctor ? withDrPrefix(doctor.name) : 'your doctor';
    const firstName = (appointment.patient_name || '').trim().split(/\s+/)[0] || 'there';
    const message =
      `Hi ${firstName}, here is your prescription from ${doctorName} ` +
      `for your visit on ${readableDate(appointment.appointment_date)}. ` +
      `Tap the link to download it:\n${link}\n\n` +
      `The link works for ${SHARE_LINK_DAYS} days.`;

    // wa.me wants the number with country code and no plus; the numbers we
    // store are 10-digit Indian mobiles.
    const digits = (appointment.patient_mobile || '').replace(/\D/g, '');
    const intl = digits.length === 10 ? `91${digits}` : digits;

    return {
      link,
      expires_at: prescription.share_token_expires_at,
      mobile: appointment.patient_mobile,
      message,
      whatsapp_url: `https://wa.me/${intl}?text=${encodeURIComponent(message)}`,
    };
  }

  /**
   * The PDF behind a WhatsApp link. No caller identity: the token is the
   * whole credential, so it is matched exactly and checked for expiry, and
   * an unissued or withdrawn prescription (no `pdf_key`) is a miss like any
   * other — nothing distinguishes "expired" from "never existed" to whoever
   * is guessing.
   */
  async pdfByShareToken(token: string): Promise<{ buffer: Buffer; filename: string }> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
      throw new AppException(ErrorCode.NOT_FOUND);
    }
    const prescription = await this.prescriptionModel.findOne({
      where: {
        share_token: token,
        share_token_expires_at: { [Op.gt]: new Date() },
        status: PrescriptionStatus.ISSUED,
      },
    });
    if (!prescription?.pdf_key) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'This prescription link has expired or is not valid.',
      });
    }
    const appointment = await this.appointmentModel.findByPk(prescription.appointment_id);
    return {
      buffer: await this.storage.download(prescription.pdf_key),
      filename: appointment ? this.pdfFilename(appointment) : 'prescription.pdf',
    };
  }

  /**
   * Withdraw an issued prescription, putting it back to a draft.
   *
   * This is what "delete" means for something the patient has already been
   * handed: the doctor issued the wrong thing and needs to fix it. Destroying
   * the row outright would take the medicines with it and leave the visit
   * looking as though nothing was ever prescribed, so instead the freeze is
   * lifted and the work is kept for editing.
   *
   * What does go: the rendered PDF — it is the copy the patient can open, and
   * a withdrawn prescription must stop being downloadable — and the "your
   * prescription is ready" notification, which would otherwise point at a
   * document that is no longer there. The visit stops showing a prescription
   * to the patient the moment the status leaves `issued`.
   */
  async withdraw(appointmentId: string, user: AuthUser) {
    await this.assertAccess(appointmentId, user);

    const prescription = await this.prescriptionModel.findOne({
      where: { appointment_id: appointmentId },
    });
    if (!prescription || prescription.status !== PrescriptionStatus.ISSUED) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, {
        message: 'This visit has no issued prescription to withdraw.',
      });
    }

    const pdfKey = prescription.pdf_key;
    await prescription.update({
      status: PrescriptionStatus.DRAFT,
      issued_at: null,
      pdf_key: null,
      // The WhatsApp link, if one was sent, stops working with the document.
      share_token: null,
      share_token_expires_at: null,
    } as any);

    await this.discardIssuedCopy(prescription, pdfKey);

    this.logger.log(`Prescription for appointment ${appointmentId} withdrawn to draft.`);
    return this.toView(await this.reload(prescription.id));
  }

  /**
   * Delete the prescription outright — the row, its medicines, the handwriting
   * image and, if it was issued, everything `withdraw` would have removed.
   *
   * Withdraw is the fix for "I issued the wrong thing"; this is for "this
   * visit should not carry this prescription at all", and the doctor asks
   * for it from the preview after seeing the page. The next read of the
   * visit's prescription creates an empty draft again (`findOrCreate`), so
   * the editor simply comes back blank.
   */
  async remove(appointmentId: string, user: AuthUser) {
    const appointment = await this.assertAccess(appointmentId, user);

    const prescription = await this.prescriptionModel.findOne({
      where: { appointment_id: appointmentId },
    });
    if (!prescription) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'This visit has no prescription to delete.',
      });
    }

    const wasIssued = prescription.status === PrescriptionStatus.ISSUED;
    const medicines = await this.medicinesFor(prescription.id);
    const pdfKey = prescription.pdf_key;
    const handwritingKey = prescription.handwriting_image_key;

    await this.medicineModel.destroy({
      where: { e_prescription_id: prescription.id },
    });
    await prescription.destroy();

    // Best-effort cleanups, same as withdraw: the row is already gone, and
    // none of these failing should hand the doctor an error for a delete
    // that succeeded.
    if (wasIssued) await this.discardIssuedCopy(prescription, pdfKey);
    if (handwritingKey) {
      try {
        await this.storage.delete(handwritingKey);
      } catch (err) {
        this.logger.warn(`Could not delete handwriting image: ${(err as Error).message}`);
      }
    }

    this.activity.recordForUser(user, {
      action: ActivityAction.PRESCRIPTION_DELETED,
      summary:
        `Deleted the ${wasIssued ? 'issued' : 'draft'} prescription for ` +
        `${appointment.patient_name} (${appointment.appointment_date}) ` +
        `with ${medicines.length} medicine(s).`,
      entity_type: 'prescription',
      entity_id: prescription.id,
      doctor_id: appointment.doctor_id,
      metadata: {
        appointment_id: appointment.id,
        patient_mobile: appointment.patient_mobile,
        was_issued: wasIssued,
        medicine_count: medicines.length,
        medicines: medicines.map((m) => m.medicine_name),
      },
    });

    this.logger.log(`Prescription for appointment ${appointmentId} deleted.`);
    return { deleted: true };
  }

  /**
   * Everything that only exists because the prescription was issued: the
   * rendered PDF the patient can open, the "your prescription is ready"
   * notification, and the training pair captured at issue. Best-effort — the
   * prescription has already been unfrozen or removed by the time this runs.
   */
  private async discardIssuedCopy(
    prescription: EPrescription,
    pdfKey: string | null | undefined,
  ): Promise<void> {
    if (pdfKey) {
      try {
        await this.storage.delete(pdfKey);
      } catch (err) {
        this.logger.warn(`Could not delete withdrawn PDF: ${(err as Error).message}`);
      }
    }

    try {
      await this.notifications.removeForPrescription(
        prescription.id,
        NotificationType.PRESCRIPTION_READY,
      );
    } catch (err) {
      this.logger.warn(
        `Could not clear the prescription notification: ${(err as Error).message}`,
      );
    }

    // The training pair captured at issue described a prescription the doctor
    // has just disowned. Keeping it would teach the model from a mistake, and
    // re-issuing would add a second sample for the same visit.
    try {
      await this.trainingModel.destroy({
        where: {
          appointment_id: prescription.appointment_id,
          kind: TrainingSampleKind.PRESCRIPTION,
        },
      });
    } catch (err) {
      this.logger.warn(`Could not clear the training sample: ${(err as Error).message}`);
    }
  }

  // ── patient-facing ─────────────────────────────────────────

  /** Issued prescription for a visit, shaped for the patient portal. */
  async findIssuedForAppointment(appointmentId: string) {
    const prescription = await this.prescriptionModel.findOne({
      where: {
        appointment_id: appointmentId,
        status: PrescriptionStatus.ISSUED,
      },
    });
    if (!prescription) return null;

    const medicines = await this.medicinesFor(prescription.id);
    return {
      id: prescription.id,
      mode: prescription.mode,
      diagnosis: prescription.diagnosis,
      previous_history: prescription.previous_history,
      advice: prescription.advice,
      follow_up_date: prescription.follow_up_date,
      issued_at: prescription.issued_at,
      pdf_url: await this.storage.presignedGetUrl(prescription.pdf_key),
      handwriting_image_url: await this.storage.presignedGetUrl(
        prescription.handwriting_image_key,
      ),
      medicines: medicines.map((m) => this.medicineView(m)),
    };
  }

  /**
   * Fresh download links for a batch of prescriptions, keyed by prescription
   * id. Only issued ones with a stored PDF appear — a withdrawn prescription
   * simply has no entry, so whatever is showing the link shows nothing.
   *
   * Used to put a "download" button straight on the "your prescription is
   * ready" notification, so the patient does not have to find the visit.
   */
  async pdfUrlsFor(prescriptionIds: string[]): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    if (prescriptionIds.length === 0) return urls;

    const rows = await this.prescriptionModel.findAll({
      where: {
        id: { [Op.in]: prescriptionIds },
        status: PrescriptionStatus.ISSUED,
        pdf_key: { [Op.ne]: null },
      },
      attributes: ['id', 'pdf_key', 'appointment_id'],
    });
    if (rows.length === 0) return urls;

    // The visit only lends the file its name (`prescription-<patient>-<date>.pdf`).
    const appointments = await this.appointmentModel.findAll({
      where: { id: { [Op.in]: rows.map((r) => r.appointment_id) } },
      attributes: ['id', 'patient_name', 'appointment_date'],
    });
    const byId = new Map(appointments.map((a) => [a.id, a]));

    await Promise.all(
      rows.map(async (row) => {
        const appointment = byId.get(row.appointment_id);
        // Served as an attachment: this link sits behind a "download" button.
        const url = await this.storage.presignedGetUrl(
          row.pdf_key,
          undefined,
          appointment ? this.pdfFilename(appointment) : 'prescription.pdf',
        );
        if (url) urls.set(row.id, url);
      }),
    );
    return urls;
  }

  // ── internals ──────────────────────────────────────────────

  private async findOrCreate(appointmentId: string): Promise<EPrescription> {
    const existing = await this.prescriptionModel.findOne({
      where: { appointment_id: appointmentId },
    });
    if (existing) return existing;

    return this.prescriptionModel.create({
      appointment_id: appointmentId,
      status: PrescriptionStatus.DRAFT,
    } as any);
  }

  private reload(id: string): Promise<EPrescription> {
    return this.prescriptionModel.findByPk(id) as Promise<EPrescription>;
  }

  private medicinesFor(prescriptionId: string): Promise<EPrescriptionMedicine[]> {
    return this.medicineModel.findAll({
      where: { e_prescription_id: prescriptionId },
      order: [['position', 'ASC']],
    });
  }

  /**
   * Replace the medicine rows wholesale, preserving which ones the AI proposed
   * and flagging the ones the doctor changed — that flag is the training signal.
   */
  private async replaceMedicines(
    prescription: EPrescription,
    incoming: UpdatePrescriptionDto['medicines'],
  ): Promise<void> {
    const previous = await this.medicinesFor(prescription.id);
    const previousById = new Map(previous.map((m) => [m.id, m]));

    await this.medicineModel.destroy({
      where: { e_prescription_id: prescription.id },
    });

    const rows = (incoming ?? [])
      .filter((m) => m.medicine_name?.trim())
      .map((m, index) => {
        const original = m.id ? previousById.get(m.id) : undefined;
        const fromAi = original?.source === MedicineSource.AI;
        return {
          e_prescription_id: prescription.id,
          position: index,
          medicine_name: m.medicine_name.trim(),
          strength: m.strength?.trim() || null,
          form: m.form?.trim() || null,
          dosage: m.dosage?.trim() || '',
          timing: null,
          duration_days: m.duration_days ?? null,
          instructions: m.instructions?.trim() || null,
          source: fromAi ? MedicineSource.AI : MedicineSource.DOCTOR,
          was_edited: fromAi ? this.differs(original!, m) : false,
        };
      });

    if (rows.length) await this.medicineModel.bulkCreate(rows as any);
  }

  private differs(
    original: EPrescriptionMedicine,
    edited: NonNullable<UpdatePrescriptionDto['medicines']>[number],
  ): boolean {
    return (
      original.medicine_name !== edited.medicine_name?.trim() ||
      (original.strength || '') !== (edited.strength?.trim() || '') ||
      (original.dosage || '') !== (edited.dosage?.trim() || '') ||
      // Was `timing`; food timing lives in instructions now, and an edit there
      // is exactly the correction worth capturing as a training sample.
      (original.instructions || '') !== (edited.instructions?.trim() || '') ||
      (original.duration_days ?? null) !== (edited.duration_days ?? null)
    );
  }

  /**
   * Store what the model saw, what it proposed, and what the doctor signed off.
   * Only recorded for dictated prescriptions — a hand-written one has no AI
   * output to learn from.
   */
  private async captureTrainingSample(
    appointment: Appointment,
    prescription: EPrescription,
    medicines: EPrescriptionMedicine[],
  ): Promise<void> {
    if (!prescription.consultation_session_id) return;

    const session = await this.sessionModel.findByPk(
      prescription.consultation_session_id,
    );
    if (!session?.transcript) return;

    const edited =
      medicines.some((m) => m.was_edited) ||
      medicines.some((m) => m.source === MedicineSource.DOCTOR);

    await this.trainingModel.create({
      kind: TrainingSampleKind.PRESCRIPTION,
      appointment_id: appointment.id,
      doctor_id: appointment.doctor_id,
      input_payload: {
        transcript: session.transcript,
        patient: {
          age: appointment.patient_age,
          gender: appointment.patient_gender,
          complaint: appointment.description,
        },
      },
      ai_output: null,
      doctor_output: {
        diagnosis: prescription.diagnosis,
        previous_history: prescription.previous_history,
        advice: prescription.advice,
        medicines: medicines.map((m) => this.medicineView(m)),
      },
      edited,
      model_version: session.model_version,
    } as any);
  }

  private assertEditable(prescription: EPrescription): void {
    if (prescription.status === PrescriptionStatus.ISSUED) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message:
          'This prescription has already been issued and cannot be changed.',
      });
    }
  }

  /** Nothing goes to a patient half-written. */
  private assertIssuable(
    prescription: EPrescription,
    medicines: EPrescriptionMedicine[],
  ): void {
    // A handwritten prescription only needs the drawing.
    if (prescription.mode === PrescriptionMode.HANDWRITTEN) {
      if (!prescription.handwriting_image_key) {
        throw new AppException(ErrorCode.BAD_REQUEST, {
          message: 'Write the prescription before issuing it.',
        });
      }
      return;
    }
    if (medicines.length === 0 && !prescription.advice?.trim()) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message:
          'Add at least one medicine or some advice before issuing this prescription.',
      });
    }
    const incomplete = medicines.find((m) => !m.dosage?.trim());
    if (incomplete) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: `Please set the frequency for "${incomplete.medicine_name}" before issuing.`,
      });
    }
  }

  private async assertAccess(
    appointmentId: string,
    user: AuthUser,
  ): Promise<Appointment> {
    const appointment = await this.appointmentModel.findByPk(appointmentId);
    if (!appointment) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Appointment not found.',
      });
    }
    // All clinical users have doctorId; reject any mismatch (covers doctor + staff).
    if (!user.doctorId || appointment.doctor_id !== user.doctorId) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'You can only access your own appointments.',
      });
    }
    return appointment;
  }

  private medicineView(m: EPrescriptionMedicine) {
    return {
      id: m.id,
      medicine_name: m.medicine_name,
      strength: m.strength,
      form: m.form,
      dosage: m.dosage,
      duration_days: m.duration_days,
      instructions: m.instructions,
      source: m.source,
      was_edited: m.was_edited,
    };
  }

  private async toView(prescription: EPrescription) {
    const medicines = await this.medicinesFor(prescription.id);
    return {
      id: prescription.id,
      appointment_id: prescription.appointment_id,
      consultation_session_id: prescription.consultation_session_id,
      status: prescription.status,
      mode: prescription.mode,
      diagnosis: prescription.diagnosis,
      previous_history: prescription.previous_history,
      advice: prescription.advice,
      follow_up_date: prescription.follow_up_date,
      issued_at: prescription.issued_at,
      pdf_url: await this.storage.presignedGetUrl(prescription.pdf_key),
      handwriting_image_url: await this.storage.presignedGetUrl(
        prescription.handwriting_image_key,
      ),
      medicines: medicines.map((m) => this.medicineView(m)),
    };
  }
}

/** "Sweta" → "Dr. Sweta"; a name that already carries the title is left alone. */
function withDrPrefix(name: string): string {
  const trimmed = name.trim();
  return /^dr\.?\s/i.test(trimmed) ? trimmed : `Dr. ${trimmed}`;
}
