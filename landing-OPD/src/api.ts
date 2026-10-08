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

/** A doctor a patient can book, as the public directory describes them. */
export interface PublicDoctor {
  id: string;
  name: string;
  specialization: string | null;
  qualifications: string | null;
  clinicName: string | null;
  clinicAddress: string | null;
  photoUrl: string | null;
  /** Where the patient goes to pick a slot — the patient app's booking page. */
  bookingUrl: string;
}

/**
 * The API still answers in snake_case here (migration phase 2), so the mapping
 * stays in this file and nothing above it has to know.
 */
function toDoctor(d: Record<string, any>): PublicDoctor {
  return {
    id: d.id,
    name: d.name,
    specialization: d.specialization ?? null,
    qualifications: d.qualifications ?? null,
    clinicName: d.clinic_name ?? null,
    clinicAddress: d.clinic_address ?? null,
    photoUrl: d.profile_photo_url ?? null,
    bookingUrl: bookingUrl(d),
  };
}

/**
 * The doctor's own booking page.
 *
 * The server builds this from the doctor's configured portal base, and falls
 * back to a bare `/d/slug` when a deployment has none — which would resolve
 * against *this* site, where no booking page exists. So a relative answer is
 * re-based onto the patient portal we know about.
 */
function bookingUrl(d: Record<string, any>): string {
  const given = typeof d.booking_url === 'string' ? d.booking_url : '';
  if (/^https?:\/\//i.test(given)) return given;
  const base = AppConfig.links.patientPortal.replace(/\/+$/, '');
  return `${base}/d/${d.public_slug ?? ''}`;
}

/** How many matches the dropdown will show. */
const MAX_RESULTS = 10;

/**
 * Does this doctor answer to what was typed?
 *
 * Word by word rather than as one substring, so "dr sh" finds "Dr Shankar"
 * and "sharma dentist" finds a dentist named Sharma whichever order the two
 * were typed in.
 */
function matches(d: PublicDoctor, query: string): boolean {
  const hay = [d.name, d.specialization, d.qualifications, d.clinicName, d.clinicAddress]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

export const doctorsApi = {
  /**
   * Doctors matching what the patient has typed — name, speciality, clinic or
   * city.
   *
   * Narrowed twice, deliberately. The server does it (`?search=`), and then
   * this does it again over whatever came back. An API that does not know the
   * parameter answers with the entire directory and ignores it silently —
   * which is exactly what a not-yet-deployed backend does, and the dropdown
   * then offers every doctor on the product to a patient who typed one name.
   * Filtering here makes the search right against any version of the API; when
   * the server has already narrowed, this passes everything through.
   */
  search: (query: string, signal?: AbortSignal) =>
    call<Record<string, any>[]>(
      `/public/doctors?search=${encodeURIComponent(query)}`,
      { signal },
    ).then((rows) =>
      rows
        .map(toDoctor)
        .filter((d) => matches(d, query))
        .slice(0, MAX_RESULTS),
    ),
};

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
