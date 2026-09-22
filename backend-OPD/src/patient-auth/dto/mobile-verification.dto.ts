import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class SendMobileCodeDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  mobile: string;
}

export class ConfirmMobileCodeDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  mobile: string;

  @ApiProperty({ example: '482913', description: 'The 6-digit code from WhatsApp.' })
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from WhatsApp.' })
  code: string;
}
