import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'dr.asha@example.com' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;
}

export class VerifyResetCodeDto {
  @ApiProperty({ example: 'dr.asha@example.com' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;

  @ApiProperty({ example: '482913', description: 'The 6-digit code from the email.' })
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from the email.' })
  code: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'The token returned when the code was verified.' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{32,128}$/, { message: 'Please verify the code again.' })
  token: string;

  @ApiProperty({ example: 'NewStrongPass@123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  password: string;
}
