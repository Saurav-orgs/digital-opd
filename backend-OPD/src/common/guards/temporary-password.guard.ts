import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { AuthUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOWS_TEMPORARY_PASSWORD_KEY } from '../decorators/temporary-password.decorator';

/**
 * Holds an account whose password somebody else chose to one screen.
 *
 * The flag is enforced here rather than in the admin app because a screen the
 * client is asked to show is a screen the client can skip. A session on a
 * mailed password can read who it is and set a new one; every other route
 * answers PASSWORD_CHANGE_REQUIRED, which the app turns back into the
 * change-password screen.
 *
 * Public routes are untouched — sign-in itself has to keep working, and
 * Forgot password is a perfectly good way to discharge the obligation.
 */
@Injectable()
export class TemporaryPasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skip = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOWS_TEMPORARY_PASSWORD_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (user?.mustChangePassword) {
      throw new AppException(ErrorCode.PASSWORD_CHANGE_REQUIRED);
    }
    return true;
  }
}
