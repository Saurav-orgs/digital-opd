import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Doctor-created, in-clinic booking. No payment screenshot — walk-ins are cod.
 * `doctor_id` is optional: for a doctor account it is forced to their own id;
 * an admin must supply it. `end_time` is derived server-side from the slot.
 */
export class WalkInAppointmentDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @Matches(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    { message: 'A valid doctor is required.' },
  )
  doctor_id?: string;

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

  @ApiProperty({ example: 34, minimum: 0, maximum: 120 })
  @Type(() => Number)
  @IsInt({ message: 'Please enter a valid age.' })
  @Min(0, { message: 'Please enter a valid age.' })
  @Max(120, { message: 'Please enter a valid age.' })
  patient_age: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  patient_address?: string;

  @ApiPropertyOptional({ description: 'Reason for visit.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
