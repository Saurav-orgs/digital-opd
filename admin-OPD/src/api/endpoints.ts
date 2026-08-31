import api from './client';
import { filenameFromDisposition } from '../lib/shareFile';
import type {
  Appointment,
  AuthUser,
  BlockedNumber,
  PendingDoctor,
  ConsultationSession,
  CreateDoctorResult,
  DoctorProfile,
  EPrescription,
  MedicineCatalogEntry,
  DashboardSummary,
  DaySlots,
  Doctor,
  LoginResponse,
  PatientReport,
  Permission,
  Role,
  ScheduleEntry,
  User,
  ProgressSummary,
  PatientProfile,
} from './types';

// ── Auth ─────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { email, password }).then((r) => r.data),
  me: () => api.get<AuthUser>('/auth/me').then((r) => r.data),
  /** Rotate your own password — the current one is required. */
  changePassword: (currentPassword: string, newPassword: string) =>
    api
      .post<{ ok: boolean }>('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      .then((r) => r.data),
};

// ── Users ────────────────────────────────────────────────────
export const usersApi = {
  list: () => api.get<User[]>('/users').then((r) => r.data),
  create: (body: Partial<User> & { password: string }) =>
    api.post<User>('/users', body).then((r) => r.data),
  update: (id: string, body: Partial<User> & { password?: string }) =>
    api.patch<User>(`/users/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
};

// ── Roles & permissions ──────────────────────────────────────
export const rolesApi = {
  list: () => api.get<Role[]>('/roles').then((r) => r.data),
  permissions: () => api.get<Permission[]>('/permissions').then((r) => r.data),
  create: (body: { name: string; description?: string; permissionIds: string[] }) =>
    api.post<Role>('/roles', body).then((r) => r.data),
  update: (
    id: string,
    body: { name?: string; description?: string; permissionIds?: string[] },
  ) => api.patch<Role>(`/roles/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/roles/${id}`).then((r) => r.data),
};

// ── Doctors ──────────────────────────────────────────────────
export const doctorsApi = {
  list: () => api.get<Doctor[]>('/doctors').then((r) => r.data),
  get: (id: string) => api.get<Doctor>(`/doctors/${id}`).then((r) => r.data),
  // Super-admin only: create a new doctor tenant
  create: (body: {
    name: string;
    email: string;
    password: string;
    specialization?: string;
    qualifications?: string;
    bio?: string;
    consultation_fee?: number;
    license_number?: string;
    contact_mobile?: string;
  }) => api.post<CreateDoctorResult>('/doctors', body).then((r) => r.data),
  /** Super-admin: full profile including a signed link to the certificate. */
  profile: (id: string) =>
    api.get<DoctorProfile>(`/doctors/${id}/profile`).then((r) => r.data),
  /** Super-admin: attach or replace the practice licence certificate. */
  uploadLicense: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post<DoctorProfile>(`/doctors/${id}/license`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
  /**
   * Super-admin: set a new password on a doctor's own login. Returns it so the
   * super admin can read it out — there is no email delivery here, so a
   * locked-out doctor has no other way back in.
   */
  /** Registrations awaiting super-admin review, each with a licence link. */
  pendingRegistrations: () =>
    api.get<PendingDoctor[]>('/doctors/registrations/pending').then((r) => r.data),
  approveRegistration: (id: string) =>
    api.post<Doctor>(`/doctors/${id}/approve`).then((r) => r.data),
  rejectRegistration: (id: string, reason?: string) =>
    api.post<Doctor>(`/doctors/${id}/reject`, { reason }).then((r) => r.data),
  resetPassword: (id: string, password: string) =>
    api
      .post<{ email: string; password: string }>(`/doctors/${id}/reset-password`, {
        password,
      })
      .then((r) => r.data),
  regenerateSlug: (id: string) =>
    api.post<Doctor & { qrUrl: string }>(`/doctors/${id}/regenerate-slug`).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) =>
    api.patch<Doctor>(`/doctors/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/doctors/${id}`).then((r) => r.data),
  enable: (id: string) => api.patch<Doctor>(`/doctors/${id}/enable`).then((r) => r.data),
  disable: (id: string) =>
    api.patch<Doctor>(`/doctors/${id}/disable`).then((r) => r.data),
  uploadPhoto: (id: string, file: File) => upload(`/doctors/${id}/photo`, file),
  uploadQr: (id: string, file: File) => upload(`/doctors/${id}/qr`, file),
  removeQr: (id: string) => api.delete<Doctor>(`/doctors/${id}/qr`).then((r) => r.data),
  // Doctor self-service
  me: () => api.get<Doctor>('/doctors/me').then((r) => r.data),
  updateMe: (body: Partial<Doctor>) =>
    api.patch<Doctor>('/doctors/me', body).then((r) => r.data),
  uploadMyPhoto: (file: File) => upload('/doctors/me/photo', file),
  uploadMyLetterheadLogo: (file: File) => upload('/doctors/me/letterhead-logo', file),
  uploadMyQr: (file: File) => upload('/doctors/me/qr', file),
  removeMyQr: () => api.delete<Doctor>('/doctors/me/qr').then((r) => r.data),
  /**
   * The QR image's bytes, through the API rather than the S3 URL — S3 sends no
   * CORS headers, so the browser cannot read that URL to build a shareable file.
   */
  myQrFile: () =>
    api.get('/doctors/me/qr', { responseType: 'blob' }).then((r) => ({
      blob: r.data as Blob,
      filename: filenameFromDisposition(
        r.headers['content-disposition'],
        'booking-qr.png',
      ),
    })),
};

function upload(url: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return api
    .post<Doctor>(url, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then((r) => r.data);
}

// ── Platform settings (super-admin) ──────────────────────────
export interface AppSettings {
  patient_web_base: string;
}

export const settingsApi = {
  get: () => api.get<AppSettings>('/settings').then((r) => r.data),
  update: (body: Partial<AppSettings>) =>
    api.patch<AppSettings>('/settings', body).then((r) => r.data),
};

// ── Schedules & leave ────────────────────────────────────────
export const schedulesApi = {
  list: (doctorId: string) =>
    api.get<ScheduleEntry[]>(`/doctors/${doctorId}/schedules`).then((r) => r.data),
  replace: (doctorId: string, entries: ScheduleEntry[]) =>
    api
      .put<ScheduleEntry[]>(`/doctors/${doctorId}/schedules`, { entries })
      .then((r) => r.data),
  listLeave: (doctorId: string) =>
    api
      .get<{ id: string; date: string; reason: string | null }[]>(
        `/doctors/${doctorId}/leave`,
      )
      .then((r) => r.data),
  markLeave: (doctorId: string, date: string, reason?: string) =>
    api.post(`/doctors/${doctorId}/leave`, { date, reason }).then((r) => r.data),
  removeLeave: (doctorId: string, date: string) =>
    api.delete(`/doctors/${doctorId}/leave/${date}`).then((r) => r.data),
  // Authenticated preview — works for disabled doctors too (unlike the public route).
  slots: (doctorId: string, date: string) =>
    api
      .get<DaySlots>(`/doctors/${doctorId}/slots`, { params: { date } })
      .then((r) => r.data),
};

// ── Appointments ─────────────────────────────────────────────
export const appointmentsApi = {
  list: (params: {
    doctorId?: string;
    date?: string;
    status?: string;
    search?: string;
    range?: 'today' | 'upcoming' | 'previous';
  }) => api.get<Appointment[]>('/appointments', { params }).then((r) => r.data),
  get: (id: string) => api.get<Appointment>(`/appointments/${id}`).then((r) => r.data),
  // Scoped to the patient, not the number — a family member's visits must
  // never appear under someone else's appointment.
  history: (profileId: string, excludeId?: string) =>
    api
      .get<Appointment[]>('/appointments/history', { params: { profileId, excludeId } })
      .then((r) => r.data),
  cancel: (id: string) => api.delete(`/appointments/${id}`).then((r) => r.data),
  bookWalkIn: (body: Record<string, unknown>) =>
    api.post<Appointment>('/appointments/walk-in', body).then((r) => r.data),
  reschedule: (id: string, date: string, startTime: string) =>
    api
      .patch<Appointment>(`/appointments/${id}/reschedule`, {
        appointment_date: date,
        start_time: startTime,
      })
      .then((r) => r.data),
  addPrescriptions: (id: string, files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('images', f));
    return api
      .post<Appointment>(`/appointments/${id}/prescriptions`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
  deletePrescription: (id: string, prescriptionId: string) =>
    api
      .delete<Appointment>(`/appointments/${id}/prescriptions/${prescriptionId}`)
      .then((r) => r.data),
  setConsultation: (id: string, status: string) =>
    api
      .patch<Appointment>(`/appointments/${id}/consultation`, { status })
      .then((r) => r.data),
  setNotes: (id: string, notes: string) =>
    api.patch<Appointment>(`/appointments/${id}/notes`, { notes }).then((r) => r.data),
  addReminder: (id: string, message: string, suggestedDate?: string) =>
    api
      .post<Appointment>(`/appointments/${id}/reminder`, {
        message,
        suggested_date: suggestedDate || undefined,
      })
      .then((r) => r.data),
};

// ── Consultation & e-prescription ────────────────────────────
export const consultationApi = {
  // Transcription runs in the background; poll `session` for progress.
  uploadAudio: (appointmentId: string, audio: Blob) => {
    const fd = new FormData();
    fd.append('audio', audio, 'consultation.webm');
    return api
      .post<ConsultationSession>(`/appointments/${appointmentId}/consultation/audio`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
  session: (appointmentId: string) =>
    api
      .get<ConsultationSession | null>(`/appointments/${appointmentId}/consultation`)
      .then((r) => r.data),
  prescription: (appointmentId: string) =>
    api.get<EPrescription>(`/appointments/${appointmentId}/prescription`).then((r) => r.data),
  savePrescription: (appointmentId: string, body: Record<string, unknown>) =>
    api
      .patch<EPrescription>(`/appointments/${appointmentId}/prescription`, body)
      .then((r) => r.data),
  issuePrescription: (appointmentId: string) =>
    api
      .post<EPrescription>(`/appointments/${appointmentId}/prescription/issue`)
      .then((r) => r.data),
  /** The issued PDF itself, for the share sheet or a download. */
  prescriptionPdf: (appointmentId: string) =>
    api
      .get(`/appointments/${appointmentId}/prescription/pdf`, { responseType: 'blob' })
      .then((r) => ({
        blob: r.data as Blob,
        filename: filenameFromDisposition(
          r.headers['content-disposition'],
          'prescription.pdf',
        ),
      })),
  saveHandwriting: (appointmentId: string, image: Blob) => {
    const fd = new FormData();
    fd.append('file', image, 'handwriting.png');
    return api
      .post<EPrescription>(`/appointments/${appointmentId}/prescription/handwriting`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
};

export const medicinesApi = {
  search: (q: string) =>
    api.get<MedicineCatalogEntry[]>('/medicines', { params: { q } }).then((r) => r.data),
};

// ── Dashboard ────────────────────────────────────────────────
export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/dashboard').then((r) => r.data),
};

// ── Pathlabs ─────────────────────────────────────────────────
export const pathlabsApi = {
  list: () => api.get<User[]>('/pathlabs').then((r) => r.data),
  create: (body: { name: string; email: string; password: string }) =>
    api.post<User>('/pathlabs', body).then((r) => r.data),
  update: (id: string, body: Partial<{ name: string; email: string; password: string; is_active: boolean }>) =>
    api.patch<User>(`/pathlabs/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/pathlabs/${id}`).then((r) => r.data),
};

// ── Reports ──────────────────────────────────────────────────
export const reportsApi = {
  list: (profileId: string) =>
    api.get<PatientReport[]>('/reports', { params: { profileId } }).then((r) => r.data),
  // The patient must be named: one number may cover a whole family, and a
  // report filed against the wrong member cannot be detected later.
  upload: (mobile: string, profileId: string, title: string, file: File) => {
    const fd = new FormData();
    fd.append('mobile', mobile);
    fd.append('patient_profile_id', profileId);
    fd.append('title', title);
    fd.append('file', file);
    return api
      .post('/reports', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data);
  },
  remove: (id: string) => api.delete(`/reports/${id}`).then((r) => r.data),
  retrySummary: (id: string) =>
    api.post(`/reports/${id}/summary/retry`).then((r) => r.data),
  retryVisitSummary: (appointmentId: string) =>
    api.post(`/reports/appointment/${appointmentId}/summary/retry`).then((r) => r.data),
  retryProgress: (appointmentId: string) =>
    api.post(`/reports/appointment/${appointmentId}/progress/retry`).then((r) => r.data),
  /** Save the doctor's corrected trajectory — also captured as training data. */
  saveProgress: (appointmentId: string, summary: ProgressSummary) =>
    api
      .patch<Appointment>(`/reports/appointment/${appointmentId}/progress`, summary)
      .then((r) => r.data),
};

// ── Patients on a mobile number ──────────────────────────────
export const patientProfilesApi = {
  byMobile: (mobile: string) =>
    api
      .get<PatientProfile[]>('/patient-profiles/by-mobile', { params: { mobile } })
      .then((r) => r.data),
};

// ── Blocked numbers ──────────────────────────────────────────
// A clinic's own defence against nuisance bookings. Scoped per doctor: the
// server derives the tenant from the caller, so nothing here names a doctor.
export const blockedNumbersApi = {
  list: () => api.get<BlockedNumber[]>('/blocked-numbers').then((r) => r.data),
  block: (mobile: string, reason?: string) =>
    api.post<BlockedNumber>('/blocked-numbers', { mobile, reason }).then((r) => r.data),
  unblock: (id: string) =>
    api.delete<{ ok: boolean }>(`/blocked-numbers/${id}`).then((r) => r.data),
};

/**
 * Doctor self-registration. Public — no token, because the account it creates
 * cannot be used until the super admin approves it.
 */
export const doctorRegistrationApi = {
  register: (form: FormData) =>
    api
      .post<{ ok: boolean; message: string }>('/doctors/register', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data),
};
