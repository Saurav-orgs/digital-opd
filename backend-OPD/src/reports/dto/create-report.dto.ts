import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateReportDto {
  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Please enter a valid 10-digit mobile number.',
  })
  mobile: string;

  /**
   * Which patient on that number the report is for. Required: one number may
   * cover a whole family, and filing a report against the wrong member is not
   * a mistake the system can detect later.
   */
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'Please choose which patient this report is for.' })
  patient_profile_id: string;

  @ApiProperty({ example: 'Blood Test — CBC' })
  @MinLength(2, { message: 'Please enter a title for this report.' })
  @MaxLength(200)
  title: string;
}
