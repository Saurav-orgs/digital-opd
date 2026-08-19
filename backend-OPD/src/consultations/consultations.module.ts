import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import { ConsultationSession } from '../database/models/consultation-session.model';
import { EPrescription } from '../database/models/e-prescription.model';
import { EPrescriptionMedicine } from '../database/models/e-prescription-medicine.model';
import { AiTrainingSample } from '../database/models/ai-training-sample.model';
import { ConsultationsService } from './consultations.service';
import { ConsultationsController } from './consultations.controller';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import { PrescriptionPdfService } from '../prescriptions/prescription-pdf.service';
import { MedicinesModule } from '../medicines/medicines.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Voice-to-prescription: recording → transcript → draft → doctor edits → issue.
 * Consultation and prescription live together because they are one flow and
 * share the same `appointments/:id` routes.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Appointment,
      Doctor,
      ConsultationSession,
      EPrescription,
      EPrescriptionMedicine,
      AiTrainingSample,
    ]),
    MedicinesModule,
    NotificationsModule,
  ],
  controllers: [ConsultationsController],
  providers: [ConsultationsService, PrescriptionsService, PrescriptionPdfService],
  exports: [PrescriptionsService],
})
export class ConsultationsModule {}
