import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Subscription } from '../database/models/subscription.model';
import { Plan } from '../database/models/plan.model';
import { User } from '../database/models/user.model';
import { Doctor } from '../database/models/doctor.model';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { paymentReceivedEmail, planGrantedEmail } from '../mail/templates';
import { ActivityLogService } from '../activity/activity-log.service';
import { CashfreeService, CashfreePayment } from './cashfree.service';
import { SubscriptionAccessService } from './subscription-access.service';
import { PaymentEventsService } from './payment-events.service';
import { PlansService, cycleEnd } from './plans.service';
import { CreateAccountDto, ResumeSignupDto } from './dto/signup.dto';
import { CancelSubscriptionDto, GrantSubscriptionDto } from './dto/grant.dto';
import { QuerySubscriptionsDto } from './dto/query-subscriptions.dto';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  ActivityAction,
  ActivityActor,
  PaymentEventSource,
  SubscriptionStatus,
  UserType,
} from '../common/enums';

/** What the landing page needs to open the Cashfree checkout. */
export interface CheckoutSession {
  orderId: string;
  paymentSessionId: string;
  env: 'sandbox' | 'production';
  plan: string;
  amount: { base: number; gstRate: number; gst: number; total: number };
}

export interface OrderStatusView {
  orderId: string;
  status: SubscriptionStatus;
  plan: string;
  planName: string;
  total: number;
  email: string;
  endsAt: Date | null;
  loginUrl: string;
}

/** One row of the super admin's "who is on what plan" list. */
export interface SubscriptionView {
  id: string;
  status: SubscriptionStatus;
  planCode: string;
  planName: string;
  months: number;
  baseAmount: number;
  gstAmount: number;
  totalAmount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  paidAt: Date | null;
  orderId: string;
  paymentId: string | null;
  /** True when a super admin gave this out rather than it being paid online. */
  granted: boolean;
  grantNote: string | null;
  account: { userId: string; email: string; name: string };
  doctor: { id: string; name: string; specialization: string | null } | null;
}

/**
 * The paid sign-up, from "verified email" to "may sign in", plus the
 * super admin's control over who holds what.
 *
 * The account (a `users` row) is created *before* payment so the doctor's
 * chosen password is never held anywhere but the users table, and so an
 * abandoned checkout can be resumed with the same email and password
 * instead of a second sign-up. What the account cannot do before paying is
 * sign in — `SubscriptionAccessService` refuses it.
 *
 * Nothing about the clinic exists yet: `doctor_id` stays null until the
 * doctor's first sign-in, where the admin app collects the profile and
 * `DoctorsService.setupForUser` builds the tenant.
 *
 * Every step that touches money writes a `payment_events` row — see
 * {@link PaymentEventsService}.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly landingBase: string;
  private readonly adminBase: string;

  constructor(
    @InjectModel(Subscription) private readonly subscriptionModel: typeof Subscription,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly sequelize: Sequelize,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly activity: ActivityLogService,
    private readonly cashfree: CashfreeService,
    private readonly access: SubscriptionAccessService,
    private readonly plans: PlansService,
    private readonly events: PaymentEventsService,
    config: ConfigService,
  ) {
    this.landingBase = config.get<string>('landingWebBase')!;
    this.adminBase = config.get<string>('adminWebBase')!;
  }

  /**
   * Open the account and the first order. The email must have passed the
   * one-time code (`/auth/email-verification/confirm`) moments ago.
   */
  async createAccount(dto: CreateAccountDto): Promise<CheckoutSession> {
    const email = dto.email.toLowerCase();
    const plan = await this.plans.findSellable(dto.plan);
    await this.auth.assertEmailVerified(email);

    if (await this.userModel.findOne({ where: { email }, paranoid: false })) {
      throw new AppException(ErrorCode.CONFLICT, {
        message: 'An account with this email already exists. Sign in to continue.',
      });
    }

    const user = await this.userModel.create({
      // The real name arrives with the profile on first sign-in; until then
      // the mailbox name keeps activity rows readable.
      name: email.split('@')[0],
      email,
      password_hash: await bcrypt.hash(dto.password, 10),
      type: UserType.DOCTOR,
      role_id: null,
      doctor_id: null,
      is_active: true,
      subscription_required: true,
    } as any);
    await this.auth.markEmailVerificationUsed(email);

    this.activity.record({
      action: ActivityAction.DOCTOR_SIGNUP_STARTED,
      actor_type: ActivityActor.USER,
      actor_id: user.id,
      actor_label: email,
      summary: `${email} opened an account on the ${plan.name} plan; payment pending.`,
      entity_type: 'user',
      entity_id: user.id,
      metadata: { plan: plan.code },
    });

    return this.openOrder(user, plan, dto.mobile);
  }

  /**
   * The same email and password, a new order. For a doctor who closed the
   * checkout tab, or whose payment failed — and for a renewal later on.
   */
  async resume(dto: ResumeSignupDto): Promise<CheckoutSession> {
    const plan = await this.plans.findSellable(dto.plan);
    const user = await this.users.findForAuth(dto.email);
    if (!user || !(await bcrypt.compare(dto.password, user.password_hash))) {
      throw new AppException(ErrorCode.INVALID_CREDENTIALS);
    }
    if (!user.subscription_required) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'This account does not use online plans. Please sign in directly.',
      });
    }
    if (await this.access.activeFor(user.id)) {
      throw new AppException(ErrorCode.CONFLICT, {
        message: 'This account already has an active plan. Please sign in.',
      });
    }
    return this.openOrder(user, plan, dto.mobile);
  }

  /**
   * Where an order stands. Asked by the page Cashfree returns the doctor to,
   * which polls it until the answer is final. A `pending` row is re-checked
   * against Cashfree on every ask, so a webhook that never arrived (tunnel
   * down, dashboard misconfigured) still cannot leave a paid doctor locked out.
   */
  async orderStatus(orderId: string): Promise<OrderStatusView> {
    let row = await this.subscriptionModel.findOne({
      where: { cf_order_id: orderId },
      include: [
        { model: User, attributes: ['id', 'email'] },
        { model: Plan, attributes: ['id', 'name'], required: false },
      ],
    });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, { message: 'Unknown order.' });

    if (row.status === SubscriptionStatus.PENDING) {
      row = (await this.reconcile(row)) ?? row;
    }
    return {
      orderId: row.cf_order_id,
      status: row.status,
      plan: row.plan_id,
      planName: row.plan?.name ?? row.plan_id,
      total: Number(row.total_amount),
      email: row.user?.email ?? '',
      endsAt: row.ends_at,
      loginUrl: `${this.adminBase}/login`,
    };
  }

  /** Cashfree's webhook. Returns quickly; anything unknown is acknowledged and ignored. */
  async handleWebhook(payload: any, signatureValid: boolean): Promise<void> {
    const type: string = payload?.type ?? 'UNKNOWN_WEBHOOK';
    const orderId: string | undefined = payload?.data?.order?.order_id;
    const payment: CashfreePayment | undefined = payload?.data?.payment;

    const row = orderId
      ? await this.subscriptionModel.findOne({ where: { cf_order_id: orderId } })
      : null;

    // Recorded before anything is decided, and recorded even when the order
    // is unknown or the signature was wrong — those are precisely the events
    // worth being able to look at afterwards.
    await this.events.record({
      source: PaymentEventSource.WEBHOOK,
      event_type: type,
      subscription_id: row?.id ?? null,
      user_id: row?.user_id ?? null,
      doctor_id: row?.doctor_id ?? null,
      status: row?.status ?? null,
      cf_order_id: orderId ?? null,
      cf_payment_id: payment?.cf_payment_id != null ? String(payment.cf_payment_id) : null,
      amount: payment?.payment_amount ?? null,
      signature_valid: signatureValid,
      applied: false,
      message: !signatureValid
        ? 'Signature did not match — the event was recorded but not acted on.'
        : !orderId
          ? 'Webhook carried no order id.'
          : !row
            ? `No subscription for order ${orderId} — ignored.`
            : `${type} received for ${orderId}.`,
      payload,
    });

    if (!signatureValid || !row) return;

    if (type === 'PAYMENT_SUCCESS_WEBHOOK' || payment?.payment_status === 'SUCCESS') {
      await this.activate(row, payment ?? null, PaymentEventSource.WEBHOOK, type);
    } else if (type === 'PAYMENT_FAILED_WEBHOOK' || payment?.payment_status === 'FAILED') {
      if (row.status === SubscriptionStatus.PENDING) {
        await row.update({ status: SubscriptionStatus.FAILED } as any);
        await this.events.record({
          source: PaymentEventSource.WEBHOOK,
          event_type: type,
          subscription_id: row.id,
          user_id: row.user_id,
          doctor_id: row.doctor_id,
          status: SubscriptionStatus.FAILED,
          cf_order_id: row.cf_order_id,
          amount: row.total_amount,
          signature_valid: true,
          applied: true,
          message: 'Payment failed; the subscription was marked failed.',
        });
      }
    }
  }

  /** Called when the doctor's tenant is created, so the row knows its clinic. */
  async attachDoctor(userId: string, doctorId: string): Promise<void> {
    await this.subscriptionModel.update(
      { doctor_id: doctorId } as any,
      { where: { user_id: userId, doctor_id: null } },
    );
  }

  // ── Super admin: who holds what ────────────────────────────

  /** Every subscription, newest first, with the doctor and plan resolved. */
  async list(query: QuerySubscriptionsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.plan) where.plan_id = query.plan;
    if (query.doctor_id) where.doctor_id = query.doctor_id;
    if (query.active_only) {
      where.status = SubscriptionStatus.ACTIVE;
      where.ends_at = { [Op.gt]: new Date() };
    }

    const { rows, count } = await this.subscriptionModel.findAndCountAll({
      where,
      include: [
        { model: User, attributes: ['id', 'email', 'name'], required: false },
        {
          model: Doctor,
          attributes: ['id', 'name', 'specialization'],
          required: false,
        },
        { model: Plan, attributes: ['id', 'name'], required: false },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    });

    return {
      items: rows.map((r) => this.toView(r)),
      total: count,
      page,
      limit,
      pages: Math.ceil(count / limit) || 1,
    };
  }

  /** The counters above the list: how the platform's plans are doing today. */
  async summary() {
    const now = new Date();
    const [active, pending, expiringSoon, all] = await Promise.all([
      this.subscriptionModel.count({
        where: { status: SubscriptionStatus.ACTIVE, ends_at: { [Op.gt]: now } },
      }),
      this.subscriptionModel.count({ where: { status: SubscriptionStatus.PENDING } }),
      this.subscriptionModel.count({
        where: {
          status: SubscriptionStatus.ACTIVE,
          ends_at: {
            [Op.gt]: now,
            [Op.lte]: new Date(now.getTime() + 30 * 86_400_000),
          },
        },
      }),
      this.subscriptionModel.findAll({
        attributes: ['total_amount'],
        where: { status: SubscriptionStatus.ACTIVE, granted_by: null },
        raw: true,
      }),
    ]);
    // Money actually collected from the subscriptions that are running — a
    // granted plan is excluded, since nothing was charged for it.
    const collected = (all as unknown as { total_amount: string }[]).reduce(
      (sum, r) => sum + Number(r.total_amount),
      0,
    );
    return {
      active,
      pending,
      expiringSoon,
      collected: Math.round(collected * 100) / 100,
    };
  }

  /**
   * Every doctor account, with the plan it is on — what the "grant a plan"
   * picker offers. Accounts rather than doctors: one that paid but has not
   * set its practice up yet has no doctor row, and is exactly the account
   * somebody will need to act on.
   */
  async accounts(): Promise<
    {
      userId: string;
      email: string;
      name: string;
      doctorName: string | null;
      currentPlan: string | null;
      endsAt: Date | null;
    }[]
  > {
    const users = await this.userModel.findAll({
      where: { type: UserType.DOCTOR },
      attributes: ['id', 'email', 'name'],
      include: [{ model: Doctor, attributes: ['id', 'name'], required: false }],
      order: [['name', 'ASC']],
    });
    if (users.length === 0) return [];

    const live = await this.subscriptionModel.findAll({
      where: {
        user_id: users.map((u) => u.id),
        status: SubscriptionStatus.ACTIVE,
        ends_at: { [Op.gt]: new Date() },
      },
      include: [{ model: Plan, attributes: ['id', 'name'], required: false }],
      order: [['ends_at', 'DESC']],
    });
    // First row wins: they are ordered by the furthest expiry.
    const byUser = new Map<string, Subscription>();
    for (const sub of live) if (!byUser.has(sub.user_id)) byUser.set(sub.user_id, sub);

    return users.map((u) => {
      const sub = byUser.get(u.id);
      return {
        userId: u.id,
        email: u.email,
        name: u.name,
        doctorName: u.doctor?.name ?? null,
        currentPlan: sub ? (sub.plan?.name ?? sub.plan_id) : null,
        endsAt: sub?.ends_at ?? null,
      };
    });
  }

  /** One account's subscription history — the doctor's own billing panel. */
  async historyForUser(userId: string): Promise<{
    current: SubscriptionView | null;
    history: SubscriptionView[];
  }> {
    const rows = await this.subscriptionModel.findAll({
      where: { user_id: userId },
      include: [
        { model: User, attributes: ['id', 'email', 'name'], required: false },
        { model: Doctor, attributes: ['id', 'name', 'specialization'], required: false },
        { model: Plan, attributes: ['id', 'name'], required: false },
      ],
      order: [['createdAt', 'DESC']],
    });
    const views = rows.map((r) => this.toView(r));
    const current =
      views.find(
        (v) => v.status === SubscriptionStatus.ACTIVE && v.endsAt && v.endsAt > new Date(),
      ) ?? null;
    return { current, history: views };
  }

  /**
   * A super admin gives a doctor a plan without a payment — a trial, a
   * complimentary month, or money taken offline. It is a real subscription
   * row so that access, expiry and renewal all behave identically; what marks
   * it out is `granted_by`, and the amounts are zero because nothing was
   * charged through us.
   */
  async grant(dto: GrantSubscriptionDto, actor: AuthUser): Promise<SubscriptionView> {
    const user = await this.userModel.findByPk(dto.user_id, {
      include: [{ model: Doctor, attributes: ['id', 'name'], required: false }],
    });
    if (!user) throw new AppException(ErrorCode.NOT_FOUND, { message: 'Unknown account.' });
    if (user.type === UserType.SUPER_ADMIN) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'The super admin account does not use plans.',
      });
    }

    const plan = await this.plans.findById(dto.plan_id);
    const months = dto.months ?? plan.months;

    // An extension starts where the current cycle ends, so granting a month
    // to somebody mid-plan adds a month rather than shortening them to one.
    const current = await this.access.activeFor(user.id);
    const startsAt =
      current?.ends_at && current.ends_at > new Date() ? current.ends_at : new Date();

    const row = await this.subscriptionModel.create({
      user_id: user.id,
      doctor_id: user.doctor_id ?? null,
      plan_id: plan.code,
      plan_ref: plan.id,
      months,
      base_amount: '0.00',
      gst_rate: '0.00',
      gst_amount: '0.00',
      total_amount: '0.00',
      currency: 'INR',
      status: SubscriptionStatus.ACTIVE,
      // Granted plans have no Cashfree order, but the column is unique and
      // not null, so they carry their own clearly-marked identifier.
      cf_order_id: `grant_${randomUUID().replace(/-/g, '')}`,
      starts_at: startsAt,
      ends_at: cycleEnd(startsAt, months),
      paid_at: new Date(),
      granted_by: actor.id,
      grant_note: dto.note?.trim() || null,
    } as any);

    // An account that was never gated (an older doctor) now is, so that the
    // grant's expiry actually means something.
    if (!user.subscription_required) {
      await user.update({ subscription_required: true } as any);
    }

    await this.events.record({
      source: PaymentEventSource.ADMIN,
      event_type: 'SUBSCRIPTION_GRANTED',
      subscription_id: row.id,
      user_id: user.id,
      doctor_id: user.doctor_id ?? null,
      status: SubscriptionStatus.ACTIVE,
      cf_order_id: row.cf_order_id,
      amount: 0,
      applied: true,
      message:
        `${actor.name} granted ${months} month(s) of ${plan.name} to ${user.email}` +
        (dto.note?.trim() ? ` — ${dto.note.trim()}` : '') +
        '. No payment was taken.',
    });
    this.activity.recordForUser(actor, {
      action: ActivityAction.SUBSCRIPTION_GRANTED,
      doctor_id: user.doctor_id ?? null,
      summary: `${actor.name} granted ${months} month(s) of ${plan.name} to ${user.email}.`,
      entity_type: 'subscription',
      entity_id: row.id,
      metadata: { plan: plan.code, months, note: dto.note ?? null },
    });

    this.mail
      .send({
        to: user.email,
        ...planGrantedEmail({
          planName: plan.name,
          months,
          endsAt: row.ends_at!,
          note: dto.note?.trim() || null,
          loginUrl: `${this.adminBase}/login`,
        }),
      })
      .catch((err) => this.logger.error(`Grant email to ${user.email} failed: ${err?.message}`));

    return this.toView(await this.reload(row.id));
  }

  /**
   * End a subscription now. The doctor is locked out on their next request —
   * the JWT strategy re-checks access on every call, so this does not wait
   * for their token to expire.
   */
  async cancel(id: string, dto: CancelSubscriptionDto, actor: AuthUser): Promise<SubscriptionView> {
    const row = await this.subscriptionModel.findByPk(id, {
      include: [{ model: User, attributes: ['id', 'email'], required: false }],
    });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, { message: 'Unknown subscription.' });
    if (row.status === SubscriptionStatus.CANCELLED) {
      throw new AppException(ErrorCode.CONFLICT, {
        message: 'This subscription is already cancelled.',
      });
    }

    await row.update({
      status: SubscriptionStatus.CANCELLED,
      // Expiry is brought forward rather than cleared, so the history still
      // says how much of the cycle had been used.
      ends_at: new Date(),
    } as any);

    await this.events.record({
      source: PaymentEventSource.ADMIN,
      event_type: 'SUBSCRIPTION_CANCELLED',
      subscription_id: row.id,
      user_id: row.user_id,
      doctor_id: row.doctor_id,
      status: SubscriptionStatus.CANCELLED,
      cf_order_id: row.cf_order_id,
      amount: row.total_amount,
      applied: true,
      message:
        `${actor.name} cancelled this subscription` +
        (dto.reason?.trim() ? ` — ${dto.reason.trim()}` : '') +
        '. No refund was made through this system.',
    });
    this.activity.recordForUser(actor, {
      action: ActivityAction.SUBSCRIPTION_CANCELLED,
      doctor_id: row.doctor_id,
      summary: `${actor.name} cancelled the subscription for ${row.user?.email ?? row.user_id}.`,
      entity_type: 'subscription',
      entity_id: row.id,
      metadata: { reason: dto.reason ?? null },
    });
    return this.toView(await this.reload(row.id));
  }

  // ── Internals ──────────────────────────────────────────────

  private async openOrder(user: User, plan: Plan, mobile: string): Promise<CheckoutSession> {
    const price = this.plans.price(plan);
    // Cashfree's order id: letters, digits, `_` and `-`, up to 50 characters.
    const orderId = `sub_${randomUUID().replace(/-/g, '')}`;

    const order = await this.cashfree.createOrder({
      orderId,
      amount: price.total,
      customer: { id: user.id, email: user.email, phone: mobile, name: user.name },
      // Cashfree fills `{order_id}` in; the page then asks /signup/orders/:id.
      returnUrl: `${this.landingBase}/signup/done?order_id={order_id}`,
      note: `myDigitalOPD ${plan.name} plan`,
    });
    if (!order.payment_session_id) {
      throw new AppException(ErrorCode.INTERNAL_ERROR, {
        message: 'The payment gateway did not return a checkout session.',
      });
    }

    // One live attempt at a time: an older pending order is superseded, so
    // paying it later (a stale tab) still activates but cannot double up.
    const row = await this.subscriptionModel.create({
      user_id: user.id,
      doctor_id: user.doctor_id ?? null,
      plan_id: plan.code,
      plan_ref: plan.id,
      months: plan.months,
      base_amount: price.base.toFixed(2),
      gst_rate: price.gstRate.toFixed(2),
      gst_amount: price.gst.toFixed(2),
      total_amount: price.total.toFixed(2),
      currency: 'INR',
      status: SubscriptionStatus.PENDING,
      cf_order_id: orderId,
      payment_session_id: order.payment_session_id,
    } as any);

    await this.events.record({
      source: PaymentEventSource.SYSTEM,
      event_type: 'ORDER_CREATED',
      subscription_id: row.id,
      user_id: user.id,
      doctor_id: user.doctor_id ?? null,
      status: SubscriptionStatus.PENDING,
      cf_order_id: orderId,
      amount: price.total,
      applied: true,
      message: `Checkout opened for ${user.email} — ${plan.name}, ₹${price.total.toFixed(2)} incl. GST.`,
    });

    return {
      orderId,
      paymentSessionId: order.payment_session_id,
      env: this.cashfree.env,
      plan: plan.code,
      amount: price,
    };
  }

  /** Ask Cashfree whether a pending order has in fact been paid (or died). */
  private async reconcile(row: Subscription): Promise<Subscription | null> {
    try {
      const order = await this.cashfree.getOrder(row.cf_order_id);
      if (order.order_status === 'PAID') {
        const payments = await this.cashfree
          .getPayments(row.cf_order_id)
          .catch((): CashfreePayment[] => []);
        const success = payments.find((p) => p.payment_status === 'SUCCESS') ?? null;
        return this.activate(row, success, PaymentEventSource.POLL, 'ORDER_POLLED_PAID');
      }
      if (order.order_status === 'EXPIRED' || order.order_status === 'TERMINATED') {
        await row.update({ status: SubscriptionStatus.EXPIRED } as any);
        await this.events.record({
          source: PaymentEventSource.POLL,
          event_type: `ORDER_${order.order_status}`,
          subscription_id: row.id,
          user_id: row.user_id,
          doctor_id: row.doctor_id,
          status: SubscriptionStatus.EXPIRED,
          cf_order_id: row.cf_order_id,
          amount: row.total_amount,
          applied: true,
          message: `Cashfree reports the order as ${order.order_status.toLowerCase()}.`,
        });
      }
    } catch (err: any) {
      // A gateway hiccup must not turn into a wrong answer; the page asks again.
      this.logger.warn(`Could not reconcile order ${row.cf_order_id}: ${err?.message}`);
    }
    return null;
  }

  /**
   * Payment confirmed. Idempotent — the webhook and the status poll can both
   * land, and Cashfree retries webhooks — so a second call is a no-op.
   */
  private async activate(
    row: Subscription,
    payment: CashfreePayment | null,
    source: PaymentEventSource,
    eventType: string,
  ): Promise<Subscription> {
    const activated = await this.sequelize.transaction(async (t) => {
      const fresh = await this.subscriptionModel.findByPk(row.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!fresh || fresh.status === SubscriptionStatus.ACTIVE) return null;

      // A renewal starts when the current cycle ends, not today.
      const current = await this.access.activeFor(fresh.user_id);
      const startsAt =
        current?.ends_at && current.ends_at > new Date() ? current.ends_at : new Date();
      await fresh.update(
        {
          status: SubscriptionStatus.ACTIVE,
          cf_payment_id: payment?.cf_payment_id != null ? String(payment.cf_payment_id) : null,
          paid_at: new Date(),
          starts_at: startsAt,
          ends_at: cycleEnd(startsAt, fresh.months),
        } as any,
        { transaction: t },
      );
      return fresh;
    });

    if (!activated) {
      // Not an error: Cashfree resends, and the status poll runs alongside.
      // Worth a line in the log so a duplicate is visible rather than silent.
      await this.events.record({
        source,
        event_type: eventType,
        subscription_id: row.id,
        user_id: row.user_id,
        doctor_id: row.doctor_id,
        status: row.status,
        cf_order_id: row.cf_order_id,
        cf_payment_id: payment?.cf_payment_id != null ? String(payment.cf_payment_id) : null,
        amount: payment?.payment_amount ?? row.total_amount,
        applied: false,
        message: 'Already active — duplicate confirmation, nothing changed.',
      });
      return row;
    }

    const user = await this.userModel.findByPk(activated.user_id);
    const plan = activated.plan_ref
      ? await this.plans.findById(activated.plan_ref).catch(() => null)
      : null;
    const planName = plan?.name ?? activated.plan_id;

    await this.events.record({
      source,
      event_type: eventType,
      subscription_id: activated.id,
      user_id: activated.user_id,
      doctor_id: activated.doctor_id,
      status: SubscriptionStatus.ACTIVE,
      cf_order_id: activated.cf_order_id,
      cf_payment_id: activated.cf_payment_id,
      amount: activated.total_amount,
      applied: true,
      message: `Payment confirmed — ${planName} active until ${activated.ends_at!.toISOString().slice(0, 10)}.`,
    });
    this.activity.record({
      action: ActivityAction.SUBSCRIPTION_PAID,
      actor_type: ActivityActor.USER,
      actor_id: activated.user_id,
      actor_label: user?.email ?? activated.user_id,
      doctor_id: activated.doctor_id,
      summary: `${user?.email ?? 'A doctor'} paid ₹${activated.total_amount} for the ${planName} plan.`,
      entity_type: 'subscription',
      entity_id: activated.id,
      metadata: { plan: activated.plan_id, order: activated.cf_order_id },
    });

    if (user) {
      this.mail
        .send({
          to: user.email,
          ...paymentReceivedEmail({
            planName,
            total: Number(activated.total_amount),
            endsAt: activated.ends_at!,
            loginUrl: `${this.adminBase}/login`,
          }),
        })
        .catch((err) => this.logger.error(`Payment email to ${user.email} failed: ${err?.message}`));
    }
    return activated;
  }

  private reload(id: string): Promise<Subscription> {
    return this.subscriptionModel.findByPk(id, {
      include: [
        { model: User, attributes: ['id', 'email', 'name'], required: false },
        { model: Doctor, attributes: ['id', 'name', 'specialization'], required: false },
        { model: Plan, attributes: ['id', 'name'], required: false },
      ],
    }) as Promise<Subscription>;
  }

  private toView(r: Subscription): SubscriptionView {
    return {
      id: r.id,
      status: r.status,
      planCode: r.plan_id,
      planName: r.plan?.name ?? r.plan_id,
      months: r.months,
      baseAmount: Number(r.base_amount),
      gstAmount: Number(r.gst_amount),
      totalAmount: Number(r.total_amount),
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      paidAt: r.paid_at,
      orderId: r.cf_order_id,
      paymentId: r.cf_payment_id,
      granted: !!r.granted_by,
      grantNote: r.grant_note,
      account: {
        userId: r.user_id,
        email: r.user?.email ?? '',
        name: r.user?.name ?? '',
      },
      doctor: r.doctor
        ? { id: r.doctor.id, name: r.doctor.name, specialization: r.doctor.specialization }
        : null,
    };
  }
}
