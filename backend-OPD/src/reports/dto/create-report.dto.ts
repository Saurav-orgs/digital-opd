import { ApiProperty } from '@nestjs/swagger';
import { Matches, MaxLength, MinLength } from 'class-validator';

export class CreateReportDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  mobile: string;

  @ApiProperty({ example: 'Blood Test — CBC' })
  @MinLength(2, { message: 'Please enter a title for this report.' })
  @MaxLength(200)
  title: string;
}
