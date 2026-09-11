import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * A doctor signing themselves up.
 *
 * Everything here is an unverified claim until the super admin reviews the
 * licence file, which is now optional at sign-up — the redesigned form offers
 * "you can add this later" rather than blocking the account on a scan the
 * doctor may not have to hand. Licence review was already after-the-fact (see
 * registerSelf), so nothing about the trust model changes.
 *
 * The availability and vacation fields arrive as JSON strings because the
 * request is multipart/form-data, which has no nested types.
 */
export class RegisterDoctorDto {
  @ApiProperty({ example: 'Dr. Asha Rao' })
  @IsString()
  @MinLength(2, { message: 'Please enter your full name.' })
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'dr.asha@hospital.com' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;

  @ApiProperty({ example: 'Str0ngPass!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  @MaxLength(128)
  password: string;

  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  contact_mobile: string;

  @ApiProperty({ example: 'MCI-12345/2018' })
  @IsString()
  @MinLength(3, { message: 'Please enter your medical registration number.' })
  @MaxLength(80)
  license_number: string;

  @ApiPropertyOptional({ example: 'Cardiologist' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  specialization?: string;

  @ApiPropertyOptional({ example: 'MD, DM (Cardiology)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  qualifications?: string;

  @ApiPropertyOptional({ example: '12 Ring Road, Lajpat Nagar, New Delhi' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  clinic_address?: string;

  @ApiPropertyOptional({ example: 'Sunrise Family Clinic' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  clinic_name?: string;

  /**
   * Per-day opening hours, each day carrying its own sessions:
   *
   * `{"slot_duration_min":15,"days":[{"day":1,"slots":[{"start_time":"09:00","end_time":"13:00"}]}]}`
   *
   * A day left out — or sent with no slots — is a day off. The older
   * one-session-across-several-weekdays shape is still parsed, so an older
   * client keeps working; see `parseAvailability`.
   */
  @ApiPropertyOptional({
    example:
      '{"slot_duration_min":15,"days":[{"day":1,"slots":[{"start_time":"09:00","end_time":"13:00"},{"start_time":"17:00","end_time":"19:00"}]}]}',
  })
  @IsOptional()
  @IsString()
  // Seven days of split sessions do not fit in 400 characters.
  @MaxLength(4000)
  availability?: string;

  /** `[{"from":"2026-12-24","to":"2026-12-26","reason":"Family vacation"}]` */
  @ApiPropertyOptional({
    example: '[{"from":"2026-12-24","to":"2026-12-26","reason":"Family vacation"}]',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  vacations?: string;

  /**
   * Version of the Provider Terms the sign-up form displayed. Sent by the
   * client so the stored acceptance names the wording actually shown, rather
   * than whatever the server happens to consider current later on.
   */
  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  terms_version?: string;
}

export class RejectDoctorDto {
  @ApiPropertyOptional({ example: 'Licence document was unreadable.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
