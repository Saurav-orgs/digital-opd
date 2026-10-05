import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { PrescriptionTemplatesService } from './prescription-templates.service';
import { PrescriptionTemplatesController } from './prescription-templates.controller';
import { PrescriptionTemplate } from '../database/models/prescription-template.model';
import { PrescriptionTemplateMedicine } from '../database/models/prescription-template-medicine.model';
import { PrescriptionTemplateUsage } from '../database/models/prescription-template-usage.model';
import { Appointment } from '../database/models/appointment.model';
import { ConsultationsModule } from '../consultations/consultations.module';

/**
 * Saved prescriptions the doctor applies to a visit.
 *
 * Imports `ConsultationsModule` for `PrescriptionsService`: applying a
 * template writes a prescription draft, and that write already has an owner —
 * the access check, the "not once issued" rule, medicine replacement and the
 * response shape all live there. This module decides *what* to fill in; it
 * does not get its own opinion about how a prescription is saved.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      PrescriptionTemplate,
      PrescriptionTemplateMedicine,
      PrescriptionTemplateUsage,
      Appointment,
    ]),
    ConsultationsModule,
  ],
  controllers: [PrescriptionTemplatesController],
  providers: [PrescriptionTemplatesService],
  exports: [PrescriptionTemplatesService],
})
export class PrescriptionTemplatesModule {}
