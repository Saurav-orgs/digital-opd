import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PatientDetailsDto } from '../../patient-profiles/dto/patient-profile.dto';

/**
 * Registration is: a number, plus one patient's details. The number becomes the
 * account and the details become that account's first patient — the same thing
 * a booking or a walk-in does, so all three paths agree.
 */
export class PatientRegisterDto {
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

  @ApiProperty({ type: PatientDetailsDto })
  @ValidateNested()
  @Type(() => PatientDetailsDto)
  patient: PatientDetailsDto;

  // Tenant context from the doctor's QR/portal. Accounts are keyed globally by
  // mobile, so this is accepted but not required.
  @ApiPropertyOptional({ example: 'a1b2c3d4-...' })
  @IsOptional()
  @IsUUID()
  doctor_id?: string;
}
