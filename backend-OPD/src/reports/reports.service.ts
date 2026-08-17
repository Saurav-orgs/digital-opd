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
import { NotificationType } from '../common/enums';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(PatientReport) private readonly reportModel: typeof PatientReport,
    @InjectModel(Appointment) private readonly appointmentModel: typeof Appointment,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
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
      title: dto.title,
      file_key: key,
      uploaded_by_user_id: user.id,
    } as any);

    await this.notifications.create(
      dto.mobile,
      NotificationType.REPORT_AVAILABLE,
      'Your report is available',
      `"${dto.title}" has been uploaded and is ready to view.`,
      { reportId: report.id },
    );

    return report;
  }

  /**
   * Patient self-upload — attaches to their most recently booked appointment
   * (the "last registered" / likely-ongoing visit). No notification: the
   * patient just uploaded it themselves.
   */
  async createByPatient(
    patient: AuthPatient,
    title: string,
    file: Express.Multer.File,
  ): Promise<PatientReport> {
    const lastAppointment = await this.appointmentModel.findOne({
      where: { patient_mobile: patient.mobile },
      order: [['created_at', 'DESC']],
    });
    if (!lastAppointment) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'No appointment found. Please book an appointment first.',
      });
    }

    this.storage.validateDocument(file);
    const { key } = await this.storage.uploadDocument(
      file,
      `reports/${patient.mobile}`,
    );

    return this.reportModel.create({
      patient_mobile: patient.mobile,
      title,
      file_key: key,
      uploaded_by_user_id: null,
      appointment_id: lastAppointment.id,
    } as any);
  }

  async listForMobile(mobile: string) {
    const rows = await this.reportModel.findAll({
      where: { patient_mobile: mobile },
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
    await this.storage.delete(row.file_key);
    await row.destroy();
  }
}
