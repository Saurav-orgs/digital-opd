import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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

  /**
   * Optional. The landing page's sign-up form has it to hand and passes it; the
   * admin app's sign-in screen does not ask for one, and the server falls back
   * to the clinic's own number (`SubscriptionsService.checkoutPhone`). Cashfree
   * needs a phone on the order, nothing else here does.
   */
  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @Matches(/^[6-9]\d{9}$/, { message: 'Please enter a valid 10-digit mobile number.' })
  mobile?: string;

  /** A plan's `code`. Looked up server-side; an unknown or retired one is refused. */
  @ApiProperty({ example: 'quarterly' })
  @IsString()
  @MaxLength(30)
  plan: string;

  /**
   * Which screen the payer started on, and therefore where Cashfree returns
   * them: the landing site's own confirmation page by default, or the admin
   * app's sign-in screen when a locked-out doctor is activating their account
   * from there.
   *
   * A name rather than a URL on purpose — this route is public, and an
   * arbitrary `returnUrl` from an unauthenticated caller is an open redirect
   * with a payment attached to it.
   */
  @ApiPropertyOptional({ enum: ['landing', 'app'], default: 'landing' })
  @IsOptional()
  @IsIn(['landing', 'app'])
  origin?: 'landing' | 'app';
}
