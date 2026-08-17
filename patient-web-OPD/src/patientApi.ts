import axios, { AxiosError } from 'axios';
import { AppConfig } from './config';
import { ApiException } from './types';
import type {
  PatientAuthUser,
  PatientNotification,
  PatientReport,
  PatientVisit,
} from './types';

const TOKEN_KEY = 'opd_patient_token';

export const patientTokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

const client = axios.create({
  baseURL: AppConfig.apiBaseUrl,
  timeout: 15000,
});

client.interceptors.request.use((config) => {
  const token = patientTokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function handleAxiosError(err: unknown): never {
  if (axios.isAxiosError(err)) {
    const error = err as AxiosError<any>;
    if (!error.response) {
      throw new ApiException(
        'NETWORK_ERROR',
        'Unable to reach the server. Check your connection.',
        0,
      );
    }
    const data = error.response.data;
    if (data && typeof data === 'object') {
      throw new ApiException(
        data.error || 'ERROR',
        data.message || 'Something went wrong. Please try again.',
        error.response.status,
        data.details,
      );
    }
    throw new ApiException('ERROR', 'Something went wrong.', error.response.status);
  }
  throw new ApiException('ERROR', 'Unexpected error occurred.', 0);
}

async function unwrap<T>(promise: Promise<{ data: any }>): Promise<T> {
  try {
    const res = await promise;
    return (res.data?.data ?? res.data) as T;
  } catch (err) {
    handleAxiosError(err);
  }
}

export interface PatientSession {
  accessToken: string;
  patient: PatientAuthUser;
}

export const patientApi = {
  register: (mobile: string, name: string) =>
    unwrap<PatientSession>(client.post('/patient/auth/register', { mobile, name })),
  login: (mobile: string) =>
    unwrap<PatientSession>(client.post('/patient/auth/login', { mobile })),
  me: () => unwrap<PatientAuthUser>(client.get('/patient/auth/me')),

  myVisits: () => unwrap<PatientVisit[]>(client.get('/patient/appointments')),
  myReports: () => unwrap<PatientReport[]>(client.get('/patient/reports')),
  uploadMyReport: (title: string, file: File) => {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('file', file);
    return unwrap<PatientReport>(
      client.post('/patient/reports', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
  },

  notifications: () => unwrap<PatientNotification[]>(client.get('/patient/notifications')),
  unreadCount: () =>
    unwrap<{ count: number }>(client.get('/patient/notifications/unread-count')),
  markRead: (id: string) =>
    unwrap(client.patch(`/patient/notifications/${id}/read`)),
  markAllRead: () => unwrap(client.patch('/patient/notifications/read-all')),
};
