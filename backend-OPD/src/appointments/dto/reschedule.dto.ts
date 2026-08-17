import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

/** Move a confirmed appointment to another available slot (same doctor). */
export class RescheduleDto {
  @ApiProperty({ example: '2026-07-29' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Please choose a valid date (YYYY-MM-DD).',
  })
  appointment_date: string;

  @ApiProperty({ example: '12:00' })
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Please choose a valid time slot (HH:mm).',
  })
  start_time: string;
}
