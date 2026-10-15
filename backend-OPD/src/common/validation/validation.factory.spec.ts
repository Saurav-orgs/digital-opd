import { HttpStatus, ValidationError } from '@nestjs/common';
import { validationExceptionFactory } from './validation.factory';
import { ErrorCode, ERROR_CATALOG } from '../errors/error-codes';

/**
 * The half of the error contract that class-validator writes.
 *
 * `message` is rendered straight into the UI, so it has to read as a finished
 * sentence addressed to a patient or a receptionist. Everything we write by
 * hand already does; the one string class-validator produces that does not is
 * the whitelist failure, which names a DTO property. A receptionist editing a
 * patient was shown "property mobile should not exist" — the client was sending
 * a field the endpoint does not accept, which is our bug to fix, not theirs.
 */
/**
 * One class-validator error, shaped the way the pipe hands them over. A DTO
 * that only failed inside a nested object carries no `constraints` of its own,
 * so passing none leaves the key off rather than setting it empty.
 */
const error = (
  property: string,
  constraints?: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError => ({ property, children, ...(constraints ? { constraints } : {}) });

/** The body the factory wrote, as the client would read it. */
const run = (errors: ValidationError[]) =>
  validationExceptionFactory(errors).getResponse() as {
    error: string;
    statusCode: number;
    message: string;
    details: { field: string; messages: string[] }[];
  };

describe('validationExceptionFactory', () => {
  it('is a 422 under the stable VALIDATION_FAILED code', () => {
    const body = run([error('pincode', { matches: 'Please enter a valid 6-digit PIN code.' })]);
    expect(body.statusCode).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(body.error).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('shows the first message a person can act on', () => {
    const body = run([
      error('name', { minLength: 'Please enter the patient’s name.' }),
      error('pincode', { matches: 'Please enter a valid 6-digit PIN code.' }),
    ]);
    expect(body.message).toBe('Please enter the patient’s name.');
  });

  it('never shows a whitelist failure, which names a DTO property', () => {
    const body = run([error('mobile', { whitelistValidation: 'property mobile should not exist' })]);
    expect(body.message).toBe(ERROR_CATALOG[ErrorCode.VALIDATION_FAILED].message);
    expect(body.message).not.toMatch(/should not exist/);
  });

  it('keeps the whitelist text in details, where a developer looks', () => {
    const body = run([error('mobile', { whitelistValidation: 'property mobile should not exist' })]);
    expect(body.details).toEqual([
      { field: 'mobile', messages: ['property mobile should not exist'] },
    ]);
  });

  it('prefers a real failure over a whitelist one, whatever order they arrive in', () => {
    const body = run([
      error('mobile', { whitelistValidation: 'property mobile should not exist' }),
      error('pincode', { matches: 'Please enter a valid 6-digit PIN code.' }),
    ]);
    expect(body.message).toBe('Please enter a valid 6-digit PIN code.');
  });

  it('reaches into nested DTOs for both the summary and the field paths', () => {
    const body = run([
      error('patient', undefined, [error('city', { minLength: 'Please enter the city.' })]),
    ]);
    expect(body.message).toBe('Please enter the city.');
    expect(body.details).toEqual([
      { field: 'patient.city', messages: ['Please enter the city.'] },
    ]);
  });

  it('falls back to the catalogue sentence when there is nothing to say', () => {
    expect(run([]).message).toBe(ERROR_CATALOG[ErrorCode.VALIDATION_FAILED].message);
  });
});
