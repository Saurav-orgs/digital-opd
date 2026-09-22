import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { PaymentEventSource } from '../../common/enums';

export class QueryPaymentEventsDto {
  @ApiPropertyOptional({ enum: PaymentEventSource })
  @IsOptional()
  @IsEnum(PaymentEventSource)
  source?: PaymentEventSource;

  /** Ignored for a doctor: their own clinic is the only scope they have. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  doctor_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subscription_id?: string;

  @ApiPropertyOptional({ description: "Cashfree's order id, to trace one payment." })
  @IsOptional()
  @IsString()
  cf_order_id?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
