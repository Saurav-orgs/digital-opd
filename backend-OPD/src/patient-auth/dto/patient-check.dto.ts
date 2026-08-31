import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/**
 * Step 1 of signing in: does this number have an account, and has it got a
 * password yet?
 *
 * Replaces the old `identify`, which answered a bare number with a session and
 * the list of everyone registered on it. This answers with two booleans and
 * nothing else — enough to decide which field to show next, and useless for
 * reading anybody's records.
 */
export class PatientCheckDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  mobile: string;
}
