import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { SubscriptionAccessService } from '../subscriptions/subscription-access.service';

export interface JwtPayload {
  sub: string;
  email: string;
  type: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
    private readonly subscriptionAccess: SubscriptionAccessService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt').secret,
    });
  }

  /** Re-hydrate the principal from the DB so permissions/active are current. */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.usersService.buildAuthUser(payload.sub);
    if (!user) {
      throw new AppException(ErrorCode.ACCOUNT_DISABLED);
    }
    // A plan that lapses mid-session ends the session; tokens live a day.
    await this.subscriptionAccess.assertAccess({
      id: user.id,
      type: user.type,
      doctor_id: user.doctorId,
      subscription_required: user.subscriptionRequired,
    });
    return user;
  }
}
