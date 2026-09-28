import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePlanDto {
  /** Lower-case, no spaces: it travels in the landing page's ?plan= link. */
  @ApiProperty({ example: 'half-yearly' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/, {
    message: 'Use lower-case letters, numbers and hyphens, e.g. "half-yearly".',
  })
  code: string;

  @ApiProperty({ example: 'Half-yearly' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({ example: 'Six months at a better rate.' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  tagline?: string;

  @ApiProperty({ example: 1899, description: 'Rupees per month, before GST.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter an amount in rupees, e.g. 1899.' })
  @Min(1, { message: 'The monthly amount must be at least ₹1.' })
  @Max(1_000_000)
  monthly_amount: number;

  @ApiProperty({ example: 6, description: 'Billing cycle length in months.' })
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'A cycle is at least 1 month.' })
  @Max(60)
  months: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ description: 'Highlighted as "Most popular". Only one plan at a time.' })
  @IsOptional()
  @IsBoolean()
  is_recommended?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sort_order?: number;
}

/** `code` is left out: it is what existing subscriptions were sold under. */
export class UpdatePlanDto extends PartialType(OmitType(CreatePlanDto, ['code'] as const)) {}
