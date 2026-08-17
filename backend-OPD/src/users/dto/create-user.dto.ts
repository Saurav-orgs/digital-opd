import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { UserType } from '../../common/enums';

export class CreateUserDto {
  @ApiProperty({ example: 'Dr. Asha Rao' })
  @IsString()
  @MinLength(2, { message: 'Name must be at least 2 characters.' })
  name: string;

  @ApiProperty({ example: 'asha@clinic.com' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;

  @ApiProperty({ example: 'StrongPass@123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters.' })
  password: string;

  @ApiProperty({ enum: [UserType.ADMIN, UserType.DOCTOR, UserType.PATHLAB] })
  @IsEnum(UserType, { message: 'Type must be admin, doctor, or pathlab.' })
  type: UserType;

  @ApiProperty({ description: 'Role that governs this user’s permissions.' })
  @IsUUID('4', { message: 'A valid role is required.' })
  role_id: string;

  @ApiPropertyOptional({
    description: 'Required when type = doctor: the doctor profile to link.',
  })
  @ValidateIf((o) => o.type === UserType.DOCTOR)
  @IsUUID('4', { message: 'A valid doctor must be linked for doctor logins.' })
  doctor_id?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
