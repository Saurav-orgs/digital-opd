import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import {
  BaseError as SequelizeBaseError,
  ConnectionError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  TimeoutError as SequelizeTimeoutError,
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
  /** Only present on a true 500 — the id to quote when reporting it. */
  reference?: string;
  path: string;
  timestamp: string;
}

type ResolvedError = Omit<ErrorResponseBody, 'path' | 'timestamp'>;

/**
 * PostgreSQL SQLSTATE codes we can say something useful about.
 *
 * Without this table every one of these arrives as `DatabaseError` and leaves
 * as a 500 reading "something went wrong on our end" — which is both unhelpful
 * and untrue: a mobile number one character too long for its column is the
 * user's typo, not our outage, and telling them so is the difference between a
 * corrected field and a support call.
 */
const PG_CODE_MAP: Record<string, { code: ErrorCode; message?: string }> = {
  // 23502 not_null_violation — a required column arrived empty.
  '23502': {
    code: ErrorCode.VALIDATION_FAILED,
    message: 'A required detail is missing. Please fill in every required field.',
  },
  // 22001 string_data_right_truncation — longer than the column allows.
  '22001': {
    code: ErrorCode.VALIDATION_FAILED,
    message: 'One of the details is too long. Please shorten it and try again.',
  },
  // 22P02 invalid_text_representation — a malformed id, number or date.
  '22P02': {
    code: ErrorCode.VALIDATION_FAILED,
    message: 'One of the details is not in a form we recognise. Please check and try again.',
  },
  // 22003 numeric_value_out_of_range
  '22003': {
    code: ErrorCode.VALIDATION_FAILED,
    message: 'A number is outside the range we can store. Please check and try again.',
  },
  // 23514 check_violation — a value the schema forbids.
  '23514': {
    code: ErrorCode.VALIDATION_FAILED,
    message: 'One of the details is not allowed here. Please review and try again.',
  },
  // 23505 unique_violation — normally caught as UniqueConstraintError first.
  '23505': { code: ErrorCode.CONFLICT },
  // Contention, not corruption: the same request usually succeeds on a retry.
  '40001': { code: ErrorCode.SERVICE_BUSY }, // serialization_failure
  '40P01': { code: ErrorCode.SERVICE_BUSY }, // deadlock_detected
  '55P03': { code: ErrorCode.SERVICE_BUSY }, // lock_not_available
  '53300': { code: ErrorCode.SERVICE_BUSY }, // too_many_connections
  '53200': { code: ErrorCode.SERVICE_BUSY }, // out_of_memory
  '57014': { code: ErrorCode.UPSTREAM_TIMEOUT }, // query_canceled (statement timeout)
  '08006': { code: ErrorCode.SERVICE_BUSY }, // connection_failure
  '08003': { code: ErrorCode.SERVICE_BUSY }, // connection_does_not_exist
};

/** Socket-level failures reaching anything we depend on. */
const UNREACHABLE_ERRNOS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);

const TIMEOUT_ERRNOS = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ERR_SOCKET_CONNECTION_TIMEOUT']);

/**
 * Global filter producing the single, consistent error contract (plan §13):
 *   { success:false, statusCode, error, message, path, timestamp, details? }
 * `message` is always safe to render directly to the end user.
 *
 * Its second job is to make a 500 rare. Anything a user can cause — a clash, a
 * missing parent row, a column overflow, a gateway that is down, a query that
 * timed out — is translated here into a code and a sentence that means
 * something to whoever is looking at the screen. A response that still reaches
 * `INTERNAL_ERROR` is a fault nobody anticipated, so it carries a short
 * `reference` that is logged alongside the stack: "it broke" becomes a line a
 * developer can find.
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
        `${request.method} ${request.url} → ${body.statusCode} ${body.error}` +
          (body.reference ? ` [ref ${body.reference}]` : ''),
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

  /** Body straight from the catalog, optionally with a more specific sentence. */
  private fromCatalog(code: ErrorCode, message?: string, details?: unknown): ResolvedError {
    return {
      success: false,
      statusCode: ERROR_CATALOG[code].status,
      error: code,
      message: message ?? ERROR_CATALOG[code].message,
      details,
    };
  }

  private resolve(exception: unknown): ResolvedError {
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
      return this.fromCatalog(ErrorCode.RATE_LIMITED);
    }

    // 3. Framework HttpExceptions (validation pipe, NotFound, Forbidden, ...).
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    // 4. Sequelize, most specific first — TimeoutError extends DatabaseError,
    //    and both extend BaseError, so order here is load-bearing.
    if (exception instanceof UniqueConstraintError) {
      return this.fromCatalog(
        ErrorCode.CONFLICT,
        'A record with these details already exists.',
        this.isDev() ? exception.errors?.map((e) => e.message) : undefined,
      );
    }

    if (exception instanceof ForeignKeyConstraintError) {
      // Postgres words the two directions differently: a delete blocked by
      // children says "is still referenced from", a write naming a parent that
      // is gone does not. They need opposite advice, so they get opposite codes.
      const detail = String(
        (exception as { parent?: { detail?: string } }).parent?.detail ?? exception.message,
      );
      return this.fromCatalog(
        /still referenced from/i.test(detail)
          ? ErrorCode.RECORD_IN_USE
          : ErrorCode.RELATED_RECORD_MISSING,
      );
    }

    if (exception instanceof SequelizeValidationError) {
      return this.fromCatalog(
        ErrorCode.VALIDATION_FAILED,
        undefined,
        exception.errors?.map((e) => ({ field: e.path, message: e.message })),
      );
    }

    if (exception instanceof SequelizeTimeoutError) {
      return this.fromCatalog(ErrorCode.UPSTREAM_TIMEOUT);
    }

    // The database is unreachable / refusing / out of connections. Not the
    // user's fault and not permanent, so it must not read like a crash.
    if (exception instanceof ConnectionError) {
      return this.fromCatalog(ErrorCode.SERVICE_BUSY);
    }

    if (exception instanceof DatabaseError) {
      const sqlState = (exception as { parent?: { code?: string } }).parent?.code;
      const mapped = sqlState ? PG_CODE_MAP[sqlState] : undefined;
      if (mapped) return this.fromCatalog(mapped.code, mapped.message);
      return this.unexpected(exception);
    }

    if (exception instanceof SequelizeBaseError) {
      return this.unexpected(exception);
    }

    // 5. Services we call out to.
    //    Matched by name rather than imported: this filter sits in `common` and
    //    has no business depending on the AI module to catch its error.
    if ((exception as { constructor?: { name?: string } })?.constructor?.name === 'AiUnavailableError') {
      return this.fromCatalog(ErrorCode.AI_UNAVAILABLE);
    }

    const errno = (exception as { code?: unknown })?.code;
    if (typeof errno === 'string') {
      // Multer reports upload limits through the same `code` channel.
      if (errno === 'LIMIT_FILE_SIZE') return this.fromCatalog(ErrorCode.FILE_TOO_LARGE);
      if (errno === 'LIMIT_FILE_COUNT') {
        return this.fromCatalog(
          ErrorCode.BAD_REQUEST,
          'Too many files at once. Please upload fewer and try again.',
        );
      }
      if (errno === 'LIMIT_UNEXPECTED_FILE') {
        return this.fromCatalog(
          ErrorCode.BAD_REQUEST,
          'That file was not expected here. Please use the upload button on this screen.',
        );
      }
      if (TIMEOUT_ERRNOS.has(errno)) return this.fromCatalog(ErrorCode.UPSTREAM_TIMEOUT);
      if (UNREACHABLE_ERRNOS.has(errno)) return this.fromCatalog(ErrorCode.SERVICE_BUSY);
    }

    // `AbortSignal.timeout()` and manual aborts surface as DOMExceptions whose
    // name, not code, carries the reason.
    const name = (exception as { name?: unknown })?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return this.fromCatalog(ErrorCode.UPSTREAM_TIMEOUT);
    }

    // A malformed JSON body reaches us as a plain SyntaxError when it escapes
    // body-parser's own HttpException.
    if (exception instanceof SyntaxError) {
      return this.fromCatalog(
        ErrorCode.BAD_REQUEST,
        'We could not read that request. Please try again.',
      );
    }

    // 6. Genuinely unanticipated — never leak internals.
    return this.unexpected(exception);
  }

  /**
   * The last resort. Stays a 500 because that is what it is — a fault on our
   * side, not a request the caller can fix — but it carries a reference that
   * also lands in the log, so the person who hit it has something to quote.
   */
  private unexpected(exception: unknown): ResolvedError {
    const reference = randomUUID().slice(0, 8);
    return {
      success: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: ErrorCode.INTERNAL_ERROR,
      message:
        `${ERROR_CATALOG[ErrorCode.INTERNAL_ERROR].message} ` +
        `If it happens again, quote reference ${reference} to support.`,
      reference,
      details: this.isDev()
        ? { cause: exception instanceof Error ? exception.message : String(exception) }
        : undefined,
    };
  }

  private fromHttpException(exception: HttpException): ResolvedError {
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

    // A 5xx from the framework is still a fault on our side, and Nest's default
    // text for it ("Internal server error") says nothing to a receptionist.
    if (status >= 500) return this.unexpected(exception);

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
      case HttpStatus.REQUEST_TIMEOUT:
      case HttpStatus.GATEWAY_TIMEOUT:
        return ErrorCode.UPSTREAM_TIMEOUT;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.SERVICE_BUSY;
      default:
        return ErrorCode.BAD_REQUEST;
    }
  }

  /**
   * Prefer the framework message, but fall back to our friendly catalog text.
   *
   * Nest's stock one-word bodies ("Bad Request", "Not Found") are not sentences
   * and are not worth showing anyone, so they are dropped in favour of the
   * catalog's.
   */
  private readableMessage(raw: unknown, code: ErrorCode): string {
    const stock = new Set([
      'Bad Request',
      'Unauthorized',
      'Forbidden',
      'Not Found',
      'Conflict',
      'Unprocessable Entity',
      'Payload Too Large',
      'Unsupported Media Type',
      'Too Many Requests',
      'Request Timeout',
      'Service Unavailable',
      'Gateway Timeout',
    ]);
    const usable = (m: unknown): m is string =>
      typeof m === 'string' && m.trim().length > 0 && !stock.has(m.trim());

    if (usable(raw)) return raw;
    if (raw && typeof raw === 'object' && 'message' in raw) {
      const m = (raw as { message: unknown }).message;
      if (usable(m)) return m;
      if (Array.isArray(m) && m.length) return m.join(' ');
    }
    return ERROR_CATALOG[code]?.message ?? 'Request failed.';
  }

  private isDev(): boolean {
    return process.env.NODE_ENV !== 'production';
  }
}
