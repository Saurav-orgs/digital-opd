import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

/** Relation is a label for the booking UI; it grants nothing. */
export const RELATIONS = ['self', 'spouse', 'child', 'parent', 'other'] as const;

/**
 * The patient details captured at registration — which is any of: booking for
 * yourself, booking for a family member, a walk-in typed by the front desk, or
 * the standalone register screen. All four create exactly one patient, so they
 * all collect the same fields.
 */
export class PatientDetailsDto {
  @ApiProperty({ example: 'Shubham Kumar' })
  @IsString()
  @MinLength(2, { message: 'Please enter the patient’s name.' })
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({ enum: ['male', 'female', 'other'] })
  @IsOptional()
  @IsIn(['male', 'female', 'other'], {
    message: 'Gender must be male, female or other.',
  })
  gender?: string;

  @ApiPropertyOptional({ example: 34 })
  @IsOptional()
  @IsInt({ message: 'Age must be a whole number.' })
  @Min(0)
  @Max(120)
  age?: number;

  @ApiPropertyOptional({ enum: RELATIONS })
  @IsOptional()
  @IsIn(RELATIONS as unknown as string[], {
    message: 'Relation must be self, spouse, child, parent or other.',
  })
  relation?: string;

  @ApiProperty({ example: 'H-42, Nehru Nagar' })
  @IsString()
  @MinLength(3, { message: 'Please enter the address.' })
  @MaxLength(300)
  address_line: string;

  @ApiProperty({ example: 'Indore' })
  @IsString()
  @MinLength(2, { message: 'Please enter the city.' })
  @MaxLength(80)
  city: string;

  @ApiProperty({ example: 'Madhya Pradesh' })
  @IsString()
  @MinLength(2, { message: 'Please enter the state.' })
  @MaxLength(80)
  state: string;

  @ApiProperty({ example: '452001' })
  @Matches(/^[1-9]\d{5}$/, {
    message: 'Please enter a valid 6-digit PIN code.',
  })
  pincode: string;
}

/** Every field optional — a patient editing their own record. */
export class UpdatePatientProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsIn(['male', 'female', 'other'])
  gender?: string;

  @ApiPropertyOptional() @IsOptional() @IsIn(RELATIONS as unknown as string[])
  relation?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  address_line?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80)
  city?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80)
  state?: string;

  @ApiPropertyOptional() @IsOptional() @Matches(/^[1-9]\d{5}$/, {
    message: 'Please enter a valid 6-digit PIN code.',
  })
  pincode?: string;
}
