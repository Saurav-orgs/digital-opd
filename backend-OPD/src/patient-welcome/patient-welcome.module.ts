import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { Patient } from '../database/models/patient.model';
import { DoctorsModule } from '../doctors/doctors.module';
import { PatientWelcomeService } from './patient-welcome.service';

/**
 * The one-time patient welcome, shared by every patient-side door that can be
 * someone's first: patient-auth (register, signup) and appointments (guest
 * booking) both import this so the "only once" stamp lives in one service.
 *
 * WhatsAppService is global; DoctorsModule gives the booking URL.
 */
@Module({
  imports: [
    ConfigModule,
    SequelizeModule.forFeature([Patient]),
    DoctorsModule,
  ],
  providers: [PatientWelcomeService],
  exports: [PatientWelcomeService],
})
export class PatientWelcomeModule {}
