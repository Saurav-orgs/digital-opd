import { Module } from '@nestjs/common';
import { PatientPortalController } from './patient-portal.controller';
import { AppointmentsModule } from '../appointments/appointments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';
import { ReportsModule } from '../reports/reports.module';
import { PatientProfilesModule } from '../patient-profiles/patient-profiles.module';
import { ConsultationsModule } from '../consultations/consultations.module';

@Module({
  imports: [
    AppointmentsModule,
    NotificationsModule,
    PatientAuthModule,
    ReportsModule,
    PatientProfilesModule,
    // Provides PrescriptionsService: a "prescription ready" notification
    // carries a fresh download link for the PDF.
    ConsultationsModule,
  ],
  controllers: [PatientPortalController],
})
export class PatientPortalModule {}
