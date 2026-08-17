import { HttpException } from '@nestjs/common';
import { ErrorCode, ERROR_CATALOG } from './error-codes';

export interface AppExceptionBody {
  error: ErrorCode;
  message: string;
  details?: unknown;
}

/**
 * Domain exception carrying a stable machine code + a user-facing message.
 * Throw this anywhere in the app: `throw new AppException(ErrorCode.SLOT_IN_PAST)`.
 * Optionally override the message or attach structured `details`
 * (e.g. the conflicting bookings for LEAVE_HAS_BOOKINGS).
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    options?: { message?: string; details?: unknown; status?: number },
  ) {
    const catalog = ERROR_CATALOG[code];
    const status = options?.status ?? catalog.status;
    const message = options?.message ?? catalog.message;
    super({ error: code, message, details: options?.details }, status);
    this.code = code;
    this.details = options?.details;
  }
}
