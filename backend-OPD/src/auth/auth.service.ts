import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ActivityLogService } from '../activity/activity-log.service';
import { ActivityAction, ActivityActor } from '../common/enums';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { DoctorVerificationStatus } from '../common/enums';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly activity: ActivityLogService,
  ) {}

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
