import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Doctor-created, in-clinic booking. `doctor_id` is optional: for a doctor
 * account it is forced to their own id; an admin must supply it. `end_time` is
 * derived server-side.
 *
 * The date and time are optional and default to the clinic's own now. A
 * walk-in is booked with the patient already standing there, routinely outside
 * published hours, so the desk is not asked when the visit is — it is now. The
 * fields stay accepted for the rare correction, and for any caller that still
 * sends them.
 *
 * The address fields are optional here, unlike a public self-booking. Someone
 * standing at the desk with a queue behind them is not the moment to insist on
 * a PIN code, and the clinic can fill it in later from the patient's record —
 * whereas a patient booking from home has the time and the details to hand.
 */
export class WalkInAppointmentDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    { message: 'A valid doctor is required.' },
  )
  doctor_id?: string;

  @ApiPropertyOptional({ example: '2026-07-28', description: "Defaults to the clinic's today." })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Please choose a valid date (YYYY-MM-DD).',
  })
  appointment_date?: string;

  @ApiPropertyOptional({ example: '11:30', description: "Defaults to the clinic's current time." })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Please choose a valid time slot (HH:mm).',
  })
  start_time?: string;

  /**
   * Hold this booking to the published slot grid.
   *
   * A walk-in skips every slot check on purpose — the patient is in the room
   * and the doctor sees them between slots and after hours — and a clash is
   * nudged to the next free minute rather than refused, because two people
   * walking in together is the clock being coarse, not a double booking.
   *
   * Neither is right when the desk picked the slot off the grid on **My time
   * slots**: a slot taken a second earlier should say so, not quietly become
   * 11:31. Sending this true validates the slot (`SLOT_NOT_FOUND`,
   * `SLOT_IN_PAST`, `SLOT_ALREADY_BOOKED`) and leaves the minute alone.
   *
   * camelCase, per CLAUDE.md: existing request fields stay snake_case, new
   * ones do not add to them.
   */
  @ApiPropertyOptional({
    description: 'Validate the slot against the published grid instead of nudging a clash.',
  })
  @IsOptional()
  @IsBoolean({ message: 'enforceSlot must be true or false.' })
  enforceSlot?: boolean;

  /**
   * The patient this visit is for, chosen from the pick-list at booking step 2.
   * Omit it to register a new patient from the details below — an identical
   * name is never treated as a match, so leaving this out always means "a
   * different person".
   */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  patient_profile_id?: string;

  @ApiProperty({ example: 'Ravi Kumar' })
  @IsString()
  @MinLength(2, { message: 'Please enter the patient’s name.' })
  @MaxLength(120)
  patient_name: string;

  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  patient_mobile: string;

  @ApiProperty({ enum: ['male', 'female', 'other'] })
  @IsIn(['male', 'female', 'other'], { message: 'Please select a gender.' })
  patient_gender: string;

  /**
   * Date of birth is what the desk now enters; age is derived from it so it
   * cannot go stale between visits. `patient_age` is still accepted — an
   * existing patient picked from the list may predate the dob column, and the
   * appointment row keeps an age snapshot either way.
   */
  @ApiPropertyOptional({ example: '1994-03-18' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Please enter a valid date of birth (YYYY-MM-DD).',
  })
  patient_dob?: string;

  @ApiPropertyOptional({ example: 34, minimum: 0, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Please enter a valid age.' })
  @Min(0, { message: 'Please enter a valid age.' })
  @Max(120, { message: 'Please enter a valid age.' })
  patient_age?: number;

  @ApiPropertyOptional({ example: 'H-42, Nehru Nagar' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  patient_address?: string;

  @ApiPropertyOptional({ example: 'Indore' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  patient_city?: string;

  @ApiPropertyOptional({ example: 'Madhya Pradesh' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  patient_state?: string;

  // Still validated when given — a wrong PIN is worse than none.
  @ApiPropertyOptional({ example: '452001' })
  @IsOptional()
  @Matches(/^[1-9]\d{5}$/, {
    message: 'Please enter a valid 6-digit PIN code.',
  })
  patient_pincode?: string;

  @ApiPropertyOptional({ description: 'Reason for visit.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
