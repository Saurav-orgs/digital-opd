import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

/**
 * Staff account created by the doctor (nurse, receptionist…). Abilities come
 * entirely from the chosen role; the account type and the doctor it belongs to
 * are set server-side, since the clinic has exactly one doctor.
 */
export class CreateUserDto {
  @ApiProperty({ example: 'Nurse Meera' })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters.' })
  name: string;

  @ApiProperty({ example: 'meera@clinic.com' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;

  @ApiProperty({ example: 'StrongPass@123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  password: string;

  @ApiProperty({ description: 'Role that governs this user’s permissions.' })
  @IsUUID('4', { message: 'A valid role is required.' })
  role_id: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
