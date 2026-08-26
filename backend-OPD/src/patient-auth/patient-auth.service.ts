import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Patient } from '../database/models/patient.model';
import { PatientLoginDto } from './dto/patient-login.dto';
import { PatientRegisterDto } from './dto/patient-register.dto';
import { PatientIdentifyDto } from './dto/patient-identify.dto';
import { AuthPatient } from './current-patient.decorator';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PatientProfilesService } from '../patient-profiles/patient-profiles.service';

@Injectable()
export class PatientAuthService {
  constructor(
    private readonly profiles: PatientProfilesService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Step 1 of booking: the number, which doubles as register-or-login.
   *
   * A number never seen before quietly becomes an account — nothing else is
   * asked, and no patient is created yet. The response lists whoever is already
   * registered on the number so the caller can pick one or add another.
   *
   * This is public and unmasked: the client has accepted that a bare number
   * reveals its patients until an OTP step exists. The route is rate-limited to
   * keep that from being sweepable.
   */
  async identify(dto: PatientIdentifyDto) {
    const account = await this.profiles.findOrCreateAccount(dto.mobile);
    const patients = await this.profiles.listForAccount(account.id);
    const { accessToken } = await this.issueSession(account);
    return { accessToken, mobile: account.mobile, patients };
  }

  /**
   * Register: the number becomes the account, and the details become exactly
   * one patient on it. Same outcome as booking or a walk-in — there is only one
   * way a patient record is born.
   */
  async register(dto: PatientRegisterDto) {
    const account = await this.profiles.findOrCreateAccount(dto.mobile);
    const profile = await this.profiles.createForAccount(
      account.id,
      dto.patient,
    );
    const session = await this.issueSession(account);
    return {
      ...session,
      patients: await this.profiles.listForAccount(account.id),
      created_patient_id: profile.id,
    };
  }

  /**
   * Phone-only login, no OTP.
   *
   * Booking and walk-in both create the account up front, so this no longer
   * has to guess a name from the caller's last booking — it either finds the
   * account or tells them to register.
   */
  async login(dto: PatientLoginDto) {
    const account = await this.profiles.findAccount(dto.mobile);
    if (!account) {
      throw new AppException(ErrorCode.PATIENT_NOT_FOUND);
    }
    const session = await this.issueSession(account);
    return {
      ...session,
      patients: await this.profiles.listForAccount(account.id),
    };
  }

  /** The account plus its patients — the portal's "who am I viewing?" data. */
  async me(patient: AuthPatient) {
    return {
      id: patient.id,
      mobile: patient.mobile,
      patients: await this.profiles.listForAccount(patient.id),
    };
  }

  private async issueSession(account: Patient) {
    const accessToken = await this.jwtService.signAsync({
      sub: account.id,
      mobile: account.mobile,
      kind: 'patient',
    });
    return {
      accessToken,
      patient: { id: account.id, mobile: account.mobile },
    };
  }
}
