import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/sequelize';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'crypto';
import { Op } from 'sequelize';
import { Patient } from '../database/models/patient.model';
import { MobileVerification } from '../database/models/mobile-verification.model';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ConfirmMobileCodeDto, SendMobileCodeDto } from './dto/mobile-verification.dto';
import { PatientLoginDto } from './dto/patient-login.dto';
import { PatientRegisterDto } from './dto/patient-register.dto';
import { PatientCheckDto } from './dto/patient-check.dto';
import { PatientSignupDto } from './dto/patient-signup.dto';
import {
  PatientForgotPasswordDto,
  PatientResetPasswordDto,
  PatientVerifyResetCodeDto,
} from './dto/password-reset.dto';
import { AuthPatient } from './current-patient.decorator';
import { ActivityLogService } from '../activity/activity-log.service';
import {
  ActivityAction,
  ActivityActor,
  MobileVerificationPurpose,
} from '../common/enums';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PatientProfilesService } from '../patient-profiles/patient-profiles.service';

/** How long a sign-up code is good for, and how long a verified number stays usable. */
const CODE_MINUTES = 10;
const VERIFIED_FOR_MINUTES = 30;
const MAX_CODE_ATTEMPTS = 5;
/** Resend no sooner than this — one tap, one WhatsApp message. */
const RESEND_AFTER_SECONDS = 45;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class PatientAuthService {
  private readonly logger = new Logger(PatientAuthService.name);
  private readonly isProduction: boolean;

  constructor(
    private readonly profiles: PatientProfilesService,
    private readonly jwtService: JwtService,
    private readonly activity: ActivityLogService,
    private readonly whatsapp: WhatsAppService,
    config: ConfigService,
    @InjectModel(MobileVerification)
    private readonly verificationModel: typeof MobileVerification,
  ) {
    this.isProduction = config.get<string>('env') === 'production';
  }

  // ── Mobile verification at sign-up ─────────────────────────

  /**
   * Send a 6-digit code over WhatsApp to a number a patient wants to open an
   * account with.
   *
   * Only first-time registration is gated: a number that already has a
   * password signs in with it and is refused here, at the first step. A
   * number the front desk opened for a walk-in has no password yet, so it
   * *is* allowed through — that is the patient claiming their own account.
   */
  async sendMobileCode(dto: SendMobileCodeDto): Promise<{ ok: true; resendAfter: number }> {
    const mobile = dto.mobile;

    const existing = await this.profiles.findAccount(mobile);
    if (existing?.password_hash) {
      throw new AppException(ErrorCode.CONFLICT, {
        message: 'This number already has an account. Please sign in instead.',
      });
    }

    const recent = await this.verificationModel.findOne({
      where: { mobile, purpose: MobileVerificationPurpose.SIGNUP, consumed_at: null },
      order: [['created_at', 'DESC']],
    });
    if (recent) {
      const age = (Date.now() - new Date(recent.get('createdAt') as Date).getTime()) / 1000;
      if (age < RESEND_AFTER_SECONDS) {
        throw new AppException(ErrorCode.RATE_LIMITED, {
          message: `A code was just sent. Please wait ${Math.ceil(RESEND_AFTER_SECONDS - age)} seconds before asking for another.`,
        });
      }
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    // A new code retires the old one: only the latest row is ever checked.
    await this.verificationModel.destroy({
      where: { mobile, purpose: MobileVerificationPurpose.SIGNUP, consumed_at: null },
    });
    const row = await this.verificationModel.create({
      mobile,
      purpose: MobileVerificationPurpose.SIGNUP,
      code_hash: sha256(`${mobile}:${code}`),
      attempts: 0,
      expires_at: new Date(Date.now() + CODE_MINUTES * 60_000),
    } as any);

    await this.whatsapp.sendOtp(mobile, code, `mobile_verification:${row.id}`);
    if (!this.isProduction && !this.whatsapp.enabled) {
      this.logger.log(`Verification code for ${mobile}: ${code}`);
    }
    return { ok: true, resendAfter: RESEND_AFTER_SECONDS };
  }

  /** Check the code the patient typed; the number is then good for half an hour. */
  async confirmMobileCode(dto: ConfirmMobileCodeDto): Promise<{ verified: true }> {
    const mobile = dto.mobile;
    const row = await this.verificationModel.findOne({
      where: { mobile, purpose: MobileVerificationPurpose.SIGNUP, consumed_at: null },
      order: [['created_at', 'DESC']],
    });
    if (!row || row.expires_at.getTime() < Date.now()) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'That code has expired. Please ask for a new one.',
      });
    }
    if (row.verified_at) return { verified: true };
    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      throw new AppException(ErrorCode.RATE_LIMITED, {
        message: 'Too many wrong attempts. Please ask for a new code.',
      });
    }
    if (row.code_hash !== sha256(`${mobile}:${dto.code}`)) {
      const attempts = row.attempts + 1;
      await row.update({ attempts } as any);
      const left = MAX_CODE_ATTEMPTS - attempts;
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message:
          left > 0
            ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
            : 'That code is not right. Please ask for a new one.',
      });
    }
    await row.update({
      verified_at: new Date(),
      expires_at: new Date(Date.now() + VERIFIED_FOR_MINUTES * 60_000),
    } as any);
    return { verified: true };
  }

  /** Signup and register ask this about the number they are about to open an account for. */
  private async assertMobileVerified(mobile: string): Promise<MobileVerification> {
    const row = await this.verificationModel.findOne({
      where: {
        mobile,
        purpose: MobileVerificationPurpose.SIGNUP,
        consumed_at: null,
        verified_at: { [Op.ne]: null },
        expires_at: { [Op.gt]: new Date() },
      },
      order: [['verified_at', 'DESC']],
    });
    if (!row) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'Please verify your mobile number with the WhatsApp code first.',
      });
    }
    return row;
  }

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
    // The WhatsApp code is what proves the number is theirs — without it a
    // walk-in's account could be claimed by anyone who knows the number.
    const verification = await this.assertMobileVerified(dto.mobile);

    const account = existing ?? (await this.profiles.findOrCreateAccount(dto.mobile));
    await account.update({
      password_hash: await bcrypt.hash(dto.password, 10),
    } as any);
    // Spent: one code cannot back a second sign-up.
    await verification.update({ consumed_at: new Date() } as any);

    const session = await this.issueSession(account);

    this.activity.record({
      action: ActivityAction.PATIENT_SIGNUP,
      actor_type: ActivityActor.PATIENT,
      actor_id: account.id,
      actor_label: dto.mobile,
      entity_type: 'patient_account',
      entity_id: account.id,
      summary: `Patient account created for ${dto.mobile}.`,
    });

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
    const verification = await this.assertMobileVerified(dto.mobile);

    const account = existing ?? (await this.profiles.findOrCreateAccount(dto.mobile));
    await account.update({
      password_hash: await bcrypt.hash(dto.password, 10),
    } as any);
    await verification.update({ consumed_at: new Date() } as any);

    const profile = await this.profiles.createForAccount(
      account.id,
      dto.patient,
    );
    const session = await this.issueSession(account);

    this.activity.record({
      action: ActivityAction.PATIENT_SIGNUP,
      actor_type: ActivityActor.PATIENT,
      actor_id: account.id,
      actor_label: dto.mobile,
      entity_type: 'patient_account',
      entity_id: account.id,
      summary: `Patient account registered for ${dto.mobile} with one patient.`,
      metadata: { patient_profile_id: profile.id },
    });

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

  // ── Forgot / reset password ────────────────────────────────

  /**
   * Send a reset code to a number that already has an account.
   *
   * Answers the same way whether or not the number has one, and only actually
   * sends when it does. `check` does tell a caller whether a number is
   * registered — the sign-in screen cannot ask for "your password" or "choose
   * a password" without knowing — but that is one deliberate route with its
   * own rate limit, and this is not a second one. A number with no password
   * (a walk-in the front desk opened) has nothing to reset: it claims its
   * account through sign-up, which is the flow that is allowed to set a first
   * password.
   */
  async forgotPassword(
    dto: PatientForgotPasswordDto,
  ): Promise<{ ok: true; resendAfter: number }> {
    const mobile = dto.mobile;
    const account = await this.profiles.findAccount(mobile);
    if (!account?.password_hash) return { ok: true, resendAfter: RESEND_AFTER_SECONDS };

    const recent = await this.verificationModel.findOne({
      where: {
        mobile,
        purpose: MobileVerificationPurpose.PASSWORD_RESET,
        consumed_at: null,
      },
      order: [['created_at', 'DESC']],
    });
    if (recent) {
      const age = (Date.now() - new Date(recent.get('createdAt') as Date).getTime()) / 1000;
      if (age < RESEND_AFTER_SECONDS) {
        throw new AppException(ErrorCode.RATE_LIMITED, {
          message: `A code was just sent. Please wait ${Math.ceil(RESEND_AFTER_SECONDS - age)} seconds before asking for another.`,
        });
      }
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    // One live reset at a time: asking for a new code retires the old one, so
    // a code read off an old message cannot be used later.
    await this.verificationModel.destroy({
      where: {
        mobile,
        purpose: MobileVerificationPurpose.PASSWORD_RESET,
        consumed_at: null,
      },
    });
    const row = await this.verificationModel.create({
      mobile,
      purpose: MobileVerificationPurpose.PASSWORD_RESET,
      code_hash: sha256(`${mobile}:${code}`),
      attempts: 0,
      expires_at: new Date(Date.now() + CODE_MINUTES * 60_000),
    } as any);

    await this.whatsapp.sendOtp(mobile, code, `password_reset:${row.id}`);
    if (!this.isProduction && !this.whatsapp.enabled) {
      this.logger.log(`Password reset code for ${mobile}: ${code}`);
    }
    return { ok: true, resendAfter: RESEND_AFTER_SECONDS };
  }

  /**
   * Check the reset code; hand back a short-lived token for the new-password
   * call. Two steps rather than "code + new password" in one, so a wrong code
   * never costs the patient the password they just typed twice.
   */
  async verifyResetCode(dto: PatientVerifyResetCodeDto): Promise<{ token: string }> {
    const row = await this.verificationModel.findOne({
      where: {
        mobile: dto.mobile,
        purpose: MobileVerificationPurpose.PASSWORD_RESET,
        consumed_at: null,
        verified_at: null,
      },
      order: [['created_at', 'DESC']],
    });
    // "No code was asked for" and "it expired" get the same words — neither is
    // worth telling a stranger apart.
    if (!row || row.expires_at.getTime() < Date.now()) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'That code has expired. Please ask for a new one.',
      });
    }
    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      throw new AppException(ErrorCode.RATE_LIMITED, {
        message: 'Too many wrong attempts. Please ask for a new code.',
      });
    }
    if (row.code_hash !== sha256(`${dto.mobile}:${dto.code}`)) {
      const attempts = row.attempts + 1;
      await row.update({ attempts } as any);
      const left = MAX_CODE_ATTEMPTS - attempts;
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message:
          left > 0
            ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
            : 'That code is not right. Please ask for a new one.',
      });
    }

    const token = randomBytes(32).toString('base64url');
    await row.update({
      verified_at: new Date(),
      token_hash: sha256(token),
      expires_at: new Date(Date.now() + VERIFIED_FOR_MINUTES * 60_000),
    } as any);
    return { token };
  }

  /** Set the new password. The token is what proves the code was checked. */
  async resetPassword(dto: PatientResetPasswordDto): Promise<{ ok: true }> {
    const row = await this.verificationModel.findOne({
      where: {
        token_hash: sha256(dto.token),
        purpose: MobileVerificationPurpose.PASSWORD_RESET,
        consumed_at: null,
        verified_at: { [Op.ne]: null },
        expires_at: { [Op.gt]: new Date() },
      },
    });
    const account = row ? await this.profiles.findAccount(row.mobile) : null;
    if (!row || !account?.password_hash) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'This reset has expired. Please start again from Forgot password.',
      });
    }

    await account.update({
      password_hash: await bcrypt.hash(dto.password, 10),
    } as any);
    // Spent: one code, one password change.
    await row.update({ consumed_at: new Date() } as any);

    this.activity.record({
      action: ActivityAction.PASSWORD_CHANGED,
      actor_type: ActivityActor.PATIENT,
      actor_id: account.id,
      actor_label: account.mobile,
      entity_type: 'patient_account',
      entity_id: account.id,
      summary: `Patient ${account.mobile} reset their password with a WhatsApp code.`,
    });
    return { ok: true };
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
