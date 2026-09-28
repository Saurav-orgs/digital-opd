import axios, { AxiosError } from 'axios';

const TOKEN_KEY = 'opd_admin_token';
const LOCKOUT_KEY = 'opd_admin_lockout';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** What the sign-in screen says after a session was ended by the plan running out. */
export interface Lockout {
  message: string;
  /** The pricing page, when buying a plan is something the doctor can do. */
  planUrl?: string;
}

/**
 * Carries the reason for a subscription lock-out across the reload that takes
 * the app back to the sign-in screen. Session storage, not state: the point of
 * the reload is that nothing in memory survives it, and a doctor bounced out
 * mid-consultation deserves better than an unexplained login form.
 */
export const lockoutStore = {
  set(lockout: Lockout) {
    try {
      sessionStorage.setItem(LOCKOUT_KEY, JSON.stringify(lockout));
    } catch {
      /* private mode, or storage full — the login screen simply says less. */
    }
  },
  /** Read once; a reason already shown is not shown again. */
  take(): Lockout | null {
    try {
      const raw = sessionStorage.getItem(LOCKOUT_KEY);
      sessionStorage.removeItem(LOCKOUT_KEY);
      return raw ? (JSON.parse(raw) as Lockout) : null;
    } catch {
      return null;
    }
  },
};

/** Normalised, user-displayable API error (mirrors backend §13 contract). */
export class ApiError extends Error {
  code: string;
  statusCode: number;
  details?: unknown;
  constructor(code: string, message: string, statusCode: number, details?: unknown) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Shared with the consultation socket, which connects to this host's origin.
export const API_BASE = 'https://api.mydigitalopd.com/api';

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Unwrap the success envelope; normalise errors into ApiError.
api.interceptors.response.use(
  (res) => {
    if (res.data && typeof res.data === 'object' && 'data' in res.data) {
      return { ...res, data: res.data.data };
    }
    return res;
  },
  (error: AxiosError<any>) => {
    if (error.response?.data && typeof error.response.data === 'object') {
      const b = error.response.data as any;
      // On auth failure, drop the stale token so the app returns to login.
      if (error.response.status === 401) tokenStore.clear();
      // A plan that lapses — or is cancelled — mid-session ends the session:
      // the server refuses every authenticated route from that moment, so a
      // screen left open is only a screen full of failures. The session is
      // dropped and the app reloaded onto the sign-in form, carrying the reason
      // with it. Signing in again is what buying or renewing starts from.
      if (b.error === 'SUBSCRIPTION_REQUIRED' && tokenStore.get()) {
        tokenStore.clear();
        lockoutStore.set({
          message: b.message || 'Your subscription is not active.',
          planUrl: (b.details as { planUrl?: string } | undefined)?.planUrl,
        });
        // Reloaded even when the sign-in screen is already showing: the reason
        // is read on mount, and a screen that mounted before this answer came
        // back would otherwise never show it. The token is gone by now, so the
        // reload cannot land here a second time.
        window.location.replace('/login');
      }
      throw new ApiError(
        b.error || 'INTERNAL_ERROR',
        b.message || 'Something went wrong. Please try again.',
        b.statusCode || error.response.status,
        b.details,
      );
    }
    throw new ApiError(
      'NETWORK_ERROR',
      'Unable to reach the server. Please check your connection.',
      0,
    );
  },
);

export default api;
