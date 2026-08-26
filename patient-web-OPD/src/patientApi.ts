import axios, { AxiosError } from 'axios';
import { AppConfig } from './config';
import { ApiException } from './types';
import type {
  IdentifyResult,
  PatientAuthUser,
  PatientDetailsInput,
  PatientNotification,
  PatientProfile,
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

/**
 * Uploads get their own budget. A 5 MB report on a phone connection routinely
 * takes longer than the 15s that suits a JSON call, and aborting the request
 * does not stop the server finishing it — the patient was told the report had
 * failed while it was quietly landing on their visit.
 */
const UPLOAD_TIMEOUT_MS = 120000;

client.interceptors.request.use((config) => {
  const token = patientTokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    config.timeout = UPLOAD_TIMEOUT_MS;
  }
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
  patients?: PatientProfile[];
}

/** The account plus everyone registered on it. */
export interface PatientMe extends PatientAuthUser {
  patients: PatientProfile[];
}

export const patientApi = {
  /**
   * Booking step 1. The number alone opens the account and tells us who is
   * already registered on it; no patient is created here.
   */
  identify: (mobile: string) =>
    unwrap<IdentifyResult>(client.post('/patient/auth/identify', { mobile })),

  register: (mobile: string, patient: PatientDetailsInput, doctorId?: string | null) =>
    unwrap<PatientSession>(client.post('/patient/auth/register', {
      mobile, patient, ...(doctorId ? { doctor_id: doctorId } : {}),
    })),
  login: (mobile: string, doctorId?: string | null) =>
    unwrap<PatientSession>(client.post('/patient/auth/login', {
      mobile, ...(doctorId ? { doctor_id: doctorId } : {}),
    })),
  me: () => unwrap<PatientMe>(client.get('/patient/auth/me')),

  // ── The patients on this account ──
  profiles: () => unwrap<PatientProfile[]>(client.get('/patient/profiles')),
  addProfile: (patient: PatientDetailsInput) =>
    unwrap<PatientProfile>(client.post('/patient/profiles', patient)),
  updateProfile: (id: string, patch: Partial<PatientDetailsInput>) =>
    unwrap<PatientProfile>(client.patch(`/patient/profiles/${id}`, patch)),
  deleteProfile: (id: string) =>
    unwrap<{ ok: boolean }>(client.delete(`/patient/profiles/${id}`)),

  // Every clinical read names the patient — an account may cover a family.
  myVisits: (profileId: string, doctorId?: string | null) =>
    unwrap<PatientVisit[]>(client.get('/patient/appointments', {
      params: { profile_id: profileId, ...(doctorId ? { doctor_id: doctorId } : {}) },
    })),
  myReports: (profileId: string, doctorId?: string | null) =>
    unwrap<PatientReport[]>(client.get('/patient/reports', {
      params: { profile_id: profileId, ...(doctorId ? { doctor_id: doctorId } : {}) },
    })),
  cancelVisit: (appointmentId: string) =>
    unwrap<{ ok: boolean }>(client.delete(`/patient/appointments/${appointmentId}`)),
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

  // Rename a report and/or replace its file. Both optional; the server enforces
  // ownership and the same "visit still open" cutoff as upload.
  updateVisitReport: (reportId: string, title?: string, file?: File) => {
    const fd = new FormData();
    if (title) fd.append('title', title);
    if (file) fd.append('file', file);
    return unwrap<PatientReport>(
      client.patch(`/patient/reports/${reportId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
  },

  deleteVisitReport: (reportId: string) =>
    unwrap<{ ok: boolean }>(client.delete(`/patient/reports/${reportId}`)),

  notifications: (doctorId?: string | null, profileId?: string | null) =>
    unwrap<PatientNotification[]>(client.get('/patient/notifications', {
      params: {
        ...(doctorId ? { doctor_id: doctorId } : {}),
        ...(profileId ? { profile_id: profileId } : {}),
      },
    })),
  unreadCount: () =>
    unwrap<{ count: number }>(client.get('/patient/notifications/unread-count')),
  markRead: (id: string) =>
    unwrap(client.patch(`/patient/notifications/${id}/read`)),
  markAllRead: () => unwrap(client.patch('/patient/notifications/read-all')),
};
