import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Editable fields of the clinic's doctor profile. The profile itself is seeded
 * at bootstrap (the SuperAdmin is the doctor), so this is only ever a patch.
 */
export class DoctorProfileDto {
  @ApiProperty({ example: 'Dr. Asha Rao' })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters.' })
  name: string;

  @ApiPropertyOptional({ example: 'Cardiologist' })
  @IsOptional()
  @IsString()
  specialization?: string;

  @ApiPropertyOptional({ example: 'MD, DM (Cardiology)' })
  @IsOptional()
  @IsString()
  qualifications?: string;

  @ApiPropertyOptional({ example: 'Senior consultant with 15 years experience.' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Consultation fee must be a number.' })
  @Min(0, { message: 'Consultation fee cannot be negative.' })
  consultation_fee?: number;
}

export class UpdateDoctorDto extends PartialType(DoctorProfileDto) {}

/** Doctor editing their own profile — same shape, self-scoped. */
export class UpdateOwnDoctorDto extends PartialType(DoctorProfileDto) {}
