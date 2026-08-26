import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { PatientReport } from '../database/models/patient-report.model';
import { Appointment } from '../database/models/appointment.model';
import { StorageService } from '../uploads/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReportDto } from './dto/create-report.dto';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AuthPatient } from '../patient-auth/current-patient.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AiJobStatus, ConsultationStatus, NotificationType } from '../common/enums';
import { ReportSummaryService } from './report-summary.service';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(PatientReport) private readonly reportModel: typeof PatientReport,
    @InjectModel(Appointment) private readonly appointmentModel: typeof Appointment,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly summaries: ReportSummaryService,
  ) {}

  async create(
    dto: CreateReportDto,
    file: Express.Multer.File,
    user: AuthUser,
  ): Promise<PatientReport> {
    this.storage.validateDocument(file);
    const { key } = await this.storage.uploadDocument(file, `reports/${dto.mobile}`);

    const report = await this.reportModel.create({
      patient_mobile: dto.mobile,
      patient_profile_id: dto.patient_profile_id,
      title: dto.title,
      file_key: key,
      uploaded_by_user_id: user.id,
      doctor_id: user.doctorId ?? null,
    } as any);

    await this.notifications.create(
      dto.mobile,
      NotificationType.REPORT_AVAILABLE,
      'Your report is available',
      `"${dto.title}" has been uploaded and is ready to view.`,
      { reportId: report.id },
      user.doctorId ?? null,
      dto.patient_profile_id,
    );

    // Summarising takes tens of seconds — let the upload return now and fill the
    // summary in behind it.
    void this.summaries.summarizeInBackground(report.id, file);

    return report;
  }

  /**
   * Patient self-upload against one of their own appointments, so the doctor
   * can review it for that visit. Allowed only while the visit still accepts
   * uploads — i.e. before the doctor marks the OPD done (see
   * `ConsultationStatus`). No notification: the patient uploaded it themselves.
   */
  async createByPatient(
    patient: AuthPatient,
    appointmentId: string,
    title: string,
    file: Express.Multer.File,
  ): Promise<PatientReport> {
    const appointment = await this.appointmentModel.findByPk(appointmentId);
    if (!appointment || appointment.patient_mobile !== patient.mobile) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Appointment not found.',
      });
    }
    if (!this.acceptsReports(appointment.consultation_status)) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message:
          'This appointment is closed — reports can no longer be added to it.',
      });
    }

    this.storage.validateDocument(file);
    const { key } = await this.storage.uploadDocument(
      file,
      `reports/${patient.mobile}`,
    );

    const report = await this.reportModel.create({
      patient_mobile: patient.mobile,
      // The visit already knows whose it is; inherit rather than ask.
      patient_profile_id: appointment.patient_profile_id,
      title,
      file_key: key,
      uploaded_by_user_id: null,
      appointment_id: appointment.id,
    } as any);

    // The doctor sees this report during the visit, so the summary matters most
    // here — but it still must not block the patient's upload.
    void this.summaries.summarizeInBackground(report.id, file);

    return report;
  }

  /** Reports may be added while a visit is pending or on_hold, not once done. */
  private acceptsReports(status: ConsultationStatus): boolean {
    return (
      status === ConsultationStatus.PENDING ||
      status === ConsultationStatus.ON_HOLD
    );
  }

  /**
   * Load one of the patient's own reports and confirm it may still be changed.
   *
   * Two separate gates, deliberately: the report must belong to this patient
   * (never trust an id from the client), and its visit must still be open. A
   * report that isn't attached to any visit is a clinic/pathlab upload — the
   * patient may read it but never edit it.
   */
  private async ownEditableReport(
    patient: AuthPatient,
    reportId: string,
  ): Promise<PatientReport> {
    const report = await this.reportModel.findByPk(reportId);
    if (!report || report.patient_mobile !== patient.mobile) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Report not found.',
      });
    }
    if (!report.appointment_id) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'This report was uploaded by the clinic and cannot be changed.',
      });
    }
    const appointment = await this.appointmentModel.findByPk(
      report.appointment_id,
    );
    if (!appointment || !this.acceptsReports(appointment.consultation_status)) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message:
          'This appointment is closed — its reports can no longer be changed.',
      });
    }
    return report;
  }

  /**
   * Patient edits their own report: rename it, replace the file, or both.
   * Replacing the file invalidates the AI summary, so it is reset and queued
   * again — leaving the old summary attached to a new file would be worse than
   * showing none.
   */
  async updateByPatient(
    patient: AuthPatient,
    reportId: string,
    title: string | undefined,
    file: Express.Multer.File | undefined,
  ): Promise<PatientReport> {
    const report = await this.ownEditableReport(patient, reportId);

    if (title?.trim()) report.title = title.trim();

    let replaced: { oldKey: string } | null = null;
    if (file) {
      this.storage.validateDocument(file);
      const { key } = await this.storage.uploadDocument(
        file,
        `reports/${patient.mobile}`,
      );
      replaced = { oldKey: report.file_key };
      report.file_key = key;
      // The old summary describes a file that is no longer attached.
      report.ai_summary = null;
      report.ai_summary_status = AiJobStatus.PENDING;
      report.ai_summary_error = null;
      report.ai_summarized_at = null;
    }

    await report.save();

    if (replaced) {
      // Drop the superseded object only after the row points at the new one,
      // so a failure here can never leave the report pointing at nothing.
      await this.storage.delete(replaced.oldKey).catch(() => undefined);
      void this.summaries.summarizeInBackground(report.id, file!);
    } else if (report.appointment_id) {
      // Title-only edit still changes what the combined summary is built from.
      void this.summaries.consolidateForAppointment(report.appointment_id);
    }

    return report;
  }

  /** Patient deletes their own report, while the visit is still open. */
  async removeByPatient(patient: AuthPatient, reportId: string): Promise<void> {
    const report = await this.ownEditableReport(patient, reportId);
    const appointmentId = report.appointment_id;
    await this.storage.delete(report.file_key).catch(() => undefined);
    await report.destroy();
    if (appointmentId) {
      void this.summaries.consolidateForAppointment(appointmentId);
    }
  }

  /**
   * One patient's reports. Scoped by profile, so a wife's bloodwork never
   * appears under her husband's record even though both were uploaded against
   * the same phone number.
   */
  async listForProfile(profileId: string, doctorId?: string | null) {
    const where: any = { patient_profile_id: profileId };
    if (doctorId) where.doctor_id = doctorId;
    const rows = await this.reportModel.findAll({
      where,
      order: [['created_at', 'DESC']],
    });
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        title: r.title,
        url: await this.storage.presignedGetUrl(r.file_key),
        createdAt: r.get('createdAt'),
      })),
    );
  }

  async remove(id: string): Promise<void> {
    const row = await this.reportModel.findByPk(id);
    if (!row) {
      throw new AppException(ErrorCode.NOT_FOUND, { message: 'Report not found.' });
    }
    const appointmentId = row.appointment_id;
    await this.storage.delete(row.file_key);
    await row.destroy();
    // The visit's combined summary must no longer cover a report that's gone.
    if (appointmentId) {
      void this.summaries.consolidateForAppointment(appointmentId);
    }
  }
}
