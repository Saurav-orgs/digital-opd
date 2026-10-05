import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import { IvfCaseSheet } from '../database/models/ivf-case-sheet.model';
import { IvfCaseSheetPdfService } from './ivf-case-sheet-pdf.service';
import { StorageService } from '../uploads/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { NotificationType, PrescriptionStatus } from '../common/enums';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { UpdateIvfCaseSheetDto } from './dto/ivf-case-sheet.dto';
import {
  IvfCaseSheetData,
  isIvfCaseSheetEmpty,
  isIvfSpecialization,
  sanitizeIvfCaseSheetData,
} from './ivf-case-sheet.schema';

/**
 * The IVF case-sheet for one visit: read the draft, edit it, issue it.
 *
 * It is the prescription lifecycle (`PrescriptionsService`) with a different
 * body and one extra gate — the sheet is offered only to IVF & Fertility
 * doctors, so `assertAccess` checks the specialization as well as ownership.
 * Issuing renders the PDF onto the letterhead, stores it and notifies the
 * patient, exactly as a prescription does; withdrawing puts it back to a draft
 * and takes the PDF and the notice with it.
 */
@Injectable()
export class IvfCaseSheetsService {
  private readonly logger = new Logger(IvfCaseSheetsService.name);

  constructor(
    @InjectModel(Appointment) private readonly appointmentModel: typeof Appointment,
    @InjectModel(Doctor) private readonly doctorModel: typeof Doctor,
    @InjectModel(IvfCaseSheet) private readonly sheetModel: typeof IvfCaseSheet,
    private readonly pdf: IvfCaseSheetPdfService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The appointment's case-sheet, creating an empty draft on first open. */
  async get(appointmentId: string, user: AuthUser) {
    const { appointment } = await this.assertAccess(appointmentId, user);
    const sheet = await this.findOrCreate(appointment);
    return this.toView(sheet);
  }

  /** Save the doctor's edits. Rejected once issued. */
  async update(appointmentId: string, dto: UpdateIvfCaseSheetDto, user: AuthUser) {
    const { appointment } = await this.assertAccess(appointmentId, user);
    const sheet = await this.findOrCreate(appointment);
    this.assertEditable(sheet);

    await sheet.update({ data: sanitizeIvfCaseSheetData(dto.data) } as any);
    return this.toView(await this.reload(sheet.id));
  }

  /** Overwrite the draft's body wholesale — used by template apply. */
  async setData(appointmentId: string, data: IvfCaseSheetData, user: AuthUser) {
    return this.update(appointmentId, { data }, user);
  }

  /**
   * Issue the sheet: freeze it, render the PDF onto the letterhead, store it,
   * and tell the patient their document is ready.
   */
  async issue(appointmentId: string, user: AuthUser) {
    const { appointment, doctor } = await this.assertAccess(appointmentId, user);
    const sheet = await this.findOrCreate(appointment);
    this.assertEditable(sheet);

    if (isIvfCaseSheetEmpty(sheet.data || {})) {
      throw new AppException(ErrorCode.CASE_SHEET_EMPTY);
    }

    const buffer = await this.pdf.render(sheet, appointment, doctor);
    const { key } = await this.storage.uploadDocument(
      {
        buffer,
        originalname: `ivf-prescription-${appointment.id}.pdf`,
        mimetype: 'application/pdf',
        size: buffer.length,
      } as Express.Multer.File,
      `ivf-case-sheets/${appointment.doctor_id}`,
    );

    await sheet.update({
      status: PrescriptionStatus.ISSUED,
      issued_at: new Date(),
      pdf_key: key,
    } as any);

    await this.notifications.create(
      appointment.patient_mobile,
      NotificationType.PRESCRIPTION_READY,
      'Your prescription is ready',
      `Dr. ${doctor.name} has issued your prescription for ${appointment.appointment_date}.`,
      { appointmentId: appointment.id, caseSheetId: sheet.id },
      appointment.doctor_id,
    );

    return this.toView(await this.reload(sheet.id));
  }

  /** The issued PDF's bytes, served through the API (CORS, same access check). */
  async pdfFile(
    appointmentId: string,
    user: AuthUser,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { appointment } = await this.assertAccess(appointmentId, user);
    const sheet = await this.sheetModel.findOne({
      where: { appointment_id: appointmentId, status: PrescriptionStatus.ISSUED },
    });
    if (!sheet?.pdf_key) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'This visit has no issued prescription yet.',
      });
    }
    return {
      buffer: await this.storage.download(sheet.pdf_key),
      filename: this.pdfFilename(appointment),
    };
  }

  /**
   * The draft rendered exactly as issuing would render it — nothing frozen,
   * stored or sent. `letterhead: false` is the print copy for a pre-printed pad.
   */
  async previewFile(
    appointmentId: string,
    user: AuthUser,
    opts: { letterhead?: boolean } = {},
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { appointment, doctor } = await this.assertAccess(appointmentId, user);
    const sheet = await this.findOrCreate(appointment);
    return {
      buffer: await this.pdf.render(sheet, appointment, doctor, opts),
      filename: this.pdfFilename(
        appointment,
        opts.letterhead === false ? 'print' : 'preview',
      ),
    };
  }

  /** Withdraw an issued case-sheet back to a draft; the PDF and notice go. */
  async withdraw(appointmentId: string, user: AuthUser) {
    await this.assertAccess(appointmentId, user);
    const sheet = await this.sheetModel.findOne({
      where: { appointment_id: appointmentId },
    });
    if (!sheet || sheet.status !== PrescriptionStatus.ISSUED) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, {
        message: 'This visit has no issued prescription to withdraw.',
      });
    }

    const pdfKey = sheet.pdf_key;
    await sheet.update({
      status: PrescriptionStatus.DRAFT,
      issued_at: null,
      pdf_key: null,
    } as any);
    await this.discardIssuedCopy(sheet, pdfKey);

    return this.toView(await this.reload(sheet.id));
  }

  /** Delete the case-sheet outright; the next read creates an empty draft. */
  async remove(appointmentId: string, user: AuthUser) {
    await this.assertAccess(appointmentId, user);
    const sheet = await this.sheetModel.findOne({
      where: { appointment_id: appointmentId },
    });
    if (!sheet) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'This visit has no prescription to delete.',
      });
    }
    const wasIssued = sheet.status === PrescriptionStatus.ISSUED;
    const pdfKey = sheet.pdf_key;
    await sheet.destroy();
    if (wasIssued) await this.discardIssuedCopy(sheet, pdfKey);
    return { deleted: true };
  }

  // ── internals ────────────────────────────────────────────────

  private async discardIssuedCopy(
    sheet: IvfCaseSheet,
    pdfKey: string | null | undefined,
  ): Promise<void> {
    if (pdfKey) {
      try {
        await this.storage.delete(pdfKey);
      } catch (err) {
        this.logger.warn(`Could not delete withdrawn case-sheet PDF: ${(err as Error).message}`);
      }
    }
    try {
      await this.notifications.removeForPrescription(
        sheet.id,
        NotificationType.PRESCRIPTION_READY,
      );
    } catch (err) {
      this.logger.warn(`Could not clear the case-sheet notification: ${(err as Error).message}`);
    }
  }

  private async findOrCreate(appointment: Appointment): Promise<IvfCaseSheet> {
    const existing = await this.sheetModel.findOne({
      where: { appointment_id: appointment.id },
    });
    if (existing) return existing;
    return this.sheetModel.create({
      appointment_id: appointment.id,
      doctor_id: appointment.doctor_id,
      status: PrescriptionStatus.DRAFT,
      data: {},
    } as any);
  }

  private reload(id: string): Promise<IvfCaseSheet> {
    return this.sheetModel.findByPk(id) as Promise<IvfCaseSheet>;
  }

  private assertEditable(sheet: IvfCaseSheet): void {
    if (sheet.status === PrescriptionStatus.ISSUED) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'This prescription has already been issued and cannot be changed.',
      });
    }
  }

  /**
   * Belongs to the clinic (same check the prescription makes), and the treating
   * doctor is an IVF & Fertility doctor — the sheet is theirs alone.
   */
  private async assertAccess(
    appointmentId: string,
    user: AuthUser,
  ): Promise<{ appointment: Appointment; doctor: Doctor }> {
    const appointment = await this.appointmentModel.findByPk(appointmentId);
    if (!appointment) {
      throw new AppException(ErrorCode.NOT_FOUND, { message: 'Appointment not found.' });
    }
    if (!user.doctorId || appointment.doctor_id !== user.doctorId) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'You can only access your own appointments.',
      });
    }
    const doctor = await this.doctorModel.findByPk(appointment.doctor_id);
    if (!doctor) {
      throw new AppException(ErrorCode.NOT_FOUND, { message: 'Doctor profile not found.' });
    }
    if (!isIvfSpecialization(doctor.specialization)) {
      throw new AppException(ErrorCode.CASE_SHEET_NOT_AVAILABLE);
    }
    return { appointment, doctor };
  }

  private pdfFilename(appointment: Appointment, suffix?: string): string {
    const who = (appointment.patient_name || 'patient')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    return (
      ['ivf-prescription', suffix, who || 'patient', appointment.appointment_date]
        .filter(Boolean)
        .join('-') + '.pdf'
    );
  }

  private toView(sheet: IvfCaseSheet) {
    return {
      id: sheet.id,
      appointment_id: sheet.appointment_id,
      status: sheet.status,
      data: sheet.data || {},
      issued_at: sheet.issued_at,
    };
  }
}
