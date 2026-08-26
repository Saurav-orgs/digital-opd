import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ProgressTrendDto {
  @ApiProperty() @IsString() @MaxLength(120) label: string;
  @ApiProperty() @IsString() @MaxLength(80) previous_value: string;
  @ApiProperty() @IsString() @MaxLength(80) current_value: string;

  @ApiProperty({ enum: ['up', 'down', 'same'] })
  @IsIn(['up', 'down', 'same'])
  direction: 'up' | 'down' | 'same';

  @ApiProperty({ enum: ['better', 'worse', 'unclear'] })
  @IsIn(['better', 'worse', 'unclear'])
  interpretation: 'better' | 'worse' | 'unclear';
}

/**
 * The doctor's corrected version of the across-visits summary.
 *
 * Saving is not only an edit — it is the training signal. What the model
 * produced and what the doctor signed off are stored together, so the pair can
 * later fine-tune the model on this clinic's own judgement (see
 * ai-OPD/finetune/). An unchanged save is just as valuable: it confirms the
 * model was already right.
 */
export class UpdateProgressSummaryDto {
  @ApiProperty({ enum: ['improving', 'stable', 'worsening', 'unclear'] })
  @IsIn(['improving', 'stable', 'worsening', 'unclear'])
  status: 'improving' | 'stable' | 'worsening' | 'unclear';

  @ApiProperty() @IsString() @MaxLength(4000) summary: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  improvements?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  deteriorations?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  unchanged?: string[];

  @ApiPropertyOptional({ type: [ProgressTrendDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true })
  @Type(() => ProgressTrendDto)
  trends?: ProgressTrendDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  current_status?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  watch_points?: string[];
}
