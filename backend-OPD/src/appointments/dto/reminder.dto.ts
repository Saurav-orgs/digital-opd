import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Doctor's reminder for the patient's next visit, set from this visit. */
export class ReminderDto {
  @ApiProperty({ example: 'Please come back for a follow-up in 2 weeks.' })
  @IsString()
  @MinLength(2, { message: 'Please enter a reminder message.' })
  @MaxLength(1000)
  message: string;

  @ApiPropertyOptional({ example: '2026-08-18' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Please choose a valid date (YYYY-MM-DD).',
  })
  suggested_date?: string;
}
