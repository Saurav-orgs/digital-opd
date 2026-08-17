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

  // Patient portal
  PATIENT_NOT_FOUND = 'PATIENT_NOT_FOUND',
  PATIENT_EXISTS = 'PATIENT_EXISTS',

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
    message: 'Bookings are only open for the next 7 days.',
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
    message: 'Something went wrong on our end. Please try again.',
  },
};
