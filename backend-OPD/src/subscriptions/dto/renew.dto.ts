import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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
   * Cashfree needs a customer phone on every order, so one is sent — but it is
   * no longer asked for here. The receipt and the invoice go to the address on
   * the account, which is the address the doctor signs in with, so a second
   * field on the renewal card only stood between the doctor and paying. The
   * server falls back to the number on the clinic record; see
   * `SubscriptionsService.checkoutPhone`.
   *
   * Still accepted, and still validated when present, so an older build of the
   * app keeps working.
   */
  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @Matches(/^[6-9]\d{9}$/, { message: 'Please enter a valid 10-digit mobile number.' })
  mobile?: string;
}
