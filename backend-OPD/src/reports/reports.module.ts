import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { PatientReport } from '../database/models/patient-report.model';
import { Appointment } from '../database/models/appointment.model';
import { AiTrainingSample } from '../database/models/ai-training-sample.model';
import { ReportsService } from './reports.service';
import { ReportSummaryService } from './report-summary.service';
import { ReportsController } from './reports.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    SequelizeModule.forFeature([PatientReport, Appointment, AiTrainingSample]),
    NotificationsModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ReportSummaryService],
  exports: [ReportsService, ReportSummaryService],
})
export class ReportsModule {}
