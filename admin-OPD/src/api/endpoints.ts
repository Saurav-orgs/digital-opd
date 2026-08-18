import api from './client';
import type {
  Appointment,
  AuthUser,
  DashboardSummary,
  DaySlots,
  Doctor,
  LoginResponse,
  PatientReport,
  Permission,
  Role,
  ScheduleEntry,
  User,
} from './types';

// ── Auth ─────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { email, password }).then((r) => r.data),
  me: () => api.get<AuthUser>('/auth/me').then((r) => r.data),
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
// One profile per clinic, seeded on the server and owned by the SuperAdmin —
// hence no create/delete here.
export const doctorsApi = {
  list: () => api.get<Doctor[]>('/doctors').then((r) => r.data),
  get: (id: string) => api.get<Doctor>(`/doctors/${id}`).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) =>
    api.patch<Doctor>(`/doctors/${id}`, body).then((r) => r.data),
  enable: (id: string) => api.patch<Doctor>(`/doctors/${id}/enable`).then((r) => r.data),
  disable: (id: string) =>
    api.patch<Doctor>(`/doctors/${id}/disable`).then((r) => r.data),
  uploadQr: (id: string, file: File) => upload(`/doctors/${id}/qr`, file),
  uploadPhoto: (id: string, file: File) => upload(`/doctors/${id}/photo`, file),
  // Doctor self-service
  me: () => api.get<Doctor>('/doctors/me').then((r) => r.data),
  updateMe: (body: Partial<Doctor>) =>
    api.patch<Doctor>('/doctors/me', body).then((r) => r.data),
  uploadMyQr: (file: File) => upload('/doctors/me/qr', file),
  uploadMyPhoto: (file: File) => upload('/doctors/me/photo', file),
};

function upload(url: string, file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return api
    .post<Doctor>(url, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    .then((r) => r.data);
}

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
  history: (mobile: string, excludeId?: string) =>
    api
      .get<Appointment[]>('/appointments/history', { params: { mobile, excludeId } })
      .then((r) => r.data),
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
  setPayment: (id: string, status: string) =>
    api.patch<Appointment>(`/appointments/${id}/payment`, { status }).then((r) => r.data),
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
  list: (mobile: string) =>
    api.get<PatientReport[]>('/reports', { params: { mobile } }).then((r) => r.data),
  upload: (mobile: string, title: string, file: File) => {
    const fd = new FormData();
    fd.append('mobile', mobile);
    fd.append('title', title);
    fd.append('file', file);
    return api
      .post('/reports', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data);
  },
  remove: (id: string) => api.delete(`/reports/${id}`).then((r) => r.data),
};
