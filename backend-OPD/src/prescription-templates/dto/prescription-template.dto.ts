import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class TemplateMedicineDto {
  @ApiProperty({ example: 'Paracetamol' })
  @IsString()
  @MinLength(2, { message: 'Please enter the medicine name.' })
  @MaxLength(160)
  medicine_name: string;

  @ApiPropertyOptional({ example: '650 mg' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  strength?: string;

  @ApiPropertyOptional({ example: 'tablet' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  form?: string;

  /**
   * Free text rather than a `1-0-1` pattern: the built-ins alone need "As
   * needed" and "After each loose stool", and a template is what the doctor
   * would have written by hand.
   */
  @ApiProperty({ example: '1-0-1' })
  @IsString()
  @MaxLength(40)
  dosage: string;

  /**
   * Both halves of the duration, parsed client-side by `lib/duration.ts`.
   * The server stores what it is given rather than parsing again — a second
   * parser here is a second set of rules to disagree with the editor's.
   */
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  duration_days?: number;

  @ApiPropertyOptional({ example: '3 days', description: 'As the doctor wrote it.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  duration_text?: string;

  @ApiPropertyOptional({ example: 'After food' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;
}

export class SaveTemplateDto {
  @ApiProperty({ example: 'Fever' })
  @IsString()
  @MinLength(1, { message: 'Please choose a category.' })
  @MaxLength(80)
  category: string;

  @ApiProperty({ example: 'Viral fever — adult' })
  @IsString()
  @MinLength(2, { message: 'Please name this template.' })
  @MaxLength(160)
  name: string;

  /** May be the whole template — medicines are optional. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  advice?: string;

  /**
   * Constrained to the four the design offers. A template is a starting point
   * the doctor adjusts per patient, so an arbitrary number here would be
   * precision the form cannot express and the doctor did not ask for.
   */
  @ApiPropertyOptional({ example: 7, enum: [3, 7, 14, 30] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([3, 7, 14, 30], {
    message: 'Follow-up can be 3, 7, 14 or 30 days.',
  })
  follow_up_days?: number;

  @ApiPropertyOptional({ type: [TemplateMedicineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateMedicineDto)
  medicines?: TemplateMedicineDto[];
}

/** Everything is optional on a PATCH; what is sent replaces what is stored. */
export class UpdateTemplateDto extends SaveTemplateDto {
  @ApiPropertyOptional({ example: 'Fever' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  declare category: string;

  @ApiPropertyOptional({ example: 'Viral fever — adult' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  declare name: string;
}
