import { HttpStatus } from '@nestjs/common';

/**
 * Stable, machine-readable domain error codes (plan §13).
 * Clients switch on `error`, never on `message`. `message` is a
 * human-readable, user-facing sentence safe to display as-is.
 */
export enum ErrorCode {
  // Booking / slots
  SLOT_ALREADY_BOOKED = 'SLOT_ALREADY_BOOKED',
  SLOT_IN_PAST = 'SLOT_IN_PAST',
  SLOT_NOT_FOUND = 'SLOT_NOT_FOUND',
  DATE_OUT_OF_WINDOW = 'DATE_OUT_OF_WINDOW',
  DOCTOR_ON_LEAVE = 'DOCTOR_ON_LEAVE',
  DOCTOR_DISABLED = 'DOCTOR_DISABLED',
  NO_OPD_ON_DATE = 'NO_OPD_ON_DATE',
  LEAVE_HAS_BOOKINGS = 'LEAVE_HAS_BOOKINGS',
  SCHEDULE_OVERLAP = 'SCHEDULE_OVERLAP',

  // Uploads
  FILE_REQUIRED = 'FILE_REQUIRED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE = 'UNSUPPORTED_FILE_TYPE',
  UPLOAD_FAILED = 'UPLOAD_FAILED',

  // Auth / access
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
  /** The account's plan is unpaid or has run out. */
  SUBSCRIPTION_REQUIRED = 'SUBSCRIPTION_REQUIRED',
  /** A temporary password has to be replaced before anything else. */
  PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED',

  // Patient portal
  PATIENT_NOT_FOUND = 'PATIENT_NOT_FOUND',
  PATIENT_EXISTS = 'PATIENT_EXISTS',

  // Prescriptions
  /**
   * A write to a prescription this visit has already handed to the patient.
   * Issuing bakes the scans and the medicines into a PDF the patient holds, so
   * adding or deleting one afterwards would leave their copy and ours saying
   * different things. Withdraw first.
   */
  PRESCRIPTION_ALREADY_ISSUED = 'PRESCRIPTION_ALREADY_ISSUED',

  // Prescription templates
  /**
   * A template with neither a medicine nor advice. The rule spans two tables,
   * so no CHECK constraint can hold it and the service says so instead.
   */
  TEMPLATE_EMPTY = 'TEMPLATE_EMPTY',
  /** The doctor already has a template under this name. */
  TEMPLATE_NAME_TAKEN = 'TEMPLATE_NAME_TAKEN',

  // IVF case-sheet
  /** The IVF case-sheet is offered only to IVF & Fertility doctors. */
  CASE_SHEET_NOT_AVAILABLE = 'CASE_SHEET_NOT_AVAILABLE',
  /** A case-sheet with nothing filled in — nothing goes to a patient empty. */
  CASE_SHEET_EMPTY = 'CASE_SHEET_EMPTY',

  // Depended-on services. All of these are "come back in a moment", never
  // "something went wrong": the request was fine, something we call was not.
  /** The payment gateway could not be reached, or answered nonsense. */
  PAYMENT_GATEWAY_UNAVAILABLE = 'PAYMENT_GATEWAY_UNAVAILABLE',
  /** Online payment has no keys configured on this server. */
  PAYMENT_NOT_CONFIGURED = 'PAYMENT_NOT_CONFIGURED',
  /** The mail server refused or timed out. */
  EMAIL_SEND_FAILED = 'EMAIL_SEND_FAILED',
  /** WhatsApp refused the send — wrong number, template, or setup. */
  WHATSAPP_SEND_FAILED = 'WHATSAPP_SEND_FAILED',
  /** The transcription / summary sidecar is down or still loading. */
  AI_UNAVAILABLE = 'AI_UNAVAILABLE',
  /** The database is unreachable, or too busy to answer in time. */
  SERVICE_BUSY = 'SERVICE_BUSY',
  /** Something we call took too long and we stopped waiting. */
  UPSTREAM_TIMEOUT = 'UPSTREAM_TIMEOUT',
  /** This clinic's records are still being prepared (roles, codes, defaults). */
  TENANT_SETUP_INCOMPLETE = 'TENANT_SETUP_INCOMPLETE',

  // Data integrity — a request that cannot be satisfied as written.
  /** Points at a record that does not exist (or is not this tenant's). */
  RELATED_RECORD_MISSING = 'RELATED_RECORD_MISSING',
  /** Cannot be removed while other records still point at it. */
  RECORD_IN_USE = 'RECORD_IN_USE',

  // Generic
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  BAD_REQUEST = 'BAD_REQUEST',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** Default HTTP status + user-facing message per code. */
export const ERROR_CATALOG: Record<
  ErrorCode,
  { status: HttpStatus; message: string }
> = {
  [ErrorCode.SLOT_ALREADY_BOOKED]: {
    status: HttpStatus.CONFLICT,
    message: 'This slot was just taken. Please pick another time.',
  },
  [ErrorCode.SLOT_IN_PAST]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'That time has already passed. Please choose a later slot.',
  },
  [ErrorCode.SLOT_NOT_FOUND]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'That slot is not part of the doctor’s schedule for this date.',
  },
  [ErrorCode.DATE_OUT_OF_WINDOW]: {
    status: HttpStatus.BAD_REQUEST,
    // How far ahead bookings are open is configurable (BOOKING_WINDOW_DAYS),
    // so the number lives with the window — `SlotsService` overrides this
    // message with the real one. This wording is the fallback and names no
    // figure, because a wrong figure is worse than none.
    message: 'That date is further ahead than bookings are open for.',
  },
  [ErrorCode.DOCTOR_ON_LEAVE]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The doctor is not available on this date.',
  },
  [ErrorCode.DOCTOR_DISABLED]: {
    status: HttpStatus.NOT_FOUND,
    message: 'This doctor is not available for booking right now.',
  },
  [ErrorCode.NO_OPD_ON_DATE]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The doctor has no OPD hours on this date.',
  },
  [ErrorCode.LEAVE_HAS_BOOKINGS]: {
    status: HttpStatus.CONFLICT,
    message:
      'This date already has confirmed bookings, so it cannot be marked as leave.',
  },
  [ErrorCode.SCHEDULE_OVERLAP]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Sessions on the same day cannot overlap. Please adjust the times.',
  },
  [ErrorCode.FILE_REQUIRED]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'A file is required.',
  },
  [ErrorCode.FILE_TOO_LARGE]: {
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    message: 'The file is too large. Please upload an image up to 5 MB.',
  },
  [ErrorCode.UNSUPPORTED_FILE_TYPE]: {
    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    message: 'Only JPG, PNG, or WebP images are allowed.',
  },
  [ErrorCode.UPLOAD_FAILED]: {
    status: HttpStatus.BAD_GATEWAY,
    message: 'We could not upload your file. Please try again.',
  },
  [ErrorCode.INVALID_CREDENTIALS]: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Incorrect email or password.',
  },
  [ErrorCode.UNAUTHORIZED]: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Please sign in to continue.',
  },
  [ErrorCode.FORBIDDEN]: {
    status: HttpStatus.FORBIDDEN,
    message: 'You do not have permission to perform this action.',
  },
  [ErrorCode.SUBSCRIPTION_REQUIRED]: {
    status: HttpStatus.PAYMENT_REQUIRED,
    message: 'Your subscription is not active. Please complete the payment to sign in.',
  },
  [ErrorCode.PASSWORD_CHANGE_REQUIRED]: {
    status: HttpStatus.FORBIDDEN,
    message: 'Please choose your own password before continuing.',
  },
  [ErrorCode.ACCOUNT_DISABLED]: {
    status: HttpStatus.FORBIDDEN,
    message: 'This account has been deactivated. Please contact an administrator.',
  },
  [ErrorCode.PATIENT_NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: 'No account found for this mobile number. Please register.',
  },
  [ErrorCode.PATIENT_EXISTS]: {
    status: HttpStatus.CONFLICT,
    message: 'An account with this mobile number already exists. Please login instead.',
  },
  [ErrorCode.PRESCRIPTION_ALREADY_ISSUED]: {
    status: HttpStatus.CONFLICT,
    message:
      "This visit's prescription has already been issued. Withdraw it first to make any changes.",
  },
  [ErrorCode.TEMPLATE_EMPTY]: {
    status: HttpStatus.BAD_REQUEST,
    message:
      'Add at least one medicine, or some advice, before saving this template.',
  },
  [ErrorCode.TEMPLATE_NAME_TAKEN]: {
    status: HttpStatus.CONFLICT,
    message: 'You already have a template with this name. Please pick another.',
  },
  [ErrorCode.CASE_SHEET_NOT_AVAILABLE]: {
    status: HttpStatus.FORBIDDEN,
    message:
      'The IVF prescription is available only for IVF & Fertility doctors.',
  },
  [ErrorCode.CASE_SHEET_EMPTY]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Fill in the prescription before issuing it.',
  },
  [ErrorCode.PAYMENT_GATEWAY_UNAVAILABLE]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message:
      'The payment service is not responding right now. No money has left your ' +
      'account. Please try again in a minute.',
  },
  [ErrorCode.PAYMENT_NOT_CONFIGURED]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message:
      'Online payment is not switched on for this clinic yet. Please contact ' +
      'support to complete your subscription.',
  },
  [ErrorCode.EMAIL_SEND_FAILED]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'We could not send that email just now. Please try again in a moment.',
  },
  [ErrorCode.WHATSAPP_SEND_FAILED]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message:
      'We could not send the WhatsApp message. Please check the number and try again.',
  },
  [ErrorCode.AI_UNAVAILABLE]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message:
      'The assistant that writes up consultations is not available right now. ' +
      'You can still write the prescription yourself, and recordings will be ' +
      'processed once it is back.',
  },
  [ErrorCode.SERVICE_BUSY]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message:
      'The system is busy and could not complete that. Nothing was saved — ' +
      'please try again in a few seconds.',
  },
  [ErrorCode.UPSTREAM_TIMEOUT]: {
    status: HttpStatus.GATEWAY_TIMEOUT,
    message: 'That took too long to finish. Please try again.',
  },
  [ErrorCode.TENANT_SETUP_INCOMPLETE]: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message:
      'This clinic is still being set up. Please try again shortly, or contact ' +
      'support if it keeps happening.',
  },
  [ErrorCode.RELATED_RECORD_MISSING]: {
    status: HttpStatus.CONFLICT,
    message:
      'Something this refers to no longer exists. Please refresh the page and ' +
      'try again.',
  },
  [ErrorCode.RECORD_IN_USE]: {
    status: HttpStatus.CONFLICT,
    message:
      'This is still being used elsewhere, so it cannot be removed. Remove ' +
      'those entries first.',
  },
  [ErrorCode.VALIDATION_FAILED]: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Some of the details are invalid. Please review and try again.',
  },
  [ErrorCode.NOT_FOUND]: {
    status: HttpStatus.NOT_FOUND,
    message: 'The requested item could not be found.',
  },
  [ErrorCode.CONFLICT]: {
    status: HttpStatus.CONFLICT,
    message: 'This action conflicts with the current state. Please refresh and retry.',
  },
  [ErrorCode.BAD_REQUEST]: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The request was invalid.',
  },
  [ErrorCode.RATE_LIMITED]: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Too many requests. Please wait a moment and try again.',
  },
  [ErrorCode.INTERNAL_ERROR]: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    // The genuine last resort: a fault nothing anticipated. Every failure a
    // user can actually cause has its own code above, so reaching this one is
    // a bug report waiting to happen — the filter appends a short reference
    // that also goes into the server log, so "it broke" becomes traceable.
    message:
      'Something went wrong on our end and your last action did not go ' +
      'through. Please try again.',
  },
};
