import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Step 2 of the paid sign-up: the credentials, after the email is verified. */
export class CreateAccountDto {
  @ApiProperty({ example: 'dr.asha@hospital.com' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128)
  password: string;

  /** Cashfree needs a customer phone on every order; it also pre-fills the profile. */
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, { message: 'Please enter a valid 10-digit mobile number.' })
  mobile: string;

  /** A plan's `code`. Looked up server-side; an unknown or retired one is refused. */
  @ApiProperty({ example: 'quarterly' })
  @IsString()
  @MaxLength(30)
  plan: string;
}

/** An account that exists but never paid comes back to pay through this. */
export class ResumeSignupDto {
  @ApiProperty()
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;

  /** Asked again rather than looked up: before the profile exists the server has no number on file. */
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, { message: 'Please enter a valid 10-digit mobile number.' })
  mobile: string;

  /** A plan's `code`. Looked up server-side; an unknown or retired one is refused. */
  @ApiProperty({ example: 'quarterly' })
  @IsString()
  @MaxLength(30)
  plan: string;
}
