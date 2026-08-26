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
 * licence file that accompanies it, so nothing in this payload grants access on
 * its own.
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
}

export class RejectDoctorDto {
  @ApiPropertyOptional({ example: 'Licence document was unreadable.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
