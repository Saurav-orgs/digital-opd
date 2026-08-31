import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateSettingsDto {
  /**
   * Base URL of the patient portal. Every doctor's booking link and QR is
   * built from this plus their slug, so it has to be an address a patient's
   * phone can actually reach — not localhost.
   */
  @ApiPropertyOptional({ example: 'https://booking.myclinic.com' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Matches(/^https?:\/\/.+/i, {
    message: 'Enter a full URL starting with http:// or https://',
  })
  patient_web_base?: string;
}
