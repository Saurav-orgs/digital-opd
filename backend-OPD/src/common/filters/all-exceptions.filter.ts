import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import {
  BaseError as SequelizeBaseError,
  UniqueConstraintError,
  ValidationError as SequelizeValidationError,
  DatabaseError,
} from 'sequelize';
import { Request, Response } from 'express';
import { AppException } from '../errors/app.exception';
import { ErrorCode, ERROR_CATALOG } from '../errors/error-codes';

interface ErrorResponseBody {
  success: false;
  statusCode: number;
  error: ErrorCode | string;
  message: string;
  details?: unknown;
  path: string;
  timestamp: string;
}

/**
 * Global filter producing the single, consistent error contract (plan §13):
 *   { success:false, statusCode, error, message, path, timestamp, details? }
 * `message` is always safe to render directly to the end user.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.resolve(exception);

    // Log server-side faults with full context; client faults stay quiet.
    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${body.statusCode} ${body.error}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} → ${body.statusCode} ${body.error}`,
      );
    }

    response.status(body.statusCode).json({
      ...body,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private resolve(
    exception: unknown,
  ): Omit<ErrorResponseBody, 'path' | 'timestamp'> {
    // 1. Our own domain exceptions — already shaped.
    if (exception instanceof AppException) {
      const res = exception.getResponse() as {
        error: ErrorCode;
        message: string;
        details?: unknown;
      };
      return {
        success: false,
        statusCode: exception.getStatus(),
        error: res.error,
        message: res.message,
        details: res.details,
      };
    }

    // 2. Rate limiting.
    if (exception instanceof ThrottlerException) {
      return {
        success: false,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: ErrorCode.RATE_LIMITED,
        message: ERROR_CATALOG[ErrorCode.RATE_LIMITED].message,
      };
    }

    // 3. Framework HttpExceptions (validation pipe, NotFound, Forbidden, ...).
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    // 4. Sequelize errors.
    if (exception instanceof UniqueConstraintError) {
      return {
        success: false,
        statusCode: HttpStatus.CONFLICT,
        error: ErrorCode.CONFLICT,
        message: 'A record with these details already exists.',
        details: this.env() ? exception.errors?.map((e) => e.message) : undefined,
      };
    }
    if (exception instanceof SequelizeValidationError) {
      return {
        success: false,
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: ErrorCode.VALIDATION_FAILED,
        message: ERROR_CATALOG[ErrorCode.VALIDATION_FAILED].message,
        details: exception.errors?.map((e) => ({
          field: e.path,
          message: e.message,
        })),
      };
    }
    if (
      exception instanceof DatabaseError ||
      exception instanceof SequelizeBaseError
    ) {
      return {
        success: false,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: ErrorCode.INTERNAL_ERROR,
        message: ERROR_CATALOG[ErrorCode.INTERNAL_ERROR].message,
      };
    }

    // 5. Anything else — never leak internals.
    return {
      success: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: ErrorCode.INTERNAL_ERROR,
      message: ERROR_CATALOG[ErrorCode.INTERNAL_ERROR].message,
    };
  }

  private fromHttpException(
    exception: HttpException,
  ): Omit<ErrorResponseBody, 'path' | 'timestamp'> {
    const status = exception.getStatus();
    const raw = exception.getResponse();

    // Custom-shaped payload already carrying our `error` code (e.g. from the
    // validation pipe's exceptionFactory).
    if (raw && typeof raw === 'object' && 'error' in raw) {
      const r = raw as { error: string; message?: string; details?: unknown };
      if (Object.values(ErrorCode).includes(r.error as ErrorCode)) {
        return {
          success: false,
          statusCode: status,
          error: r.error,
          message:
            r.message ??
            ERROR_CATALOG[r.error as ErrorCode]?.message ??
            'Request failed.',
          details: r.details,
        };
      }
    }

    // Otherwise map the HTTP status to a domain code + readable message.
    const code = this.statusToCode(status);
    const message = this.readableMessage(raw, code);
    return { success: false, statusCode: status, error: code, message };
  }

  private statusToCode(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return ErrorCode.FILE_TOO_LARGE;
      case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
        return ErrorCode.UNSUPPORTED_FILE_TYPE;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ErrorCode.VALIDATION_FAILED;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      default:
        return status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST;
    }
  }

  /** Prefer the framework message, but fall back to our friendly catalog text. */
  private readableMessage(raw: unknown, code: ErrorCode): string {
    if (typeof raw === 'string' && raw.trim()) return raw;
    if (raw && typeof raw === 'object' && 'message' in raw) {
      const m = (raw as { message: unknown }).message;
      if (typeof m === 'string' && m.trim()) return m;
      if (Array.isArray(m) && m.length) return m.join(' ');
    }
    return ERROR_CATALOG[code]?.message ?? 'Request failed.';
  }

  private env(): boolean {
    return process.env.NODE_ENV !== 'production';
  }
}
