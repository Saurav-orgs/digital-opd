import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { WebhookStatus, WhatsAppService } from './whatsapp.service';

/**
 * Meta's webhook for the WhatsApp Business account.
 *
 * Two calls. The GET is Meta checking, once, that this URL is ours: it must
 * echo `hub.challenge` as a bare string, which is why the envelope is off.
 * The POST is every event afterwards; the only ones this server acts on are
 * delivery statuses, which it writes onto the matching `whatsapp_messages`
 * row. Anything else (inbound replies, template reviews) is acknowledged
 * and ignored — Meta retries an event until it gets a 200, so unhandled
 * must still mean 200.
 *
 * Every POST is signed with the app secret; one that is not is dropped.
 * Outside production a missing secret is allowed through with a warning so
 * a tunnel to a developer machine can be tested against the real webhook.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);
  private readonly verifyToken: string;
  private readonly appSecret: string;
  private readonly isProduction: boolean;

  constructor(
    config: ConfigService,
    private readonly whatsapp: WhatsAppService,
  ) {
    const wa = config.get('whatsapp') as { verifyToken: string; appSecret: string };
    this.verifyToken = wa.verifyToken;
    this.appSecret = wa.appSecret;
    this.isProduction = config.get<string>('env') === 'production';
  }

  @Get()
  @RawResponse()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && this.verifyToken && token === this.verifyToken) {
      this.logger.log('WhatsApp webhook verified by Meta.');
      return challenge;
    }
    throw new ForbiddenException('Webhook verification failed.');
  }

  @Post()
  @HttpCode(200)
  @RawResponse()
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: any,
  ): Promise<string> {
    if (!this.signatureOk(req.rawBody, signature)) {
      this.logger.warn('WhatsApp webhook POST with a bad or missing signature — dropped.');
      throw new ForbiddenException('Bad signature.');
    }

    const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};
        for (const status of (value.statuses ?? []) as WebhookStatus[]) {
          if (status?.id && status?.status) {
            await this.whatsapp.recordStatus(status).catch((err) =>
              // One bad row must not make Meta retry the whole batch forever.
              this.logger.error(`Could not record status for ${status.id}: ${err.message}`),
            );
          }
        }
        if (value.messages?.length) {
          this.logger.log(`WhatsApp inbound message from ${value.messages[0]?.from} ignored.`);
        }
      }
    }
    return 'OK';
  }

  private signatureOk(raw: Buffer | undefined, header: string | undefined): boolean {
    if (!this.appSecret) {
      if (this.isProduction) return false;
      this.logger.warn('WA_APP_SECRET not set — accepting unsigned WhatsApp webhook (dev only).');
      return true;
    }
    if (!raw || !header?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', this.appSecret).update(raw).digest('hex');
    const given = header.slice('sha256='.length);
    return (
      expected.length === given.length &&
      timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(given, 'utf8'))
    );
  }
}
