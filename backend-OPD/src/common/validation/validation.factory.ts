import { HttpStatus, UnprocessableEntityException, ValidationError } from '@nestjs/common';
import { ErrorCode, ERROR_CATALOG } from '../errors/error-codes';

interface FieldError {
  field: string;
  messages: string[];
}

/**
 * The constraint `forbidNonWhitelisted` fails with, and the one message
 * class-validator writes that was never meant for a human: "property mobile
 * should not exist". It names a DTO field and tells the reader nothing they
 * can act on, so it is kept out of `message` — see `summarize`.
 */
const WHITELIST_CONSTRAINT = 'whitelistValidation';

/** Flatten nested class-validator errors into a flat, readable list. */
function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  const out: FieldError[] = [];
  for (const err of errors) {
    const path = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) {
      out.push({ field: path, messages: Object.values(err.constraints) });
    }
    if (err.children?.length) {
      out.push(...flatten(err.children, path));
    }
  }
  return out;
}

/**
 * The sentence the client renders: the first failure a user can do something
 * about.
 *
 * Every other constraint carries a message we wrote for a patient or a
 * receptionist ("Please enter a valid 6-digit PIN code."), so the first one is
 * the right thing to show. A whitelist failure is different in kind — it means
 * the *client* sent a field the endpoint does not accept, which is a bug in us,
 * not a detail the person at the desk mistyped. Putting it in `message` showed
 * "property mobile should not exist" to a receptionist editing a patient
 * (`PatientFormModal` sent `mobile` on an edit, which `StaffUpdatePatientDto`
 * has no field for). The raw text stays in `details`, where a developer looks.
 */
function summarize(errors: ValidationError[]): string | undefined {
  for (const err of errors) {
    if (err.constraints) {
      for (const [constraint, message] of Object.entries(err.constraints)) {
        if (constraint !== WHITELIST_CONSTRAINT) return message;
      }
    }
    if (err.children?.length) {
      const nested = summarize(err.children);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Turns class-validator failures into our uniform contract:
 * 422 VALIDATION_FAILED with a friendly summary + per-field details the
 * client can render inline next to each input.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): UnprocessableEntityException {
  const fields = flatten(errors);
  return new UnprocessableEntityException({
    error: ErrorCode.VALIDATION_FAILED,
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    message: summarize(errors) ?? ERROR_CATALOG[ErrorCode.VALIDATION_FAILED].message,
    details: fields,
  });
}
