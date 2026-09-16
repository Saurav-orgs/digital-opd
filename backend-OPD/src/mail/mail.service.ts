import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback; derived from `html` when omitted. */
  text?: string;
}

/**
 * Outgoing email, over the clinic's SMTP account.
 *
 * Two flows use it — the code that verifies an email at sign-up and the
 * link that resets a password — and both are worthless if the message
 * silently fails, so a send that throws is logged in full and surfaced to
 * the caller rather than swallowed.
 *
 * With no `MAIL_USER` configured there is no transport: the message is
 * written to the log instead. That is the developer's inbox, and it means a
 * fresh checkout can walk through registration without an SMTP account.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null;
  private readonly from: string;
  private readonly isProduction: boolean;

  constructor(config: ConfigService) {
    this.isProduction = config.get<string>('env') === 'production';
    const mail = config.get('mail') as {
      host: string;
      port: number;
      secure: boolean;
      user: string;
      pass: string;
      from: string;
    };
    this.from = mail.from;
    this.transporter = mail.user
      ? nodemailer.createTransport({
          host: mail.host,
          port: mail.port,
          secure: mail.secure,
          auth: { user: mail.user, pass: mail.pass },
          connectionTimeout: 30_000,
        })
      : null;
    if (!this.transporter) {
      this.logger.warn('MAIL_USER is not set — emails will be logged, not sent.');
    }
  }

  /**
   * Try the SMTP login once at start. Outside production a bad password
   * drops to log mode with a loud warning, so a developer with placeholder
   * credentials still gets working sign-up and reset flows (the code is in
   * the log). In production it stays broken and says so on every send —
   * silently not mailing a doctor their reset link is worse than an error.
   */
  async onModuleInit(): Promise<void> {
    if (!this.transporter) return;
    try {
      await this.transporter.verify();
      this.logger.log(`SMTP ready as ${this.from}.`);
    } catch (err) {
      const why = (err as Error).message.split('\n')[0];
      if (this.isProduction) {
        this.logger.error(`SMTP login failed: ${why}`);
      } else {
        this.logger.warn(`SMTP login failed (${why}) — emails will be logged, not sent.`);
        this.transporter = null;
      }
    }
  }

  /** Whether messages actually leave this server. */
  get enabled(): boolean {
    return this.transporter !== null;
  }

  async send(msg: MailMessage): Promise<void> {
    const text = msg.text ?? htmlToText(msg.html);
    if (!this.transporter) {
      this.logger.log(`[mail → ${msg.to}] ${msg.subject}\n${text}`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text,
      });
    } catch (err) {
      this.logger.error(`Could not send "${msg.subject}" to ${msg.to}: ${(err as Error).message}`);
      throw new AppException(ErrorCode.INTERNAL_ERROR, {
        message: 'We could not send the email right now. Please try again in a moment.',
      });
    }
    this.logger.log(`Sent "${msg.subject}" to ${msg.to}.`);
  }
}

/** Good enough for the two short messages this sends: tags out, entities back. */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
