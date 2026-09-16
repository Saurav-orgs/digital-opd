import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail.service';

/** Global: auth and doctors both send mail, and neither should have to import it. */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
