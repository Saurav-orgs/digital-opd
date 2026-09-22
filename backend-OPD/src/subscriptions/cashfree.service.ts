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
      });
    } catch (err: any) {
      this.logger.error(`Cashfree ${method} ${path} failed: ${err?.message}`);
      throw new AppException(ErrorCode.INTERNAL_ERROR, {
        message: 'Could not reach the payment gateway. Please try again.',
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
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: json?.message || 'The payment gateway rejected the request.',
      });
    }
    return json as T;
  }
}
