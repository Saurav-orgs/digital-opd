import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, MaxLength, MinLength } from 'class-validator';

/**
 * Patient edit of their own report. Both fields are optional — the request may
 * rename the report, replace the file, or do both; the file rides alongside as
 * multipart, so it is not declared here.
 */
export class UpdateOwnReportDto {
  @ApiPropertyOptional({ example: 'Blood Test — CBC (repeat)' })
  @IsOptional()
  @MinLength(2, { message: 'Please enter a title for this report.' })
  @MaxLength(200)
  title?: string;
}
