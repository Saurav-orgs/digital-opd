import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { UniqueConstraintError } from 'sequelize';
import { Invoice, InvoiceBuyer, InvoiceIssuer } from '../database/models/invoice.model';
import { Subscription } from '../database/models/subscription.model';
import { User } from '../database/models/user.model';
import { Doctor } from '../database/models/doctor.model';
import { SettingsService } from '../settings/settings.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/** One row of the doctor's invoice list. */
export interface InvoiceView {
  id: string;
  invoiceNo: string;
  issuedAt: Date;
  planCode: string;
  planName: string;
  months: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  currency: string;
  baseAmount: number;
  gstRate: number;
  gstAmount: number;
  totalAmount: number;
  orderId: string | null;
  paymentId: string | null;
  /** The account it was raised for — only the super admin's list shows it. */
  account?: { userId: string; email: string; name: string };
}

/**
 * India's financial year for a date: April 2026 → March 2027 is `2026-27`.
 * The invoice series restarts with it, which is what every accountant and
 * every GST return expects.
 */
export function financialYear(d: Date): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1; // months are 0-based; 3 = April
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Invoices for paid subscriptions: raising them, numbering them, and handing
 * them back.
 *
 * An invoice is raised once, by {@link issueFor}, at the moment a payment is
 * confirmed — never on demand, because a document that is regenerated is a
 * document whose number and contents can quietly change. Everything the page
 * prints is copied into the row at that moment.
 *
 * Nothing is raised for a granted plan: no money changed hands, so there is
 * nothing to invoice, and printing a zero-rupee tax invoice would be wrong.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectModel(Invoice) private readonly invoiceModel: typeof Invoice,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Raise the invoice for a subscription that has just been paid.
   *
   * Idempotent: `subscription_id` is unique, so a webhook and a status poll
   * that both land return the same invoice rather than two numbers for one
   * payment. Returns null when there is nothing to invoice.
   */
  async issueFor(subscription: Subscription, planName: string): Promise<Invoice | null> {
    if (Number(subscription.total_amount) <= 0) return null;

    const existing = await this.invoiceModel.findOne({
      where: { subscription_id: subscription.id },
    });
    if (existing) return existing;

    const user = await this.userModel.findByPk(subscription.user_id, {
      include: [
        {
          model: Doctor,
          attributes: ['id', 'name', 'contact_mobile', 'clinic_name', 'clinic_address'],
          required: false,
        },
      ],
    });
    if (!user) return null;

    const s = this.settings.invoiceIssuer();
    const issuer: InvoiceIssuer = {
      name: s.name,
      address: s.address,
      gstin: s.gstin,
      pan: s.pan,
      state: s.state,
      email: s.email,
      phone: s.phone,
    };
    const doctor = user.doctor;
    const buyer: InvoiceBuyer = {
      // A doctor who paid before setting their practice up has no clinic name
      // yet; the mailbox name the account was opened with stands in for it.
      name: doctor?.name ?? user.name,
      email: user.email,
      mobile: doctor?.contact_mobile ?? null,
      gstin: null,
      address: doctor?.clinic_address ?? null,
      placeOfSupply: null,
    };

    const issuedAt = subscription.paid_at ?? new Date();
    const fy = financialYear(issuedAt);

    // Two payments confirmed in the same instant would race for a number, so
    // the collision is simply retried against a freshly read maximum. The
    // unique index on (fy, seq) is what makes that safe.
    for (let attempt = 0; attempt < 5; attempt++) {
      const seq = (await this.invoiceModel.max<number, Invoice>('seq', { where: { fy } })) || 0;
      const next = Number(seq) + 1;
      try {
        return await this.invoiceModel.create({
          invoice_no: `${s.prefix}/${fy}/${String(next).padStart(4, '0')}`,
          fy,
          seq: next,
          subscription_id: subscription.id,
          user_id: subscription.user_id,
          doctor_id: subscription.doctor_id ?? doctor?.id ?? null,
          issued_at: issuedAt,
          plan_code: subscription.plan_id,
          plan_name: planName,
          months: subscription.months,
          period_start: subscription.starts_at,
          period_end: subscription.ends_at,
          currency: subscription.currency || 'INR',
          base_amount: subscription.base_amount,
          gst_rate: subscription.gst_rate,
          gst_amount: subscription.gst_amount,
          total_amount: subscription.total_amount,
          cf_order_id: subscription.cf_order_id,
          cf_payment_id: subscription.cf_payment_id,
          issuer,
          buyer,
        } as any);
      } catch (err) {
        if (err instanceof UniqueConstraintError) {
          // Either the number was taken, or the invoice for this subscription
          // was raised by the other confirmation a moment ago.
          const raced = await this.invoiceModel.findOne({
            where: { subscription_id: subscription.id },
          });
          if (raced) return raced;
          continue;
        }
        throw err;
      }
    }
    this.logger.error(`Could not allocate an invoice number for ${subscription.cf_order_id}.`);
    return null;
  }

  /** The signed-in doctor's own invoices, newest first. */
  async listForUser(userId: string): Promise<InvoiceView[]> {
    const rows = await this.invoiceModel.findAll({
      where: { user_id: userId },
      order: [['issued_at', 'DESC']],
    });
    return rows.map((r) => this.toView(r));
  }

  /** Every invoice on the platform — the super admin's list. */
  async listAll(limit = 500): Promise<InvoiceView[]> {
    const rows = await this.invoiceModel.findAll({
      include: [{ model: User, attributes: ['id', 'email', 'name'], required: false }],
      order: [['issued_at', 'DESC']],
      limit,
    });
    return rows.map((r) => ({
      ...this.toView(r),
      account: { userId: r.user_id, email: r.user?.email ?? '', name: r.user?.name ?? '' },
    }));
  }

  /**
   * One invoice, for downloading. `userId` scopes it to its owner; the super
   * admin passes null and may fetch anyone's.
   */
  async findOne(id: string, userId: string | null): Promise<Invoice> {
    const row = await this.invoiceModel.findByPk(id);
    if (!row || (userId && row.user_id !== userId)) {
      throw new AppException(ErrorCode.NOT_FOUND, { message: 'Unknown invoice.' });
    }
    return row;
  }

  toView(r: Invoice): InvoiceView {
    return {
      id: r.id,
      invoiceNo: r.invoice_no,
      issuedAt: r.issued_at,
      planCode: r.plan_code,
      planName: r.plan_name,
      months: r.months,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      currency: r.currency,
      baseAmount: Number(r.base_amount),
      gstRate: Number(r.gst_rate),
      gstAmount: Number(r.gst_amount),
      totalAmount: Number(r.total_amount),
      orderId: r.cf_order_id,
      paymentId: r.cf_payment_id,
    };
  }
}
