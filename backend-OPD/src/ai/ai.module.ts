import { Global, Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { AiClientService } from './ai-client.service';
import { AiUsageService } from './ai-usage.service';
import { AiUsageEvent } from '../database/models/ai-usage-event.model';
import { Appointment } from '../database/models/appointment.model';

/**
 * Access to the local inference sidecar (ai-OPD), and the record of what it
 * cost. Global because reports, consultations and prescriptions all need it
 * and none of them own it.
 */
@Global()
@Module({
  imports: [SequelizeModule.forFeature([AiUsageEvent, Appointment])],
  providers: [AiClientService, AiUsageService],
  exports: [AiClientService, AiUsageService],
})
export class AiModule {}
