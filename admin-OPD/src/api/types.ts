export type UserType = 'super_admin' | 'admin' | 'doctor' | 'pathlab';
export type PermModule =
  | 'users'
  | 'roles'
  | 'doctors'
  | 'opd_schedules'
  | 'appointments'
  | 'dashboard'
  | 'pathlabs'
  | 'reports'
  | 'activity'
  | 'patients';
export type PermAction = 'create' | 'read' | 'update' | 'delete';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  type: UserType;
  roleId: string | null;
  /** The role's name, shown beside the user's own on the header. */
  roleName: string | null;
  doctorId: string | null;
  /** Opened through the paid sign-up — a null doctorId then means "profile not set up yet". */
  subscriptionRequired: boolean;
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
  verification_status?: 'pending' | 'approved' | 'rejected';
  profile_photo_url: string | null;
  public_slug: string;
  is_enabled: boolean;
  profile_base_url?: string | null;
  booking_url?: string;
  qr_code_url?: string | null;
  // Prescription letterhead (per-doctor branding)
  clinic_name: string | null;
  clinic_address: string | null;
  clinic_phone: string | null;
  clinic_logo_url: string | null;
  /** The doctor's own uploaded pad header, drawn as the PDF header when set. */
  letterhead_header_url?: string | null;
  /**
   * Width ÷ height of that image. The PDF sizes the header to it; null for
   * one uploaded before it was measured, which prints in the old fixed box.
   */
  letterhead_header_ratio?: number | null;
}

/** A doctor as the super admin reviews them: profile plus the licence on file. */
export interface DoctorProfile extends Doctor {
  license_number: string | null;
  contact_mobile: string | null;
  /** Short-lived signed link to the certificate; null when none was uploaded. */
  license_url: string | null;
  rejection_reason: string | null;
  reviewed_at: string | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
  created_at: string | null;
  login_email: string | null;
  login_active: boolean;
}

/** Returned once by POST /doctors — never returned again, so show it immediately. */
export interface CreateDoctorResult {
  doctor: Doctor;
  doctorRole: { id: string; name: string };
  pathlabRole: { id: string; name: string };
  login: { email: string; tempPassword: string };
  qrUrl: string;
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

/** `cancelled` is the patient withdrawing the booking; `rejected` the clinic. */
export type AppointmentStatus = 'confirmed' | 'rejected' | 'cancelled';
export type ConsultationStatus =
  | 'pending'
  | 'done'
  | 'on_hold'
  | 'rejected'
  // The patient never arrived — the clinic did not call the visit off, which
  // is what `rejected` means.
  | 'no_show';

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
  patient_city: string | null;
  patient_state: string | null;
  patient_pincode: string | null;
  /** Which person on the number this visit is for — the clinical identity. */
  patient_profile_id: string | null;
  patientProfile?: PatientProfile | null;
  description: string | null;
  doctor_notes: string | null;
  next_visit_note: string | null;
  next_visit_date: string | null;
  status: AppointmentStatus;
  consultation_status: ConsultationStatus;
  source: 'app' | 'web' | 'walk_in';
  on_leave: boolean;
  prescriptions: PrescriptionImage[];
  reports: PatientReport[];
  /** Count only — sent by the list endpoint, which omits the reports themselves. */
  reports_count?: number;
  // Combined AI summary across all of this visit's reports.
  reports_summary?: ReportAiSummary | null;
  reports_summary_status?: AiJobStatus | null;
  reports_summary_error?: string | null;
  reports_summary_count?: number;
  // The across-visits picture: how this patient has moved since last time.
  progress_summary?: ProgressSummary | null;
  progress_summary_status?: AiJobStatus | null;
  progress_summary_error?: string | null;
  progress_summary_visit_count?: number;
  e_prescription?: EPrescription | null;
  createdAt?: string;
  doctor?: Pick<Doctor, 'id' | 'name' | 'specialization' | 'consultation_fee'>;
}

/** One person registered on a mobile number. Identity is `id`, never the name. */
export interface PatientProfile {
  id: string;
  patient_code: string;
  name: string;
  relation: string | null;
  gender: string | null;
  /** YYYY-MM-DD. Age is derived from it, so it never goes stale. */
  dob: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  /** Age recorded on the last visit — the fallback when there is no `dob`. */
  last_age: number | null;
  last_visit_date: string | null;
  visit_count: number;
  can_delete: boolean;
}

/**
 * A patient as the clinic's own list shows them: the profile, plus the number
 * it is registered under. The number lives on the account rather than the
 * patient, since one number carries a family.
 */
export interface ClinicPatient extends PatientProfile {
  mobile: string;
}

export type ProgressStatus = 'improving' | 'stable' | 'worsening' | 'unclear';

export interface ProgressTrend {
  label: string;
  previous_value: string;
  current_value: string;
  direction: 'up' | 'down' | 'same';
  interpretation: 'better' | 'worse' | 'unclear';
}

/**
 * What changed since the patient's last visit, and where they stand now.
 * Built by the AI service from the previous visit's summary plus this one's.
 */
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

export type AiJobStatus = 'pending' | 'processing' | 'ready' | 'failed';

export interface ReportAiSummary {
  report_type: string;
  summary: string;
  key_findings: string[];
  abnormal_values: {
    label: string;
    value: string;
    reference?: string;
    direction: 'high' | 'low' | 'abnormal';
    /** Lab panel the value belongs to, e.g. "Complete Blood Count". */
    category?: string;
    /** The lab's own flag, e.g. "LOW" / "HIGH". */
    status?: string;
  }[];
}

export interface PatientReport {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  ai_summary?: ReportAiSummary | null;
  ai_summary_status?: AiJobStatus;
  ai_summary_error?: string | null;
}

export type ConsultationStatusAi =
  /** Live transcription: the doctor is still talking and the transcript is growing. */
  | 'recording'
  | 'transcribing'
  | 'drafting'
  | 'draft_ready'
  | 'failed';

export interface ConsultationSession {
  id: string;
  appointment_id: string;
  status: ConsultationStatusAi;
  transcript: string | null;
  language: string | null;
  duration_seconds: number | null;
  error: string | null;
  /**
   * When the recording was handed over — what "taking too long" is measured
   * from. Both spellings, as `BlockedNumber` does: Sequelize serialises its
   * timestamps camelCase, but the rest of this payload is snake_case, so a
   * serialiser change should not silently stop the clock.
   */
  createdAt?: string;
  created_at?: string;
}

export interface PrescriptionMedicine {
  id?: string;
  medicine_name: string;
  strength?: string | null;
  form?: string | null;
  dosage?: string;
  duration_days?: number | null;
  instructions?: string | null;
  source?: 'ai' | 'doctor';
  was_edited?: boolean;
}

export interface EPrescription {
  id: string;
  appointment_id: string;
  consultation_session_id: string | null;
  status: 'draft' | 'issued';
  mode: 'structured' | 'handwritten';
  diagnosis: string | null;
  /** The patient's background as the doctor put it on record. Usually null
   *  — the editor shows the field only when there is something in it. */
  previous_history: string | null;
  advice: string | null;
  follow_up_date: string | null;
  issued_at: string | null;
  pdf_url: string | null;
  handwriting_image_url: string | null;
  medicines: PrescriptionMedicine[];
}

export interface MedicineCatalogEntry {
  id: string;
  name: string;
  strength: string | null;
  form: string | null;
  usage_count: number;
}

/** A self-registered doctor awaiting review, with their licence to inspect. */
export interface PendingDoctor extends Doctor {
  license_number: string | null;
  contact_mobile: string | null;
  /** Presigned link to the uploaded practice licence. */
  license_url: string | null;
}

export interface BlockedNumber {
  id: string;
  mobile: string;
  reason: string | null;
  createdAt?: string;
  created_at?: string;
  /** Who pressed Block — null for a row written before this was recorded. */
  blocked_by?: { id: string; name: string } | null;
  /** Everyone registered on the number; empty when nobody is yet. */
  patients?: { id: string; name: string; patient_code: string }[];
}

// ── Billing: plans, subscriptions and the payment log ─────────

export interface PlanPrice {
  base: number;
  gstRate: number;
  gst: number;
  total: number;
}

export interface Plan {
  id: string;
  /** Stable code the landing page links to (`/signup?plan=…`). */
  code: string;
  name: string;
  tagline: string | null;
  /** Rupees per month, before GST. */
  monthly: number;
  months: number;
  isActive: boolean;
  isRecommended: boolean;
  sortOrder: number;
  price: PlanPrice;
  /** Doctors on this plan right now. Super-admin list only. */
  activeCount?: number;
}

export interface PlanInput {
  code?: string;
  name?: string;
  tagline?: string;
  monthly_amount?: number;
  months?: number;
  is_active?: boolean;
  is_recommended?: boolean;
  sort_order?: number;
}

export type SubscriptionStatus =
  | 'pending'
  | 'active'
  | 'failed'
  | 'expired'
  | 'cancelled';

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  planCode: string;
  planName: string;
  months: number;
  baseAmount: number;
  gstAmount: number;
  totalAmount: number;
  startsAt: string | null;
  endsAt: string | null;
  paidAt: string | null;
  orderId: string;
  paymentId: string | null;
  /** True when a super admin gave this out rather than it being paid online. */
  granted: boolean;
  grantNote: string | null;
  account: { userId: string; email: string; name: string };
  doctor: { id: string; name: string; specialization: string | null } | null;
}

export interface SubscriptionSummary {
  active: number;
  pending: number;
  expiringSoon: number;
  collected: number;
}

export type PaymentEventSource = 'webhook' | 'poll' | 'admin' | 'system';

export interface PaymentEvent {
  id: string;
  at: string;
  source: PaymentEventSource;
  eventType: string;
  status: string | null;
  applied: boolean;
  /** Null for events that are not webhooks; false means the HMAC did not match. */
  signatureValid: boolean | null;
  orderId: string | null;
  paymentId: string | null;
  amount: number | null;
  message: string | null;
  doctor: { id: string; name: string } | null;
  user: { id: string; email: string; name: string } | null;
  plan: string | null;
  subscriptionId: string | null;
  /** Cashfree's raw body. Super admin only. */
  payload?: unknown;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/** A doctor account in the "grant a plan" picker. */
export interface BillingAccount {
  userId: string;
  email: string;
  name: string;
  doctorName: string | null;
  currentPlan: string | null;
  endsAt: string | null;
}

export interface MyBilling {
  current: Subscription | null;
  history: Subscription[];
}
