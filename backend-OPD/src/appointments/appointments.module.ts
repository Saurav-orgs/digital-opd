import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { PublicController } from './public.controller';
import { Appointment } from '../database/models/appointment.model';
import { AppointmentPrescription } from '../database/models/prescription.model';
import { PatientReport } from '../database/models/patient-report.model';
import { Doctor } from '../database/models/doctor.model';
import { SlotsModule } from '../slots/slots.module';
import { DoctorsModule } from '../doctors/doctors.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    SequelizeModule.forFeature([
      Appointment,
      AppointmentPrescription,
      PatientReport,
      Doctor,
    ]),
    SlotsModule,
    DoctorsModule,
    NotificationsModule,
  ],
  controllers: [AppointmentsController, PublicController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
