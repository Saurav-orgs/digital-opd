import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class ScheduleEntryDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0=Sun … 6=Sat' })
  @IsInt()
  @Min(0, { message: 'Day of week must be 0–6.' })
  @Max(6, { message: 'Day of week must be 0–6.' })
  day_of_week: number;

  @ApiProperty({ example: '11:00' })
  @Matches(TIME_RE, { message: 'start_time must be HH:mm (24h).' })
  start_time: string;

  @ApiProperty({ example: '14:00' })
  @Matches(TIME_RE, { message: 'end_time must be HH:mm (24h).' })
  end_time: string;

  @ApiProperty({ example: 10, minimum: 1 })
  @IsInt()
  @Min(1, { message: 'Slot duration must be at least 1 minute.' })
  @Max(240)
  slot_duration_min: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class ReplaceSchedulesDto {
  @ApiProperty({
    type: [ScheduleEntryDto],
    description:
      'Full weekly config. A weekday may appear multiple times (split sessions).',
  })
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => ScheduleEntryDto)
  entries: ScheduleEntryDto[];
}

export class MarkLeaveDto {
  @ApiProperty({ example: '2026-07-28' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD.' })
  date: string;

  @ApiPropertyOptional({ example: 'On conference leave' })
  @IsOptional()
  @IsString()
  reason?: string;

  /**
   * Mark leave even if the day already has confirmed bookings. Existing
   * bookings stand (the doctor reschedules them); new bookings see the day as
   * on-leave. Defaults to false so the app can first confirm with the doctor.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
