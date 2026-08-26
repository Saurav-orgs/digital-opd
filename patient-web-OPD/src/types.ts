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

export type ProgressStatus = 'improving' | 'stable' | 'worsening' | 'unclear';

export interface ProgressTrend {
  label: string;
  previous_value: string;
  current_value: string;
  direction: 'up' | 'down' | 'same';
  interpretation: 'better' | 'worse' | 'unclear';
}

/** The across-visits picture the doctor reads; also shown to the patient. */
export interface ProgressSummary {
  status: ProgressStatus;
  summary: string;
  improvements: string[];
  deteriorations: string[];
  unchanged: string[];
  trends: ProgressTrend[];
  current_status: string;
  watch_points: string[];
}

/** The logged-in *account* — a phone number. The people on it are `PatientProfile`s. */
export interface PatientAuthUser {
  id: string;
  mobile: string;
}

/**
 * One person registered on a number. Two of these may share a name and still be
 * different patients — `id` is the identity, never the name.
 */
export interface PatientProfile {
  id: string;
  patient_code: string;
  name: string;
  relation: string | null;
  gender: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  last_age: number | null;
  last_visit_date: string | null;
  visit_count: number;
  /** False once an OPD has been completed — the record is permanent then. */
  can_delete: boolean;
}

/** What Step 1 of booking returns for a number. */
export interface IdentifyResult {
  accessToken: string;
  mobile: string;
  patients: PatientProfile[];
}

/** The details captured when registering a patient, on any path. */
export interface PatientDetailsInput {
  name: string;
  gender?: string;
  age?: number;
  relation?: string;
  address_line: string;
  city: string;
  state: string;
  pincode: string;
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
  status: 'confirmed' | 'rejected' | 'cancelled';
  consultation_status: 'pending' | 'done' | 'on_hold' | 'rejected';
  /** Whether the patient may still upload reports to this visit. */
  accepts_reports: boolean;
  description: string | null;
  doctor_notes: string | null;
  next_visit_note: string | null;
  next_visit_date: string | null;
  doctor?: { id: string; name: string; specialization?: string | null };
  prescriptions: PatientPrescription[];
  reports: PatientReport[];
  e_prescription?: IssuedPrescription | null;
}

export interface PatientReport {
  id: string;
  title: string;
  url: string | null;
  createdAt: string;
}

export interface IssuedMedicine {
  id: string;
  medicine_name: string;
  strength: string | null;
  form: string | null;
  dosage: string;
  timing: string | null;
  duration_days: number | null;
  instructions: string | null;
}

/** Only present once the doctor has issued it — drafts are never sent here. */
export interface IssuedPrescription {
  id: string;
  diagnosis: string | null;
  advice: string | null;
  follow_up_date: string | null;
  issued_at: string | null;
  pdf_url: string | null;
  medicines: IssuedMedicine[];
}

export interface PatientNotification {
  id: string;
  /** Which patient on the account this concerns; null = the account itself. */
  patient_profile_id: string | null;
  type:
    | 'report_available'
    | 'appointment_reminder'
    | 'prescription_ready'
    | 'appointment_cancelled';
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
