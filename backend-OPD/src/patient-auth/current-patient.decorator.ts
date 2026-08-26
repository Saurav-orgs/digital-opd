import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The authenticated principal — an *account* (a mobile number), not a person.
 * The people on it are `PatientProfile` rows, so there is deliberately no name
 * here: every clinical call carries the chosen `profile_id` instead.
 */
export interface AuthPatient {
  id: string;
  mobile: string;
}

export const CurrentPatient = createParamDecorator(
  (data: keyof AuthPatient | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const patient: AuthPatient = request.user;
    return data ? patient?.[data] : patient;
  },
);
