import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** The authenticated patient principal attached to the request by the patient-jwt strategy. */
export interface AuthPatient {
  id: string;
  mobile: string;
  name: string;
}

export const CurrentPatient = createParamDecorator(
  (data: keyof AuthPatient | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const patient: AuthPatient = request.user;
    return data ? patient?.[data] : patient;
  },
);
