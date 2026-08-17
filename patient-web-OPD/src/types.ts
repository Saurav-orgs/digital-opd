export interface Doctor {
  id: string;
  name: string;
  specialization?: string | null;
  qualifications?: string | null;
  bio?: string | null;
  consultationFee?: string | null;
  consultation_fee?: string | number | null;
  profilePhotoUrl?: string | null;
  profile_photo_url?: string | null;
  paymentQrUrl?: string | null;
  payment_qr_url?: string | null;
  publicSlug: string;
  public_slug?: string | null;
}

export type SlotStatus = 'available' | 'booked' | 'past';

export interface Slot {
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  status: SlotStatus;
  selectable: boolean;
}

export interface DaySlots {
  date: string; // YYYY-MM-DD
  available: boolean;
  reason?: 'leave' | 'no_opd' | 'out_of_window' | string | null;
  slots: Slot[];
}

export interface BookingResult {
  id: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  patientName: string;
  doctorName?: string | null;
}

export interface PatientAuthUser {
  id: string;
  mobile: string;
  name: string;
}

export interface PatientPrescription {
  id: string;
  url: string | null;
}

/** One consultation visit — the patient's booking history. */
export interface PatientVisit {
  id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: 'confirmed' | 'rejected';
  consultation_status: 'pending' | 'done' | 'on_hold' | 'rejected';
  payment_status: 'paid_unverified' | 'verified' | 'rejected';
  description: string | null;
  doctor_notes: string | null;
  next_visit_note: string | null;
  next_visit_date: string | null;
  doctor?: { id: string; name: string; specialization?: string | null };
  prescriptions: PatientPrescription[];
  reports: PatientReport[];
}

export interface PatientReport {
  id: string;
  title: string;
  url: string | null;
  createdAt: string;
}

export interface PatientNotification {
  id: string;
  type: 'report_available' | 'appointment_reminder';
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  read_at: string | null;
  createdAt: string;
}

export class ApiException extends Error {
  code: string;
  statusCode: number;
  details?: any;

  constructor(code: string, message: string, statusCode: number, details?: any) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'ApiException';
  }
}
