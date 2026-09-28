import { AppConfig } from './config';
import type { Plan } from './plans';

/**
 * The handful of calls the sign-up makes. `fetch` rather than a client
 * library: four endpoints, one envelope, no interceptors to configure.
 *
 * Every response is the API's `{ success, data }` envelope; an error carries
 * a `message` written for the doctor, so it is shown as-is.
 */
export class ApiError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(message: string, code: string | null, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(AppConfig.apiBaseUrl + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError('Could not reach the server. Please check your connection.', null, 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    throw new ApiError(
      body?.message ?? 'Something went wrong. Please try again.',
      body?.error ?? null,
      res.status,
    );
  }
  return body?.data as T;
}

const post = <T>(path: string, payload: unknown) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(payload) });

export interface CheckoutSession {
  orderId: string;
  paymentSessionId: string;
  env: 'sandbox' | 'production';
  plan: string;
  amount: { base: number; gstRate: number; gst: number; total: number };
}

export interface OrderStatus {
  orderId: string;
  status: 'pending' | 'active' | 'failed' | 'expired' | 'cancelled';
  plan: string;
  planName: string;
  total: number;
  email: string;
  endsAt: string | null;
  loginUrl: string;
}

export const signupApi = {
  /** The plans on sale, priced by the server. */
  plans: () => call<Plan[]>('/signup/plans'),

  sendEmailCode: (email: string) =>
    post<{ ok: true; resendAfter: number }>('/auth/email-verification/send', { email }),

  confirmEmailCode: (email: string, code: string) =>
    post<{ verified: true }>('/auth/email-verification/confirm', { email, code }),

  createAccount: (payload: { email: string; password: string; mobile: string; plan: string }) =>
    post<CheckoutSession>('/signup/account', payload),

  /** An account that never paid — or whose payment failed — opens a fresh order. */
  resume: (payload: { email: string; password: string; mobile: string; plan: string }) =>
    post<CheckoutSession>('/signup/resume', payload),

  orderStatus: (orderId: string) =>
    call<OrderStatus>(`/signup/orders/${encodeURIComponent(orderId)}`),
};
