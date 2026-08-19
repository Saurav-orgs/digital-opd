import { Global, Module } from '@nestjs/common';
import { AiClientService } from './ai-client.service';

/**
 * Access to the local inference sidecar (ai-OPD). Global because reports,
 * consultations and prescriptions all need it and none of them own it.
 */
@Global()
@Module({
  providers: [AiClientService],
  exports: [AiClientService],
})
export class AiModule {}
