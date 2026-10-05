import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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

/** The blood groups a dropdown offers; free text is not accepted. */
export const BLOOD_GROUPS = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
] as const;

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

/**
 * The clinical summary the clinic keeps by hand, shared by the staff create and
 * edit forms. Everything is optional — a desk registers a patient with a name
 * and fills the clinical picture in over later visits — and the two lists are
 * capped so a stray paste cannot write an unbounded array.
 */
export class PatientClinicalDto {
  @ApiPropertyOptional({ enum: BLOOD_GROUPS })
  @IsOptional()
  @IsIn(BLOOD_GROUPS as unknown as string[], {
    message: 'Please choose a valid blood group.',
  })
  blood_group?: string;

  @ApiPropertyOptional({ type: [String], example: ['Hypertension', 'Asthma'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  @Type(() => String)
  conditions?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Amlodipine 5 mg · 1-0-0'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  @Type(() => String)
  long_term_medicines?: string[];
}

/**
 * Registering a patient from the clinic's own desk. The number is the account —
 * typing one that is new creates it — so it is required here where the public
 * forms get it from the signed-in patient. The desk works from a date of birth
 * rather than an age, and the address is optional: a walk-in is registered with
 * a queue waiting and the address arrives on the first booking.
 */
export class StaffCreatePatientDto extends PatientClinicalDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  mobile: string;

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

  @ApiPropertyOptional({ example: '1990-05-21', description: 'YYYY-MM-DD' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Date of birth must be in YYYY-MM-DD form.',
  })
  dob?: string;

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

  @ApiPropertyOptional({ example: 'H-42, Nehru Nagar' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address_line?: string;

  @ApiPropertyOptional({ example: 'Indore' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ example: 'Madhya Pradesh' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;

  @ApiPropertyOptional({ example: '452001' })
  @IsOptional()
  @Matches(/^[1-9]\d{5}$/, {
    message: 'Please enter a valid 6-digit PIN code.',
  })
  pincode?: string;
}

/** Editing a clinic patient from the desk — every field optional. */
export class StaffUpdatePatientDto extends PatientClinicalDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsIn(['male', 'female', 'other'])
  gender?: string;

  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Date of birth must be in YYYY-MM-DD form.',
  })
  dob?: string;

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
