/** Principal type — decides DATA SCOPE only, never abilities (plan §2). */
export enum UserType {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  DOCTOR = 'doctor',
  PATHLAB = 'pathlab',
}

/** Modules that permissions and the web sidebar are organised around. */
export enum PermissionModule {
  USERS = 'users',
  ROLES = 'roles',
  DOCTORS = 'doctors',
  OPD_SCHEDULES = 'opd_schedules',
  APPOINTMENTS = 'appointments',
  DASHBOARD = 'dashboard',
  PATHLABS = 'pathlabs',
  REPORTS = 'reports',
}

/** Kinds of in-app patient notification. */
export enum NotificationType {
  REPORT_AVAILABLE = 'report_available',
  APPOINTMENT_REMINDER = 'appointment_reminder',
  PRESCRIPTION_READY = 'prescription_ready',
}

/**
 * Lifecycle of an asynchronous AI job (report summary, transcription).
 * Stored per-row so the UI can show progress and the reason for a failure.
 */
export enum AiJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

/** CRUD actions a role may be granted per module. */
export enum PermissionAction {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
}

/** appointments.status — only `confirmed` occupies a slot (plan §4). */
export enum AppointmentStatus {
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
}

/** Doctor's post-checkup marking. */
export enum ConsultationStatus {
  PENDING = 'pending',
  DONE = 'done',
  ON_HOLD = 'on_hold',
  REJECTED = 'rejected',
}

/** Where a booking originated. `walk_in` is a doctor-created, in-clinic booking. */
export enum BookingSource {
  APP = 'app',
  WEB = 'web',
  WALK_IN = 'walk_in',
}

/** schedule_exceptions.type */
export enum ScheduleExceptionType {
  LEAVE = 'leave',
  CUSTOM = 'custom',
}

/** Lifecycle of a recorded consultation, from upload to a usable draft. */
export enum ConsultationSessionStatus {
  TRANSCRIBING = 'transcribing',
  DRAFTING = 'drafting',
  DRAFT_READY = 'draft_ready',
  FAILED = 'failed',
}

/** A prescription is only visible to the patient once `issued`. */
export enum PrescriptionStatus {
  DRAFT = 'draft',
  ISSUED = 'issued',
}

/** How the prescription body was produced. */
export enum PrescriptionMode {
  /** Diagnosis + structured medicine rows (voice draft or typed). */
  STRUCTURED = 'structured',
  /** A handwritten image the doctor drew, composited onto the letterhead. */
  HANDWRITTEN = 'handwritten',
}

/** Whether a medicine row was suggested by the AI or typed by the doctor. */
export enum MedicineSource {
  AI = 'ai',
  DOCTOR = 'doctor',
}

/** What a captured training pair is for. */
export enum TrainingSampleKind {
  PRESCRIPTION = 'prescription',
  REPORT_SUMMARY = 'report_summary',
}
