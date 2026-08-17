export type UserType = 'super_admin' | 'admin' | 'doctor' | 'pathlab';
export type PermModule =
  | 'users'
  | 'roles'
  | 'doctors'
  | 'opd_schedules'
  | 'appointments'
  | 'dashboard'
  | 'pathlabs'
  | 'reports';
export type PermAction = 'create' | 'read' | 'update' | 'delete';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  type: UserType;
  roleId: string | null;
  doctorId: string | null;
  permissions: string[]; // "module:action"
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permissions: Permission[];
}

export interface Permission {
  id: string;
  module: PermModule;
  action: PermAction;
}

export interface User {
  id: string;
  name: string;
  email: string;
  type: UserType;
  role_id: string | null;
  doctor_id: string | null;
  is_active: boolean;
  role?: Role;
  doctor?: Doctor;
}

export interface Doctor {
  id: string;
  name: string;
  specialization: string | null;
  qualifications: string | null;
  bio: string | null;
  consultation_fee: string | null;
  profile_photo_url: string | null;
  payment_qr_url: string | null;
  public_slug: string;
  is_enabled: boolean;
}

export interface ScheduleEntry {
  id?: string;
  day_of_week: number;
  start_time: string; // HH:mm or HH:mm:ss
  end_time: string;
  slot_duration_min: number;
  is_active?: boolean;
}

export type SlotStatus = 'available' | 'booked' | 'past';
export interface Slot {
  start_time: string;
  end_time: string;
  status: SlotStatus;
}
export interface DaySlots {
  date: string;
  available: boolean;
  reason?: 'leave' | 'no_opd' | 'out_of_window';
  slots: Slot[];
}

export type AppointmentStatus = 'confirmed' | 'rejected';
export type ConsultationStatus = 'pending' | 'done' | 'on_hold' | 'rejected';
export type PaymentStatus = 'paid_unverified' | 'verified' | 'rejected';

export interface PrescriptionImage {
  id: string;
  url: string;
}

export interface Appointment {
  id: string;
  doctor_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  patient_name: string;
  patient_mobile: string;
  patient_gender: string | null;
  patient_age: number | null;
  patient_address: string | null;
  description: string | null;
  doctor_notes: string | null;
  next_visit_note: string | null;
  next_visit_date: string | null;
  payment_screenshot_url: string;
  status: AppointmentStatus;
  consultation_status: ConsultationStatus;
  payment_status: PaymentStatus;
  payment_method: 'online' | 'cod' | null;
  source: 'app' | 'web' | 'walk_in';
  on_leave: boolean;
  prescriptions: PrescriptionImage[];
  reports: PatientReport[];
  createdAt?: string;
  doctor?: Pick<Doctor, 'id' | 'name' | 'specialization' | 'consultation_fee'>;
  screenshot_url?: string;
}

export interface DashboardSummary {
  date: string;
  total: number;
  upcoming: number;
  previous: number;
  pending: { today: number; upcoming: number; previous: number };
  byDoctor: { doctorId: string; name: string; count: number }[];
  byStatus: Record<string, number>;
  appointments: Appointment[];
}

export interface PatientReport {
  id: string;
  title: string;
  url: string;
  createdAt: string;
}
