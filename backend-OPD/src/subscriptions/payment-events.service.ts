import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, WhereOptions } from 'sequelize';
import { PaymentEvent } from '../database/models/payment-event.model';
import { Subscription } from '../database/models/subscription.model';
import { User } from '../database/models/user.model';
import { Doctor } from '../database/models/doctor.model';
import { QueryPaymentEventsDto } from './dto/query-payment-events.dto';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { PaymentEventSource, UserType } from '../common/enums';

export interface RecordEventInput {
  source: PaymentEventSource;
  event_type: string;
  subscription_id?: string | null;
  user_id?: string | null;
  doctor_id?: string | null;
  status?: string | null;
  cf_order_id?: string | null;
  cf_payment_id?: string | null;
  amount?: string | number | null;
  signature_valid?: boolean | null;
  /** True when this event is what actually moved the subscription. */
  applied?: boolean;
  message?: string | null;
  payload?: unknown;
}

/**
 * The payment audit trail: written by the webhook, the status poll and the
 * admin actions, read by the super admin and — for their own rows — by the
 * doctor.
 *
 * Writing never throws into the caller. A webhook that cannot be logged must
 * still be answered 200, or Cashfree will resend it forever; a payment that
 * cannot be logged must still be credited to the doctor who made it. The
 * failure goes to the application log instead.
 */
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(
    @InjectModel(PaymentEvent) private readonly model: typeof PaymentEvent,
  ) {}

  async record(input: RecordEventInput): Promise<void> {
    try {
      await this.model.create({
        source: input.source,
        event_type: input.event_type,
        subscription_id: input.subscription_id ?? null,
        user_id: input.user_id ?? null,
        doctor_id: input.doctor_id ?? null,
        status: input.status ?? null,
        cf_order_id: input.cf_order_id ?? null,
        cf_payment_id: input.cf_payment_id ?? null,
        amount:
          input.amount === undefined || input.amount === null
            ? null
            : Number(input.amount).toFixed(2),
        signature_valid: input.signature_valid ?? null,
        applied: input.applied ?? false,
        message: input.message ?? null,
        // Cashfree bodies are small, but a runaway payload must not make the
        // row unwritable, so anything unreasonable is dropped rather than stored.
        payload: this.safePayload(input.payload),
      } as any);
    } catch (err: any) {
      this.logger.error(
        `Could not record payment event ${input.event_type} (${input.cf_order_id ?? 'no order'}): ${err?.message}`,
      );
    }
  }

  /**
   * The log screen. A super admin sees everything; a doctor sees only the
   * events for their own clinic, and that scope is not overridable by a query
   * parameter.
   */
  async list(query: QueryPaymentEventsDto, user: AuthUser) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: WhereOptions = {};

    if (user.type !== UserType.SUPER_ADMIN) {
      // Rows from before the tenant existed are keyed by user, not doctor,
      // so a doctor's own sign-up payments are matched either way.
      (where as any)[Op.or] = [{ doctor_id: user.doctorId }, { user_id: user.id }];
    }
    if (query.source) (where as any).source = query.source;
    if (query.subscription_id) (where as any).subscription_id = query.subscription_id;
    if (query.doctor_id && user.type === UserType.SUPER_ADMIN) {
      (where as any).doctor_id = query.doctor_id;
    }
    if (query.cf_order_id) (where as any).cf_order_id = query.cf_order_id;
    if (query.from || query.to) {
      const range: Record<symbol, Date> = {};
      if (query.from) range[Op.gte] = new Date(`${query.from}T00:00:00.000Z`);
      // Inclusive: a `to` of the 30th must cover that whole day.
      if (query.to) range[Op.lte] = new Date(`${query.to}T23:59:59.999Z`);
      (where as any).createdAt = range;
    }

    const { rows, count } = await this.model.findAndCountAll({
      where,
      include: [
        { model: User, attributes: ['id', 'email', 'name'], required: false },
        { model: Doctor, attributes: ['id', 'name'], required: false },
        {
          model: Subscription,
          attributes: ['id', 'plan_id', 'total_amount', 'status'],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    return {
      items: rows.map((r) => ({
        id: r.id,
        at: r.get('createdAt') as Date,
        source: r.source,
        eventType: r.event_type,
        status: r.status,
        applied: r.applied,
        signatureValid: r.signature_valid,
        orderId: r.cf_order_id,
        paymentId: r.cf_payment_id,
        amount: r.amount === null ? null : Number(r.amount),
        message: r.message,
        doctor: r.doctor ? { id: r.doctor.id, name: r.doctor.name } : null,
        user: r.user ? { id: r.user.id, email: r.user.email, name: r.user.name } : null,
        plan: r.subscription?.plan_id ?? null,
        subscriptionId: r.subscription_id,
        // The raw body is for the super admin only — it is Cashfree's payload,
        // not something a clinic account needs to see.
        payload: user.type === UserType.SUPER_ADMIN ? r.payload : undefined,
      })),
      total: count,
      page,
      limit,
      pages: Math.ceil(count / limit) || 1,
    };
  }

  private safePayload(payload: unknown): unknown | null {
    if (payload === undefined || payload === null) return null;
    try {
      const json = JSON.stringify(payload);
      return json.length > 64_000 ? { truncated: true, bytes: json.length } : payload;
    } catch {
      return null;
    }
  }
}
