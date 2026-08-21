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
  register: (mobile: string, name: string, doctorId?: string | null) =>
    unwrap<PatientSession>(client.post('/patient/auth/register', {
      mobile, name, ...(doctorId ? { doctor_id: doctorId } : {}),
    })),
  login: (mobile: string, doctorId?: string | null) =>
    unwrap<PatientSession>(client.post('/patient/auth/login', {
      mobile, ...(doctorId ? { doctor_id: doctorId } : {}),
    })),
  me: () => unwrap<PatientAuthUser>(client.get('/patient/auth/me')),

  myVisits: (doctorId?: string | null) =>
    unwrap<PatientVisit[]>(client.get('/patient/appointments', {
      params: doctorId ? { doctor_id: doctorId } : undefined,
    })),
  myReports: (doctorId?: string | null) =>
    unwrap<PatientReport[]>(client.get('/patient/reports', {
      params: doctorId ? { doctor_id: doctorId } : undefined,
    })),
  // Upload a report against a specific appointment (allowed until the doctor
  // marks that visit done — the server enforces the cutoff).
  uploadVisitReport: (appointmentId: string, title: string, file: File) => {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('file', file);
    return unwrap<PatientReport>(
      client.post(`/patient/appointments/${appointmentId}/reports`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
  },

  notifications: (doctorId?: string | null) =>
    unwrap<PatientNotification[]>(client.get('/patient/notifications', {
      params: doctorId ? { doctor_id: doctorId } : undefined,
    })),
  unreadCount: () =>
    unwrap<{ count: number }>(client.get('/patient/notifications/unread-count')),
  markRead: (id: string) =>
    unwrap(client.patch(`/patient/notifications/${id}/read`)),
  markAllRead: () => unwrap(client.patch('/patient/notifications/read-all')),
};
