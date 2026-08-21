import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class PatientRegisterDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  mobile: string;

  @ApiProperty({ example: 'Ravi Kumar' })
  @MinLength(2, { message: 'Please enter your name.' })
  @MaxLength(120)
  name: string;

  // Tenant context from the doctor's QR/portal. Patients are keyed globally by
  // mobile, so this is accepted but not required for the account itself.
  @ApiPropertyOptional({ example: 'a1b2c3d4-...' })
  @IsOptional()
  @IsUUID()
  doctor_id?: string;
}
