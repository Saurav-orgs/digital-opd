import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * Route-level guard for patient-portal endpoints. Applied explicitly (these
 * controllers are also marked `@Public()` so the global admin JwtAuthGuard
 * skips them entirely — this guard is the real gate).
 */
@Injectable()
export class PatientAuthGuard extends AuthGuard('patient-jwt') {
  handleRequest(err: any, patient: any) {
    if (err || !patient) {
      throw new AppException(ErrorCode.UNAUTHORIZED);
    }
    return patient;
  }
}
