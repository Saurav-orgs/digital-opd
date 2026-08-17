import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserType } from '../enums';

/** The authenticated principal attached to the request by the JWT strategy. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  type: UserType;
  roleId: string | null;
  doctorId: string | null;
  permissions: string[]; // "module:action" strings
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthUser = request.user;
    return data ? user?.[data] : user;
  },
);
