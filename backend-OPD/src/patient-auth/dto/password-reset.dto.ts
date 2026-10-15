import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

/**
 * Forgetting a patient password, in the three steps the admin side already
 * uses (`auth/dto/password-reset.dto.ts`) — over WhatsApp rather than email,
 * because a patient account is a mobile number and nothing else.
 */
export class PatientForgotPasswordDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  mobile: string;
}

export class PatientVerifyResetCodeDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  mobile: string;

  @ApiProperty({ example: '482913', description: 'The 6-digit code from WhatsApp.' })
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from WhatsApp.' })
  code: string;
}

export class PatientResetPasswordDto {
  @ApiProperty({ description: 'The token returned when the code was verified.' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{32,128}$/, { message: 'Please verify the code again.' })
  token: string;

  @ApiProperty({ example: 'NewStrongPass@123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  password: string;
}
