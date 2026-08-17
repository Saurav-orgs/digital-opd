import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/sequelize';
import { Patient } from '../database/models/patient.model';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthPatient } from './current-patient.decorator';

export interface PatientJwtPayload {
  sub: string;
  mobile: string;
  kind: 'patient';
}

/**
 * Separate passport strategy for patient tokens (named 'patient-jwt' so it
 * never gets confused with the admin/doctor 'jwt' strategy). Payloads without
 * `kind: 'patient'` are rejected, so an admin token can never authenticate a
 * patient route and vice versa.
 */
@Injectable()
export class PatientStrategy extends PassportStrategy(Strategy, 'patient-jwt') {
  constructor(
    config: ConfigService,
    @InjectModel(Patient) private readonly patientModel: typeof Patient,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt').secret,
    });
  }

  async validate(payload: PatientJwtPayload): Promise<AuthPatient> {
    if (payload.kind !== 'patient') {
      throw new AppException(ErrorCode.UNAUTHORIZED);
    }
    const patient = await this.patientModel.findByPk(payload.sub);
    if (!patient) {
      throw new AppException(ErrorCode.UNAUTHORIZED);
    }
    return { id: patient.id, mobile: patient.mobile, name: patient.name };
  }
}
