import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Super admin resets a doctor's login password.
 *
 * The doctor is told the new password out of band (the create flow shows it
 * once, and so does this), because a locked-out doctor has no other way back
 * in — there is no email delivery in this deployment.
 */
export class ResetDoctorPasswordDto {
  @ApiProperty({ example: 'NewPass@2026', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128)
  password: string;
}
