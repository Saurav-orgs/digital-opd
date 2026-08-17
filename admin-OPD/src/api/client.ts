import axios, { AxiosError } from 'axios';

const TOKEN_KEY = 'opd_admin_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
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

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
});

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
