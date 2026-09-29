import { BadRequestException, HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import {
  ConnectionError,
  ConnectionRefusedError,
  DatabaseError,
  ForeignKeyConstraintError,
  TimeoutError as SequelizeTimeoutError,
  UniqueConstraintError,
} from 'sequelize';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

/**
 * The contract this filter exists to keep: every failure leaves as a stable
 * `error` code and a sentence a receptionist can act on, and a 500 is reserved
 * for faults nobody anticipated.
 *
 * These cases are the ones that used to arrive as a bare 500 reading "something
 * went wrong on our end" — a column overflow, a database out of connections, a
 * deleted row someone still points at. Each is now something the person on the
 * screen can do something about.
 */
describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let status: jest.Mock;
  let json: jest.Mock;

  /** Runs the filter and hands back the body it wrote. */
  const run = (exception: unknown) => {
    filter.catch(exception, {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'POST', url: '/api/appointments' }),
      }),
    } as never);
    expect(status).toHaveBeenCalledTimes(1);
    return {
      statusCode: status.mock.calls[0][0] as number,
      body: json.mock.calls[0][0] as Record<string, unknown>,
    };
  };

  /** A Sequelize DatabaseError wrapping a driver error with a SQLSTATE. */
  const pgError = (sqlState: string, detail?: string) => {
    const parent = new Error('driver said no') as Error & {
      code?: string;
      detail?: string;
      sql?: string;
    };
    parent.code = sqlState;
    if (detail) parent.detail = detail;
    return new DatabaseError(parent as never);
  };

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    // Keep the suite's output readable; the filter logs every fault it sees.
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('passes our own domain exceptions straight through', () => {
    const { statusCode, body } = run(new AppException(ErrorCode.SLOT_ALREADY_BOOKED));
    expect(statusCode).toBe(HttpStatus.CONFLICT);
    expect(body.error).toBe(ErrorCode.SLOT_ALREADY_BOOKED);
    expect(body.message).toContain('just taken');
    expect(body.reference).toBeUndefined();
  });

  it('always includes the envelope fields the clients switch on', () => {
    const { body } = run(new AppException(ErrorCode.SLOT_IN_PAST));
    expect(body).toMatchObject({
      success: false,
      path: '/api/appointments',
    });
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.statusCode).toBe('number');
  });

  describe('a column the request overflowed is the caller’s to fix, not a 500', () => {
    it.each([
      ['23502', 'not null', /required detail is missing/i],
      ['22001', 'value too long', /too long/i],
      ['22P02', 'bad uuid', /form we recognise/i],
      ['22003', 'numeric overflow', /outside the range/i],
      ['23514', 'check violation', /not allowed here/i],
    ])('SQLSTATE %s (%s) → 422 VALIDATION_FAILED', (sqlState, _label, matcher) => {
      const { statusCode, body } = run(pgError(sqlState));
      expect(statusCode).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(body.error).toBe(ErrorCode.VALIDATION_FAILED);
      expect(body.message).toMatch(matcher);
    });
  });

  describe('contention is "try again", never "we crashed"', () => {
    it.each([
      ['40001', 'serialization failure'],
      ['40P01', 'deadlock'],
      ['53300', 'too many connections'],
      ['08006', 'connection failure'],
    ])('SQLSTATE %s (%s) → 503 SERVICE_BUSY', (sqlState) => {
      const { statusCode, body } = run(pgError(sqlState));
      expect(statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.error).toBe(ErrorCode.SERVICE_BUSY);
      // The reassurance matters as much as the code: the doctor needs to know
      // whether to redo the work.
      expect(body.message).toMatch(/nothing was saved/i);
    });

    it('a statement timeout (57014) reads as taking too long', () => {
      const { statusCode, body } = run(pgError('57014'));
      expect(statusCode).toBe(HttpStatus.GATEWAY_TIMEOUT);
      expect(body.error).toBe(ErrorCode.UPSTREAM_TIMEOUT);
    });

    it('an unreachable database is 503, not 500', () => {
      for (const err of [
        new ConnectionError(new Error('ECONNREFUSED')),
        new ConnectionRefusedError(new Error('refused')),
      ]) {
        json.mockClear();
        status.mockClear();
        const { statusCode, body } = run(err);
        expect(statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(body.error).toBe(ErrorCode.SERVICE_BUSY);
      }
    });

    it('a query timeout maps ahead of its DatabaseError base class', () => {
      const parent = Object.assign(new Error('timed out'), { sql: 'SELECT 1' });
      const { body } = run(new SequelizeTimeoutError(parent as never));
      expect(body.error).toBe(ErrorCode.UPSTREAM_TIMEOUT);
    });
  });

  describe('foreign keys tell the caller which way the problem points', () => {
    it('a row still referenced elsewhere cannot be removed', () => {
      const err = new ForeignKeyConstraintError({
        message: 'update or delete on table "plans" violates foreign key constraint',
        parent: Object.assign(new Error('fk'), {
          detail: 'Key (id)=(p1) is still referenced from table "subscriptions".',
        }) as never,
      });
      const { statusCode, body } = run(err);
      expect(statusCode).toBe(HttpStatus.CONFLICT);
      expect(body.error).toBe(ErrorCode.RECORD_IN_USE);
      expect(body.message).toMatch(/still being used/i);
    });

    it('a write naming a parent that is gone asks for a refresh', () => {
      const err = new ForeignKeyConstraintError({
        message: 'insert violates foreign key constraint',
        parent: Object.assign(new Error('fk'), {
          detail: 'Key (doctor_id)=(d9) is not present in table "doctors".',
        }) as never,
      });
      const { statusCode, body } = run(err);
      expect(statusCode).toBe(HttpStatus.CONFLICT);
      expect(body.error).toBe(ErrorCode.RELATED_RECORD_MISSING);
      expect(body.message).toMatch(/refresh/i);
    });

    it('a duplicate is still a plain conflict', () => {
      const { statusCode, body } = run(new UniqueConstraintError({ errors: [] }));
      expect(statusCode).toBe(HttpStatus.CONFLICT);
      expect(body.error).toBe(ErrorCode.CONFLICT);
    });
  });

  describe('things we call over the network', () => {
    it('the AI sidecar being down does not fail as a server crash', () => {
      // Matched by constructor name, so the filter need not depend on the AI
      // module — this mirrors the real class.
      class AiUnavailableError extends Error {}
      const { statusCode, body } = run(new AiUnavailableError('sidecar down'));
      expect(statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(body.error).toBe(ErrorCode.AI_UNAVAILABLE);
      // It must tell the doctor they can carry on by hand.
      expect(body.message).toMatch(/write the prescription yourself/i);
    });

    it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH'])(
      '%s → 503 SERVICE_BUSY',
      (code) => {
        const { statusCode, body } = run(Object.assign(new Error('socket'), { code }));
        expect(statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
        expect(body.error).toBe(ErrorCode.SERVICE_BUSY);
      },
    );

    it.each(['ETIMEDOUT', 'ESOCKETTIMEDOUT'])('%s → 504 UPSTREAM_TIMEOUT', (code) => {
      const { statusCode, body } = run(Object.assign(new Error('slow'), { code }));
      expect(statusCode).toBe(HttpStatus.GATEWAY_TIMEOUT);
      expect(body.error).toBe(ErrorCode.UPSTREAM_TIMEOUT);
    });

    it('an AbortSignal.timeout() rejection is a timeout, not a crash', () => {
      const { body } = run(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
      expect(body.error).toBe(ErrorCode.UPSTREAM_TIMEOUT);
    });
  });

  describe('uploads', () => {
    it('an oversized file is reported as such', () => {
      const { statusCode, body } = run(
        Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' }),
      );
      expect(statusCode).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
      expect(body.error).toBe(ErrorCode.FILE_TOO_LARGE);
    });

    it('an unexpected file field says what to do instead', () => {
      const { body } = run(
        Object.assign(new Error('Unexpected field'), { code: 'LIMIT_UNEXPECTED_FILE' }),
      );
      expect(body.error).toBe(ErrorCode.BAD_REQUEST);
      expect(body.message).toMatch(/upload button/i);
    });
  });

  describe('framework exceptions', () => {
    it('replaces Nest’s one-word bodies with a real sentence', () => {
      const { body } = run(new BadRequestException());
      expect(body.error).toBe(ErrorCode.BAD_REQUEST);
      // "Bad Request" is not something to show a patient.
      expect(body.message).not.toBe('Bad Request');
      expect(body.message).toBe('The request was invalid.');
    });

    it('keeps a message a developer actually wrote', () => {
      const { body } = run(new BadRequestException('Pick a date within the next 7 days.'));
      expect(body.message).toBe('Pick a date within the next 7 days.');
    });

    it('rate limiting keeps its own code', () => {
      const { statusCode, body } = run(new ThrottlerException());
      expect(statusCode).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(body.error).toBe(ErrorCode.RATE_LIMITED);
    });

    it('a framework 5xx is treated as an unanticipated fault, with a reference', () => {
      const { statusCode, body } = run(new InternalServerErrorException());
      expect(statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe(ErrorCode.INTERNAL_ERROR);
      expect(body.reference).toMatch(/^[0-9a-f]{8}$/);
      expect(body.message).not.toMatch(/internal server error/i);
    });
  });

  describe('the genuine last resort', () => {
    it('still a 500, but quotable and never leaking internals', () => {
      const { statusCode, body } = run(new Error('getaddrinfo failed for pg-primary.internal'));
      expect(statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe(ErrorCode.INTERNAL_ERROR);
      expect(body.message).toMatch(/quote reference [0-9a-f]{8}/);
      expect(body.reference).toMatch(/^[0-9a-f]{8}$/);
    });

    it('hides the cause in production and shows it in development', () => {
      const original = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        expect(run(new Error('pg-primary.internal')).body.details).toBeUndefined();

        json.mockClear();
        status.mockClear();
        process.env.NODE_ENV = 'development';
        expect(run(new Error('pg-primary.internal')).body.details).toEqual({
          cause: 'pg-primary.internal',
        });
      } finally {
        process.env.NODE_ENV = original;
      }
    });

    it('a SQLSTATE we have no advice for is not dressed up as a 4xx', () => {
      const { statusCode, body } = run(pgError('XX000'));
      expect(statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(body.error).toBe(ErrorCode.INTERNAL_ERROR);
    });

    it('gives every fault its own reference', () => {
      const first = run(new Error('one')).body.reference;
      json.mockClear();
      status.mockClear();
      const second = run(new Error('two')).body.reference;
      expect(first).not.toBe(second);
    });
  });
});
