import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Global JWT guard. Routes marked @Public() skip authentication.
 * Failures surface as our uniform UNAUTHORIZED error.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw new AppException(ErrorCode.UNAUTHORIZED);
    }
    return user;
  }
}
