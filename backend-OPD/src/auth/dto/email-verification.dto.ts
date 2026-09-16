import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, Matches } from 'class-validator';

export class SendEmailCodeDto {
  @ApiProperty({ example: 'dr.asha@example.com' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;
}

export class ConfirmEmailCodeDto {
  @ApiProperty({ example: 'dr.asha@example.com' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;

  @ApiProperty({ example: '482913', description: 'The 6-digit code from the email.' })
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code from the email.' })
  code: string;
}
