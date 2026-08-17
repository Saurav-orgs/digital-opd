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

/** Payment lifecycle (pre-gateway). */
export enum PaymentStatus {
  PAID_UNVERIFIED = 'paid_unverified',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

/** Where a booking originated. `walk_in` is a doctor-created, in-clinic booking. */
export enum BookingSource {
  APP = 'app',
  WEB = 'web',
  WALK_IN = 'walk_in',
}

/** How the consultation is paid. Walk-ins are cash (cod); app/web are online. */
export enum PaymentMethod {
  ONLINE = 'online',
  COD = 'cod',
}

/** schedule_exceptions.type */
export enum ScheduleExceptionType {
  LEAVE = 'leave',
  CUSTOM = 'custom',
}
