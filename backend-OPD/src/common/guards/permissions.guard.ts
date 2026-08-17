import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import {
  PERMISSIONS_KEY,
  RequiredPermission,
} from '../decorators/permissions.decorator';
import { AuthUser } from '../decorators/current-user.decorator';
import { UserType } from '../enums';

/**
 * Enforces `module:action` grants declared with @Permissions.
 * SuperAdmin bypasses all checks. `type` never grants abilities on its own —
 * a doctor passes only if their role holds the required permission (plan §2).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequiredPermission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const user: AuthUser = context.switchToHttp().getRequest().user;
    if (!user) throw new AppException(ErrorCode.UNAUTHORIZED);

    if (user.type === UserType.SUPER_ADMIN) return true;

    const held = new Set(user.permissions ?? []);
    const ok = required.every((p) => held.has(`${p.module}:${p.action}`));
    if (!ok) throw new AppException(ErrorCode.FORBIDDEN);

    return true;
  }
}
