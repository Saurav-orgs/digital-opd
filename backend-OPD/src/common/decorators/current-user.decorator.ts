import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserType } from '../enums';

/** The authenticated principal attached to the request by the JWT strategy. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  type: UserType;
  roleId: string | null;
  /** The role's display name, for the header — null for a role-less account. */
  roleName: string | null;
  doctorId: string | null;
  /** Opened through the paid sign-up — sign-in depends on an active plan. */
  subscriptionRequired: boolean;
  /**
   * Somebody else chose this password. Until it is replaced the session can
   * reach the change-password screen and nothing else.
   */
  mustChangePassword: boolean;
  permissions: string[]; // "module:action" strings
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthUser = request.user;
    return data ? user?.[data] : user;
  },
);
