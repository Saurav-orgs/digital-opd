import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { CashfreeService } from './cashfree.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Cashfree's payment webhook.
 *
 * Mounted at `/payment/webhook` *outside* the API prefix (main.ts excludes
 * it) because that is the URL registered in the Cashfree dashboard.
 *
 * Every call is signed over the raw bytes. One whose signature does not match
 * is **recorded and not acted on** rather than dropped silently: an unsigned
 * call is either a misconfigured dashboard or somebody probing, and both are
 * worth seeing in the payment log. The answer is still 200 — Cashfree retries
 * until it gets one, and a forged call should not learn anything from the
 * status code either.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('payment/webhook')
export class PaymentWebhookController {
  private readonly logger = new Logger(PaymentWebhookController.name);

  constructor(
    private readonly cashfree: CashfreeService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Post()
  @HttpCode(200)
  @RawResponse()
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Headers('x-webhook-timestamp') timestamp: string | undefined,
    @Body() body: any,
  ): Promise<{ ok: true }> {
    const signatureValid = this.cashfree.webhookSignatureOk(req.rawBody, signature, timestamp);
    if (!signatureValid) {
      this.logger.warn('Cashfree webhook with a bad or missing signature — recorded, not applied.');
    }
    await this.subscriptions.handleWebhook(body, signatureValid).catch((err) =>
      // Logged, not thrown: a 5xx would make Cashfree resend the same event.
      this.logger.error(`Webhook ${body?.type} failed: ${err?.message}`),
    );
    return { ok: true };
  }
}
