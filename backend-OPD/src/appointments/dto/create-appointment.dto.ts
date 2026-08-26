import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
 * Public booking payload. Payment happens in person, so no screenshot.
 * `end_time` is derived server-side from the slot, never trusted from input.
 */
export class CreateAppointmentDto {
  @ApiProperty({ format: 'uuid' })
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    { message: 'A valid doctor is required.' },
  )
  doctor_id: string;

  @ApiProperty({ example: '2026-07-28' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Please choose a valid date (YYYY-MM-DD).',
  })
  appointment_date: string;

  @ApiProperty({ example: '11:30' })
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Please choose a valid time slot (HH:mm).',
  })
  start_time: string;

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
  @IsIn(['male', 'female', 'other'], {
    message: 'Please select a gender.',
  })
  patient_gender: string;

  @ApiProperty({ example: 34, minimum: 0, maximum: 120 })
  @Type(() => Number)
  @IsInt({ message: 'Please enter a valid age.' })
  @Min(0, { message: 'Please enter a valid age.' })
  @Max(120, { message: 'Please enter a valid age.' })
  patient_age: number;

  @ApiProperty({ example: 'H-42, Nehru Nagar' })
  @IsString()
  @MinLength(3, { message: 'Please enter the address.' })
  @MaxLength(300)
  patient_address: string;

  @ApiProperty({ example: 'Indore' })
  @IsString()
  @MinLength(2, { message: 'Please enter the city.' })
  @MaxLength(80)
  patient_city: string;

  @ApiProperty({ example: 'Madhya Pradesh' })
  @IsString()
  @MinLength(2, { message: 'Please enter the state.' })
  @MaxLength(80)
  patient_state: string;

  @ApiProperty({ example: '452001' })
  @Matches(/^[1-9]\d{5}$/, {
    message: 'Please enter a valid 6-digit PIN code.',
  })
  patient_pincode: string;

  @ApiPropertyOptional({ description: 'Reason for visit.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
