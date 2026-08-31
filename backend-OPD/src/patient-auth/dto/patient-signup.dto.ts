import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Opening an account from the booking flow: a number and a password, no
 * patient details.
 *
 * Booking asks who the visit is for on the *next* step, so requiring a name
 * here would be asking for it twice. It also covers the walk-in case — an
 * account the front desk created has no password, and this sets one.
 */
export class PatientSignupDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  mobile: string;

  @ApiProperty({ example: 'Str0ngPass', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4-...' })
  @IsOptional()
  @IsUUID()
  doctor_id?: string;
}
