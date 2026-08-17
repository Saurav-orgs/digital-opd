import { ApiProperty } from '@nestjs/swagger';
import { Matches, MaxLength, MinLength } from 'class-validator';

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
}
