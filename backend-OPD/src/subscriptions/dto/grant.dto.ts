import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** Super admin gives an account a plan without a payment. */
export class GrantSubscriptionDto {
  @ApiProperty({ description: 'The doctor account receiving the plan.' })
  @IsUUID('4', { message: 'Please choose a doctor account.' })
  user_id: string;

  @ApiProperty({ description: "The plan's id. It may be an inactive plan." })
  @IsUUID('4', { message: 'Please choose a plan.' })
  plan_id: string;

  @ApiPropertyOptional({
    description: "How many months to give. Defaults to the plan's own cycle.",
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Grant at least 1 month.' })
  @Max(60)
  months?: number;

  @ApiPropertyOptional({ example: 'Free trial agreed on the call.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional({ example: 'Refunded outside the platform.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
