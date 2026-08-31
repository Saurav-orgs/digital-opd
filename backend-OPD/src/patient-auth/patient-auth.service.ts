import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Patient } from '../database/models/patient.model';
import { PatientLoginDto } from './dto/patient-login.dto';
import { PatientRegisterDto } from './dto/patient-register.dto';
import { PatientCheckDto } from './dto/patient-check.dto';
import { PatientSignupDto } from './dto/patient-signup.dto';
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
   * Step 1 of signing in: which field to show next.
   *
   * This replaced `identify`, which took a bare mobile number and returned a
   * session plus every patient registered on it — ten guessed digits read a
   * stranger's family's records. The answer here is two booleans: nothing that
   * identifies anyone, and nothing that grants access.
   *
   * It still leaks *whether* a number is registered, which is unavoidable when
   * the next screen must ask either "your password" or "choose a password".
   * The route stays rate-limited so that cannot be swept.
   */
  async check(dto: PatientCheckDto) {
    const account = await this.profiles.findAccount(dto.mobile);
    return {
      exists: !!account,
      // An account the front desk opened for a walk-in has no password yet, so
      // "registered" does not imply "can sign in". The caller shows the
      // choose-a-password form for both this and a brand-new number.
      has_password: !!account?.password_hash,
    };
  }

  /**
   * Open an account from the booking flow, or set the first password on one
   * that never had it. No patient details — booking asks who the visit is for
   * on the next step.
   */
  async signup(dto: PatientSignupDto) {
    const existing = await this.profiles.findAccount(dto.mobile);
    if (existing?.password_hash) {
      // Signing up over a real account would be a password reset by anyone who
      // knows the number.
      throw new AppException(ErrorCode.CONFLICT, {
        message: 'This number already has an account. Please sign in instead.',
      });
    }

    const account = existing ?? (await this.profiles.findOrCreateAccount(dto.mobile));
    await account.update({
      password_hash: await bcrypt.hash(dto.password, 10),
    } as any);

    const session = await this.issueSession(account);
    return {
      ...session,
      patients: await this.profiles.listForAccount(account.id),
    };
  }

  /**
   * Register: the number becomes the account, the password secures it, and the
   * details become exactly one patient on it. Same outcome as booking or a
   * walk-in — there is only one way a patient record is born.
   */
  async register(dto: PatientRegisterDto) {
    const existing = await this.profiles.findAccount(dto.mobile);
    if (existing?.password_hash) {
      throw new AppException(ErrorCode.CONFLICT, {
        message: 'This number already has an account. Please sign in instead.',
      });
    }

    const account = existing ?? (await this.profiles.findOrCreateAccount(dto.mobile));
    await account.update({
      password_hash: await bcrypt.hash(dto.password, 10),
    } as any);

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
   * Sign in with the number and its password.
   *
   * An unknown number and a wrong password give the same answer on purpose —
   * whether a number is registered is something `check` decides deliberately,
   * not something this hands out to anyone who guesses.
   */
  async login(dto: PatientLoginDto) {
    const wrong = () =>
      new AppException(ErrorCode.INVALID_CREDENTIALS, {
        message: 'Incorrect mobile number or password.',
      });

    const account = await this.profiles.findAccount(dto.mobile);
    if (!account?.password_hash) {
      throw wrong();
    }

    const ok = await bcrypt.compare(dto.password, account.password_hash);
    if (!ok) {
      throw wrong();
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
