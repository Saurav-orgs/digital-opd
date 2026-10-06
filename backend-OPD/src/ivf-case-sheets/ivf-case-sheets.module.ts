import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import { IvfCaseSheet } from '../database/models/ivf-case-sheet.model';
import { IvfCaseSheetTemplate } from '../database/models/ivf-case-sheet-template.model';
import { EPrescription } from '../database/models/e-prescription.model';
import { IvfCaseSheetsService } from './ivf-case-sheets.service';
import { IvfCaseSheetsController } from './ivf-case-sheets.controller';
import { IvfCaseSheetPdfService } from './ivf-case-sheet-pdf.service';
import { IvfCaseSheetTemplatesService } from './ivf-case-sheet-templates.service';
import { IvfCaseSheetTemplatesController } from './ivf-case-sheet-templates.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { DoctorsModule } from '../doctors/doctors.module';

/**
 * The IVF case-sheet: a per-appointment intake/investigations document for
 * IVF & Fertility doctors, and the templates they save. Draft → issue →
 * PDF-on-letterhead → notify, the prescription lifecycle with a different body.
 * It reuses `StorageService` (global) and `NotificationsService`; the PDF
 * header and footer are the shared pad furniture in `prescription-pdf.layout`.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Appointment,
      Doctor,
      IvfCaseSheet,
      IvfCaseSheetTemplate,
      // Read-only, and only to refuse writing a case-sheet for a visit whose
      // handwritten/typed prescription is already issued.
      EPrescription,
    ]),
    NotificationsModule,
    // The sheet's footer prints the doctor's booking QR, and the URL it
    // encodes has one definition — `DoctorsService.bookingUrl`. Same reason
    // the prescription's module imports this one.
    DoctorsModule,
  ],
  controllers: [IvfCaseSheetsController, IvfCaseSheetTemplatesController],
  providers: [
    IvfCaseSheetsService,
    IvfCaseSheetTemplatesService,
    IvfCaseSheetPdfService,
  ],
  exports: [IvfCaseSheetsService],
})
export class IvfCaseSheetsModule {}
