import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  WhatsAppMessage,
  WhatsAppMessageStatus,
  WhatsAppStatusEntry,
} from '../database/models/whatsapp-message.model';

interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  countryCode: string;
  otpTemplate: string;
  otpTemplateLang: string;
}

/** One `statuses[]` item from Meta's messages webhook. */
export interface WebhookStatus {
  id: string;
  status: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: unknown }>;
  [key: string]: unknown;
}

/** Meta's delivery states, in the order they happen. Anything later never regresses. */
const STATUS_RANK: Record<string, number> = {
  queued: 0,
  accepted: 1,
  error: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5,
};

/**
 * Outgoing WhatsApp, over Meta's Cloud API.
 *
 * Every send is a row in `whatsapp_messages` — what was sent (OTP masked),
 * what Meta answered, and afterwards each delivery status Meta pushes to
 * the webhook. That row is the audit trail for "the patient never got the
 * code": the log line alone does not survive a restart.
 *
 * With no `WA_ACCESS_TOKEN` there is no sender: the code is written to the
 * log instead, the same way `MailService` behaves without SMTP, so a fresh
 * checkout can walk through patient registration end to end. Those sends
 * are recorded too, as `accepted` with a `local:` id, so the table reads
 * the same in development.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly cfg: WhatsAppConfig;
  private readonly isProduction: boolean;

  constructor(
    config: ConfigService,
    @InjectModel(WhatsAppMessage)
    private readonly messages: typeof WhatsAppMessage,
  ) {
    this.isProduction = config.get<string>('env') === 'production';
    this.cfg = config.get('whatsapp') as WhatsAppConfig;
    if (!this.enabled) {
      this.logger.warn(
        'WA_ACCESS_TOKEN / WA_PHONE_NUMBER_ID not set — WhatsApp OTPs will be logged, not sent.',
      );
    }
  }

  /** Whether messages actually leave this server. */
  get enabled(): boolean {
    return !!(this.cfg.accessToken && this.cfg.phoneNumberId);
  }

  /**
   * Send the sign-up code through the approved AUTHENTICATION template.
   *
   * Meta's authentication templates carry the code twice: once as the body's
   * `{{1}}` and once as the parameter of the Copy Code button (index 0). A
   * send that omits the button component is rejected with a 132000-class
   * error, so both are always present.
   */
  async sendOtp(mobile: string, code: string, reference?: string): Promise<void> {
    const to = `${this.cfg.countryCode}${mobile}`;
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: this.cfg.otpTemplate,
        language: { code: this.cfg.otpTemplateLang },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    };

    const row = await this.messages.create({
      kind: 'otp',
      to,
      template: this.cfg.otpTemplate,
      language: this.cfg.otpTemplateLang,
      status: 'queued',
      request: maskCode(body, code),
      reference: reference ?? null,
    } as any);

    if (!this.enabled) {
      this.logger.log(`[whatsapp → ${to}] verification code ${code}`);
      await row.update({
        status: 'accepted',
        status_at: new Date(),
        wa_message_id: `local:${row.id}`,
        response: { logged: true },
      } as any);
      return;
    }

    const url = `https://graph.facebook.com/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`WhatsApp send to ${to} failed: ${message}`);
      await row.update({
        status: 'error',
        status_at: new Date(),
        error_message: message,
        response: { network_error: message },
      } as any);
      throw this.sendFailed();
    }

    const text = await res.text().catch(() => '');
    const json = parseJson(text);

    if (!res.ok) {
      // Meta's error body names the real cause (bad token, unapproved
      // template, number not on WhatsApp) — keep it whole in the log and the row.
      this.logger.error(`WhatsApp send to ${to} failed (${res.status}): ${text}`);
      const error = (json?.error ?? {}) as { code?: number; message?: string };
      await row.update({
        status: 'error',
        status_at: new Date(),
        error_code: typeof error.code === 'number' ? error.code : null,
        error_message: error.message ?? `HTTP ${res.status}`,
        response: json ?? { http_status: res.status, body: text },
      } as any);
      throw this.sendFailed(error.code);
    }

    const waId = (json?.messages as Array<{ id?: string }> | undefined)?.[0]?.id ?? null;
    await row.update({
      status: 'accepted',
      status_at: new Date(),
      wa_message_id: waId,
      response: json ?? { body: text },
    } as any);
    this.logger.log(`Sent verification code to ${to} over WhatsApp (${waId ?? 'no id'}).`);
  }

  /**
   * A delivery status from Meta's webhook. Each one is appended to the
   * message's `status_log` verbatim; `status` itself only moves forward, so
   * a late `sent` arriving after `delivered` does not wind it back. A status
   * for a message we never sent (or one older than this table) is logged
   * and dropped — there is nothing to attach it to.
   */
  async recordStatus(update: WebhookStatus): Promise<void> {
    const row = await this.messages.findOne({ where: { wa_message_id: update.id } });
    const at = update.timestamp
      ? new Date(Number(update.timestamp) * 1000).toISOString()
      : new Date().toISOString();
    if (!row) {
      this.logger.warn(`WhatsApp status "${update.status}" for unknown message ${update.id}.`);
      return;
    }

    const entry: WhatsAppStatusEntry = {
      status: update.status,
      at,
      ...(update.errors ? { errors: update.errors } : {}),
      raw: update,
    };
    const patch: Partial<WhatsAppMessage> = {
      status_log: [...(row.status_log ?? []), entry],
    };

    const incoming = STATUS_RANK[update.status];
    const current = STATUS_RANK[row.status] ?? 0;
    if (incoming !== undefined && incoming >= current) {
      patch.status = update.status as WhatsAppMessageStatus;
      patch.status_at = new Date(at);
    }
    if (update.status === 'failed' && update.errors?.length) {
      const first = update.errors[0];
      patch.error_code = typeof first.code === 'number' ? first.code : null;
      patch.error_message = first.message ?? first.title ?? null;
      this.logger.error(
        `WhatsApp message ${update.id} to ${row.to} failed: ${JSON.stringify(update.errors)}`,
      );
    } else {
      this.logger.log(`WhatsApp message ${update.id} to ${row.to}: ${update.status}.`);
    }
    await row.update(patch as any);
  }

  /**
   * A handful of Meta's codes are worth telling apart: a number that is not
   * on WhatsApp is the patient's to fix, everything else is ours. The
   * sandbox one is spelled out because it is the first wall every deployment
   * hits — the test sender only reaches numbers on its allowed list.
   */
  private sendFailed(code?: number): AppException {
    let message =
      'We could not send the WhatsApp message right now. Please try again in a moment.';
    if (code === 131026) {
      message = 'This number does not seem to be on WhatsApp. Please use a WhatsApp number.';
    } else if (code === 131030) {
      message = this.isProduction
        ? 'WhatsApp is not fully set up for this clinic yet. Please try again later.'
        : 'WhatsApp is in test mode: add this number to the allowed recipients in the Meta app dashboard.';
    } else if (code === 132001 || code === 132000 || code === 132012) {
      message = this.isProduction
        ? 'WhatsApp is not fully set up for this clinic yet. Please try again later.'
        : 'The WhatsApp OTP template is missing or does not match — check WA_OTP_TEMPLATE_NAME / LANG.';
    }
    return new AppException(ErrorCode.INTERNAL_ERROR, { message });
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** The request as sent, with every occurrence of the code replaced — the OTP never hits the DB. */
function maskCode(body: unknown, code: string): Record<string, unknown> {
  return JSON.parse(JSON.stringify(body).split(JSON.stringify(code).slice(1, -1)).join('******'));
}
