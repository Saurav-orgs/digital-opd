import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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

  /**
   * Either a saved role, or the permissions themselves. The team screen sends
   * the latter — a doctor ticks what the receptionist may do and never has
   * to hear the word "role"; the server keeps one behind the scenes.
   */
  @ApiPropertyOptional({ description: 'Role that governs this user’s permissions.' })
  @IsOptional()
  @IsUUID('4', { message: 'A valid role is required.' })
  role_id?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Permission ids granted directly; a personal role is kept for them.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true, message: 'Each permission must be a valid id.' })
  permissionIds?: string[];

  /**
   * What to call this person's role — "Receptionist", "Nurse" — shown beside
   * their name when they sign in. Names the personal role kept for their
   * permissions; falls back to "<name>'s access" when left blank.
   */
  @ApiPropertyOptional({ example: 'Receptionist', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: 'Role name must be 60 characters or fewer.' })
  role_name?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
