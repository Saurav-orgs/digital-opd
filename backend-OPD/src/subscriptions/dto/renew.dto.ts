import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * A signed-in doctor buys their next cycle.
 *
 * No email or password here, unlike the landing page's `resume`: the caller is
 * already authenticated, and the account being renewed is whichever one holds
 * the token — a doctor cannot renew somebody else's plan by typing their
 * address.
 */
export class RenewSubscriptionDto {
  /** A plan's `code`. Looked up server-side; a retired one is refused. */
  @ApiProperty({ example: 'quarterly' })
  @IsString()
  @MaxLength(30)
  plan: string;

  /**
   * Cashfree needs a customer phone on every order. Asked rather than read
   * off the profile: the number on the clinic record is the one patients ring,
   * which is not always the one that should get the payment receipt.
   */
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, { message: 'Please enter a valid 10-digit mobile number.' })
  mobile: string;
}
