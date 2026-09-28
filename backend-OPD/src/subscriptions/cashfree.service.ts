import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export interface CashfreeOrderInput {
  orderId: string;
  amount: number;
  customer: { id: string; email: string; phone: string; name?: string };
  returnUrl: string;
  note?: string;
}

export interface CashfreeOrder {
  cf_order_id: string;
  order_id: string;
  order_status: 'ACTIVE' | 'PAID' | 'EXPIRED' | 'TERMINATED' | 'TERMINATION_REQUESTED';
  order_amount: number;
  payment_session_id?: string;
}

export interface CashfreePayment {
  cf_payment_id: string | number;
  payment_status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'USER_DROPPED' | 'CANCELLED' | 'VOID' | 'NOT_ATTEMPTED';
  payment_amount: number;
  payment_time?: string;
}

/** How long to wait on Cashfree before giving up and saying so. */
const GATEWAY_TIMEOUT_MS = 30_000;

/**
 * What a doctor is told when the gateway is unreachable, slow, or broken —
 * all three mean the same thing to them: nothing happened, try again.
 */
const GATEWAY_UNREACHABLE =
  'The payment gateway is not responding right now. Nothing was charged — please try again in a moment.';

/**
 * The slice of Cashfree's Payment Gateway API this server uses: create an
 * order, read it back, and check a webhook's signature.
 *
 * Plain `fetch` rather than the SDK — three calls do not justify a
 * dependency, and the request shapes are stable across API versions.
 */
@Injectable()
export class CashfreeService {
  private readonly logger = new Logger(CashfreeService.name);
  private readonly appId: string;
  private readonly secretKey: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  readonly env: 'sandbox' | 'production';
  readonly notifyUrl: string;

  constructor(config: ConfigService) {
    const cf = config.get('cashfree') as {
      appId: string;
      secretKey: string;
      env: 'sandbox' | 'production';
      apiVersion: string;
      notifyUrl: string;
    };
    this.appId = cf.appId;
    this.secretKey = cf.secretKey;
    this.apiVersion = cf.apiVersion;
    this.env = cf.env;
    this.notifyUrl = cf.notifyUrl;
    this.baseUrl = cf.env === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
    if (!this.appId || !this.secretKey) {
      this.logger.warn('CASHFREE_APP_ID / CASHFREE_SECRET_KEY not set — paid sign-up will fail.');
    }
    // Cashfree labels its own keys `cfsk_ma_test_` / `cfsk_ma_prod_`, so the
    // one mistake that matters — going live with the sandbox keys still in
    // place, or the reverse — is worth saying out loud at boot rather than
    // leaving to be read off a failed payment.
    const label = this.secretKey.startsWith('cfsk_ma_prod_')
      ? 'production'
      : this.secretKey.startsWith('cfsk_ma_test_')
        ? 'sandbox'
        : null;
    if (label && label !== this.env) {
      this.logger.error(
        `CASHFREE_ENV is ${this.env} but the secret key is a ${label} key — ` +
          'set the CASHFREE_PROD_* keys for production. Payments will fail.',
      );
    }
    this.logger.log(`Cashfree ${this.env} — ${this.baseUrl}, webhook ${this.notifyUrl}`);
  }

  get configured(): boolean {
    return !!(this.appId && this.secretKey);
  }

  async createOrder(input: CashfreeOrderInput): Promise<CashfreeOrder> {
    return this.request<CashfreeOrder>('POST', '/pg/orders', {
      order_id: input.orderId,
      order_amount: input.amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: input.customer.id,
        customer_email: input.customer.email,
        customer_phone: input.customer.phone,
        ...(input.customer.name ? { customer_name: input.customer.name } : {}),
      },
      order_meta: {
        return_url: input.returnUrl,
        notify_url: this.notifyUrl,
      },
      ...(input.note ? { order_note: input.note } : {}),
    });
  }

  getOrder(orderId: string): Promise<CashfreeOrder> {
    return this.request<CashfreeOrder>('GET', `/pg/orders/${encodeURIComponent(orderId)}`);
  }

  getPayments(orderId: string): Promise<CashfreePayment[]> {
    return this.request<CashfreePayment[]>(
      'GET',
      `/pg/orders/${encodeURIComponent(orderId)}/payments`,
    );
  }

  /**
   * Cashfree signs each webhook as base64(HMAC-SHA256(secret, timestamp + raw body)).
   * The raw bytes matter — a re-serialised body would not match.
   */
  webhookSignatureOk(raw: Buffer | undefined, signature?: string, timestamp?: string): boolean {
    if (!raw || !signature || !timestamp || !this.secretKey) return false;
    const expected = createHmac('sha256', this.secretKey)
      .update(timestamp + raw.toString('utf8'))
      .digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    if (!this.configured) {
      throw new AppException(ErrorCode.INTERNAL_ERROR, {
        message: 'Online payment is not configured on this server.',
      });
    }
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          'x-client-id': this.appId,
          'x-client-secret': this.secretKey,
          'x-api-version': this.apiVersion,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        // Cashfree's own edge gives up with a 504 after about a minute. A
        // doctor watching a spinner should not wait that long to be told to
        // try again, and a request that hangs holds a connection open here.
        signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
      });
    } catch (err: any) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      this.logger.error(
        `Cashfree ${method} ${path} ${timedOut ? `timed out after ${GATEWAY_TIMEOUT_MS}ms` : `failed: ${err?.message}`}`,
      );
      throw new AppException(ErrorCode.INTERNAL_ERROR, {
        message: GATEWAY_UNREACHABLE,
      });
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error body; handled below */
    }
    if (!res.ok) {
      this.logger.error(`Cashfree ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
      // A 5xx is the gateway having trouble, not a refusal: nothing was
      // wrong with the request and nothing was charged, so the doctor is
      // told to try again rather than that they were rejected. Cashfree's
      // own message is only quoted for a 4xx, where it explains the refusal.
      if (res.status >= 500) {
        throw new AppException(ErrorCode.INTERNAL_ERROR, { message: GATEWAY_UNREACHABLE });
      }
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: json?.message || 'The payment gateway rejected the request.',
      });
    }
    return json as T;
  }
}
