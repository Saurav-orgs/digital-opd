import { HttpStatus, UnprocessableEntityException, ValidationError } from '@nestjs/common';
import { ErrorCode, ERROR_CATALOG } from '../errors/error-codes';

interface FieldError {
  field: string;
  messages: string[];
}

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
 * Turns class-validator failures into our uniform contract:
 * 422 VALIDATION_FAILED with a friendly summary + per-field details the
 * client can render inline next to each input.
 */
export function validationExceptionFactory(
  errors: ValidationError[],
): UnprocessableEntityException {
  const fields = flatten(errors);
  const first = fields[0]?.messages[0];
  return new UnprocessableEntityException({
    error: ErrorCode.VALIDATION_FAILED,
    statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    message: first ?? ERROR_CATALOG[ErrorCode.VALIDATION_FAILED].message,
    details: fields,
  });
}
