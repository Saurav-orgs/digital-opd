import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { WhatsAppMessage } from '../database/models/whatsapp-message.model';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';

/** Global, like MailModule: any module that needs to message a patient can inject it. */
@Global()
@Module({
  imports: [ConfigModule, SequelizeModule.forFeature([WhatsAppMessage])],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
