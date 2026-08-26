import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
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

    return this.toView(await this.reload(prescription.id));
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
          timing: m.timing?.trim() || null,
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
      (original.timing || '') !== (edited.timing?.trim() || '') ||
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
        message: `Please set the dosage for "${incomplete.medicine_name}" before issuing.`,
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
      timing: m.timing,
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
