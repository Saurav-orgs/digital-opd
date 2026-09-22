import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt } from 'crypto';
import { Op } from 'sequelize';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { passwordResetCodeEmail, verificationCodeEmail } from '../mail/templates';
import { EmailVerification } from '../database/models/email-verification.model';
import { PasswordReset } from '../database/models/password-reset.model';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ConfirmEmailCodeDto, SendEmailCodeDto } from './dto/email-verification.dto';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyResetCodeDto,
} from './dto/password-reset.dto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ActivityLogService } from '../activity/activity-log.service';
import { ActivityAction, ActivityActor } from '../common/enums';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { DoctorVerificationStatus } from '../common/enums';
import { User } from '../database/models/user.model';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';

/** How long a sign-up code is good for, and how long a verified email stays usable. */
const CODE_MINUTES = 10;
const VERIFIED_FOR_MINUTES = 60;
const MAX_CODE_ATTEMPTS = 5;
/** Resend no sooner than this — one tap, one email. */
const RESEND_AFTER_SECONDS = 45;
/** How long a reset code is good for, and how long the verified step stays open. */
const RESET_CODE_MINUTES = 10;
const RESET_TOKEN_MINUTES = 15;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly isProduction: boolean;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly activity: ActivityLogService,
    private readonly mail: MailService,
    private readonly subscriptionAccess: SubscriptionAccessService,
    config: ConfigService,
    @InjectModel(EmailVerification)
    private readonly verificationModel: typeof EmailVerification,
    @InjectModel(PasswordReset)
    private readonly resetModel: typeof PasswordReset,
  ) {
    this.isProduction = config.get<string>('env') === 'production';
  }

  // ── Email verification at sign-up ──────────────────────────

  /**
   * Send a 6-digit code to an address a doctor wants to register with.
   *
   * Verifying *before* the account exists is what keeps sign-up ending on
   * the dashboard: there is no inert account waiting on a click in an inbox,
   * and a mistyped address is caught while the doctor is still on the form.
   * An address already in use is refused here, at the first step, rather
   * than after three screens of typing.
   */
  async sendEmailCode(dto: SendEmailCodeDto): Promise<{ ok: true; resendAfter: number }> {
    const email = dto.email.toLowerCase();

    if (await this.usersService.findForAuth(email)) {
      throw new AppException(ErrorCode.CONFLICT, {
        message: 'An account with this email already exists. Sign in instead.',
      });
    }

    const recent = await this.verificationModel.findOne({
      where: { email, consumed_at: null },
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
    await this.verificationModel.destroy({ where: { email, consumed_at: null } });
    await this.verificationModel.create({
      email,
      code_hash: sha256(`${email}:${code}`),
      attempts: 0,
      expires_at: new Date(Date.now() + CODE_MINUTES * 60_000),
    } as any);

    await this.mail.send({ to: email, ...verificationCodeEmail(code, CODE_MINUTES) });
    if (!this.isProduction && !this.mail.enabled) {
      this.logger.log(`Verification code for ${email}: ${code}`);
    }
    return { ok: true, resendAfter: RESEND_AFTER_SECONDS };
  }

  /** Check the code the doctor typed; the address is then good for an hour. */
  async confirmEmailCode(dto: ConfirmEmailCodeDto): Promise<{ verified: true }> {
    const email = dto.email.toLowerCase();
    const row = await this.verificationModel.findOne({
      where: { email, consumed_at: null },
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
    if (row.code_hash !== sha256(`${email}:${dto.code}`)) {
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

  /**
   * Registration asks this about the address it is about to create an
   * account for. Throws unless that address was verified recently.
   */
  async assertEmailVerified(email: string): Promise<void> {
    if (!(await this.liveVerification(email))) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'Please verify your email address before completing registration.',
      });
    }
  }

  /** Once the account exists: the verification is spent, and cannot back a second sign-up. */
  async markEmailVerificationUsed(email: string): Promise<void> {
    const row = await this.liveVerification(email);
    if (row) await row.update({ consumed_at: new Date() } as any);
  }

  private liveVerification(email: string): Promise<EmailVerification | null> {
    return this.verificationModel.findOne({
      where: {
        email: email.toLowerCase(),
        consumed_at: null,
        verified_at: { [Op.ne]: null },
        expires_at: { [Op.gt]: new Date() },
      },
      order: [['verified_at', 'DESC']],
    });
  }

  // ── Forgot / reset password ────────────────────────────────

  /**
   * Mail a 6-digit code. Always answers the same way, whether or not the
   * address belongs to anyone — the form must not be a way to find out who
   * has an account. A code rather than a link: it is typed into the screen
   * the doctor is already on, and works the same from a phone's mail app.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ ok: true; resendAfter: number }> {
    const user = await this.usersService.findForAuth(dto.email);
    if (!user || !user.is_active) return { ok: true, resendAfter: RESEND_AFTER_SECONDS };

    const recent = await this.resetModel.findOne({
      where: { user_id: user.id, used_at: null },
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
    // One live code at a time: the old one stops working the moment a new
    // one is asked for, so a stale email cannot be used later.
    await this.resetModel.update(
      { used_at: new Date() } as any,
      { where: { user_id: user.id, used_at: null } },
    );
    await this.resetModel.create({
      user_id: user.id,
      code_hash: sha256(`${user.email}:${code}`),
      attempts: 0,
      expires_at: new Date(Date.now() + RESET_CODE_MINUTES * 60_000),
    } as any);

    await this.mail.send({
      to: user.email,
      ...passwordResetCodeEmail(user.name, code, RESET_CODE_MINUTES),
    });
    if (!this.isProduction && !this.mail.enabled) {
      this.logger.log(`Password reset code for ${user.email}: ${code}`);
    }
    return { ok: true, resendAfter: RESEND_AFTER_SECONDS };
  }

  /**
   * Check the code; hand back a short-lived token for the new-password call.
   *
   * Two steps rather than "code + new password" in one, so the code is
   * checked exactly once and a wrong code never costs the doctor the
   * password they just typed twice.
   */
  async verifyResetCode(dto: VerifyResetCodeDto): Promise<{ token: string }> {
    const user = await this.usersService.findForAuth(dto.email);
    const row = user
      ? await this.resetModel.findOne({
          where: { user_id: user.id, used_at: null, verified_at: null },
          order: [['created_at', 'DESC']],
        })
      : null;
    // Same words for "no such account", "no code asked for" and "expired":
    // none of them is worth telling a stranger apart.
    if (!user || !row || row.expires_at.getTime() < Date.now()) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'That code has expired. Please ask for a new one.',
      });
    }
    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      throw new AppException(ErrorCode.RATE_LIMITED, {
        message: 'Too many wrong attempts. Please ask for a new code.',
      });
    }
    if (row.code_hash !== sha256(`${user.email}:${dto.code}`)) {
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
      expires_at: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000),
    } as any);
    return { token };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ ok: true }> {
    const row = await this.resetModel.findOne({
      where: {
        token_hash: sha256(dto.token),
        used_at: null,
        verified_at: { [Op.ne]: null },
        expires_at: { [Op.gt]: new Date() },
      },
      include: [{ model: User, attributes: ['id', 'name', 'email', 'doctor_id', 'is_active'] }],
    });
    if (!row || !row.user?.is_active) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'This reset has expired. Please start again from Forgot password.',
      });
    }
    await this.usersService.setPassword(row.user_id, dto.password);
    await row.update({ used_at: new Date() } as any);

    this.activity.record({
      action: ActivityAction.PASSWORD_CHANGED,
      actor_type: ActivityActor.USER,
      actor_id: row.user_id,
      actor_label: `${row.user.name} (${row.user.email})`,
      doctor_id: row.user.doctor_id ?? null,
      summary: `${row.user.name} reset their password with an emailed code.`,
      entity_type: 'user',
      entity_id: row.user_id,
    });
    return { ok: true };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findForAuth(dto.email);
    // Uniform message whether email is unknown or password is wrong.
    if (!user) {
      // Logged with the address that was tried, not a user id — there is no
      // user. A run of these against one address is what a break-in attempt
      // looks like, and it is invisible unless the failures are recorded too.
      this.activity.record({
        action: ActivityAction.LOGIN_FAILED,
        actor_type: ActivityActor.SYSTEM,
        actor_label: dto.email.toLowerCase(),
        summary: `Failed sign-in for ${dto.email.toLowerCase()} — no such account.`,
      });
      throw new AppException(ErrorCode.INVALID_CREDENTIALS);
    }

    const ok = await bcrypt.compare(dto.password, user.password_hash);
    if (!ok) {
      this.activity.record({
        action: ActivityAction.LOGIN_FAILED,
        actor_type: ActivityActor.USER,
        actor_id: user.id,
        actor_label: `${user.name} (${user.email})`,
        doctor_id: user.doctor_id ?? null,
        summary: `Failed sign-in for ${user.email} — wrong password.`,
      });
      throw new AppException(ErrorCode.INVALID_CREDENTIALS);
    }

    if (!user.is_active) {
      // A doctor who registered themselves is inactive for a reason they can
      // act on, so say which — "contact an administrator" is useless advice
      // when the answer is simply "we haven't looked at your licence yet".
      const status = user.doctor?.verification_status;
      if (status === DoctorVerificationStatus.PENDING) {
        throw new AppException(ErrorCode.ACCOUNT_DISABLED, {
          message:
            'Your registration is still being reviewed. You will be able to sign in once your practice licence has been verified.',
        });
      }
      if (status === DoctorVerificationStatus.REJECTED) {
        throw new AppException(ErrorCode.ACCOUNT_DISABLED, {
          message:
            user.doctor?.rejection_reason ||
            'Your registration was not approved. Please contact the platform administrator.',
        });
      }
      throw new AppException(ErrorCode.ACCOUNT_DISABLED);
    }

    // A paid-plan account with nothing paid — or a plan that has run out —
    // stops here, with a message that says which and what to do about it.
    await this.subscriptionAccess.assertAccess(user);

    const principal = UsersService.toAuthUser(user);

    this.activity.recordForUser(principal, {
      action: ActivityAction.LOGIN,
      summary: `${principal.name} signed in.`,
      entity_type: 'user',
      entity_id: principal.id,
      metadata: { type: principal.type },
    });

    const token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      type: user.type,
    });

    return {
      accessToken: token,
      user: principal,
    };
  }

  /**
   * A signed-in session for an account that was just created — the doctor
   * who has finished registering should land on their dashboard, not on the
   * login form to type the same email and password a second time.
   *
   * Same token and principal as `login`, minus the password check: the
   * caller has just set that password, and the row is seconds old.
   */
  async sessionForNewUser(userId: string) {
    const principal = await this.usersService.buildAuthUser(userId);
    if (!principal) throw new AppException(ErrorCode.ACCOUNT_DISABLED);

    this.activity.recordForUser(principal, {
      action: ActivityAction.LOGIN,
      summary: `${principal.name} signed in after registering.`,
      entity_type: 'user',
      entity_id: principal.id,
      metadata: { type: principal.type, via: 'registration' },
    });

    const token = await this.jwtService.signAsync({
      sub: principal.id,
      email: principal.email,
      type: principal.type,
    });
    return { accessToken: token, user: principal };
  }

  /**
   * Rotate your own password.
   *
   * The current password is required even though the caller is already
   * authenticated: a token left open on a shared clinic machine should not be
   * enough to lock the real owner out of their account.
   */
  async changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<void> {
    const row = await this.usersService.findForAuth(user.email);
    if (!row) throw new AppException(ErrorCode.UNAUTHORIZED);

    const ok = await bcrypt.compare(dto.current_password, row.password_hash);
    if (!ok) {
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, {
        message: 'Your current password is incorrect.',
      });
    }
    if (dto.current_password === dto.new_password) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'The new password must be different from the current one.',
      });
    }

    await this.usersService.setPassword(row.id, dto.new_password);

    this.activity.recordForUser(user, {
      action: ActivityAction.PASSWORD_CHANGED,
      summary: `${user.name} changed their own password.`,
      entity_type: 'user',
      entity_id: user.id,
    });
  }

  me(user: AuthUser): AuthUser {
    return user;
  }
}
