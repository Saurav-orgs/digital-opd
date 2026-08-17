import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateDoctorDto {
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

export class UpdateDoctorDto extends PartialType(CreateDoctorDto) {}

/** Doctor editing their own profile — same shape, self-scoped. */
export class UpdateOwnDoctorDto extends PartialType(CreateDoctorDto) {}
