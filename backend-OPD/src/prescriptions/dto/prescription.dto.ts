import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PrescriptionMode } from '../../common/enums';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PrescriptionMedicineDto {
  @ApiPropertyOptional({ description: 'Present when editing an existing row.' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 'Dolo 650' })
  @IsString()
  @MinLength(2, { message: 'Please enter the medicine name.' })
  @MaxLength(160)
  medicine_name: string;

  @ApiPropertyOptional({ example: '650mg' })
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
   * Morning-afternoon-night, e.g. "1-0-1". Allowed to be empty *while drafting*:
   * the AI leaves it blank rather than guessing, and the doctor fills it in.
   * Issuing is what enforces that every row has one.
   */
  @ApiProperty({ example: '1-0-1', description: 'Morning-afternoon-night' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  dosage?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  duration_days?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;
}

/** Full replacement of the draft — the editor always sends the whole thing. */
export class UpdatePrescriptionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  diagnosis?: string;

  @ApiPropertyOptional({ example: 'Known diabetic for 10 years; allergic to penicillin' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  previous_history?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  advice?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'follow_up_date must be YYYY-MM-DD.' })
  follow_up_date?: string;

  @ApiPropertyOptional({ type: [PrescriptionMedicineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionMedicineDto)
  medicines?: PrescriptionMedicineDto[];
}

/**
 * Which tab the doctor pressed Issue on.
 *
 * The prescription for one visit is written in one place. A doctor who
 * dictated, then photographed the pad because the dictation came out wrong,
 * has two drafts on the server and means only one of them to reach the
 * patient — and only the screen knows which, because the other is still sitting
 * there saved. The tab that issued is the prescription; the rest is working
 * material.
 *
 * `structured` covers Type and Record both. They are two ways of filling the
 * same form, and the doctor who dictates and then corrects a dosage by hand
 * has not changed what they are writing.
 *
 * Optional, and inferred from the draft when it is missing, so an older client
 * (and the share and print paths, which issue a draft on the doctor's behalf)
 * still works.
 */
export class IssuePrescriptionDto {
  @ApiPropertyOptional({ enum: PrescriptionMode, example: PrescriptionMode.STRUCTURED })
  @IsOptional()
  @IsEnum(PrescriptionMode)
  mode?: PrescriptionMode;
}
