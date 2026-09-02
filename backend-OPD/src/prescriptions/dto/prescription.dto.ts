import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
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
