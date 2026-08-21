import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

/** Core doctor profile fields, shared by create and patch DTOs. */
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

  // ── Prescription letterhead (logo is set via a separate upload) ──
  @ApiPropertyOptional({ example: 'Rao Heart Clinic' })
  @IsOptional()
  @IsString()
  clinic_name?: string;

  @ApiPropertyOptional({ example: '2nd Floor, MG Road, Bengaluru 560001' })
  @IsOptional()
  @IsString()
  clinic_address?: string;

  @ApiPropertyOptional({ example: '+91 98765 43210' })
  @IsOptional()
  @IsString()
  clinic_phone?: string;
}

export class UpdateDoctorDto extends PartialType(DoctorProfileDto) {}

/** Doctor editing their own profile — same shape, self-scoped. */
export class UpdateOwnDoctorDto extends PartialType(DoctorProfileDto) {}

/**
 * Super-admin payload for creating a new doctor tenant.
 * Returns one-time credentials + QR URL on success.
 */
export class CreateDoctorDto extends DoctorProfileDto {
  @ApiProperty({ example: 'dr.asha@hospital.com' })
  @IsEmail({}, { message: 'A valid email is required for the doctor login.' })
  email: string;

  @ApiProperty({ example: 'Welcome@123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  password: string;
}
