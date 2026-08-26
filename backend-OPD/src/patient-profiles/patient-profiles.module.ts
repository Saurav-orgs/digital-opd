import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Patient } from '../database/models/patient.model';
import { PatientProfile } from '../database/models/patient-profile.model';
import { Appointment } from '../database/models/appointment.model';
import { PatientReport } from '../database/models/patient-report.model';
import { Notification } from '../database/models/notification.model';
import { UploadsModule } from '../uploads/uploads.module';
import { PatientAuthGuard } from '../patient-auth/patient-auth.guard';
import { PatientProfilesService } from './patient-profiles.service';
import {
  PatientProfilesController,
  StaffPatientProfilesController,
} from './patient-profiles.controller';

/**
 * Deliberately does not import `PatientAuthModule`: auth depends on this
 * module (identify/register both create patients), so importing it back would
 * be a cycle. `PatientAuthGuard` has no injected dependencies of its own — the
 * passport strategy it delegates to is registered globally by
 * `PatientAuthModule` — so it can simply be provided here.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Patient,
      PatientProfile,
      Appointment,
      PatientReport,
      Notification,
    ]),
    UploadsModule,
  ],
  controllers: [PatientProfilesController, StaffPatientProfilesController],
  providers: [PatientProfilesService, PatientAuthGuard],
  exports: [PatientProfilesService],
})
export class PatientProfilesModule {}
