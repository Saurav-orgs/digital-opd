import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IvfCaseSheetData } from '../ivf-case-sheet.schema';

/**
 * The whole case-sheet body in one `data` object. It is not validated field by
 * field here — `sanitizeIvfCaseSheetData` in the service is the authority on
 * what a valid body is, dropping unknown keys and capping every value. The DTO
 * only asserts the envelope is an object so a malformed request is a 400, not a
 * crash inside the sanitizer.
 */
export class UpdateIvfCaseSheetDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  data: IvfCaseSheetData;
}

export class SaveIvfTemplateDto {
  @ApiProperty({ example: 'Primary infertility — standard workup' })
  @IsString()
  @MinLength(2, { message: 'Please name this template.' })
  @MaxLength(160)
  name: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  data: IvfCaseSheetData;
}

/** Everything optional on a PATCH; what is sent replaces what is stored. */
export class UpdateIvfTemplateDto {
  @ApiPropertyOptional({ example: 'Primary infertility — standard workup' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  data?: IvfCaseSheetData;
}
