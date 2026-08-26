import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/** Step 1 of booking: the number, which is also register-or-login. */
export class PatientIdentifyDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  mobile: string;
}
