import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ConsultationStatus, PaymentStatus } from '../../common/enums';

/** Doctor's post-checkup marking (#3). `pending` is not settable here. */
export class ConsultationDto {
  @ApiProperty({
    enum: [
      ConsultationStatus.DONE,
      ConsultationStatus.ON_HOLD,
      ConsultationStatus.REJECTED,
    ],
  })
  @IsEnum(ConsultationStatus, {
    message: 'Status must be done, on_hold, or rejected.',
  })
  status: ConsultationStatus;
}

/** Payment review (#2). `verified` keeps the slot; `rejected` frees a future slot. */
export class PaymentReviewDto {
  @ApiProperty({ enum: [PaymentStatus.VERIFIED, PaymentStatus.REJECTED] })
  @IsEnum(PaymentStatus, { message: 'Status must be verified or rejected.' })
  status: PaymentStatus;
}

/** Doctor's editable note on a visit (#, referred to on the next OPD). */
export class AppointmentNotesDto {
  @ApiProperty({
    description: "Doctor's note for this visit. Send an empty string to clear.",
    maxLength: 2000,
  })
  @IsString()
  @MaxLength(2000, { message: 'Note must be 2000 characters or fewer.' })
  notes: string;
}

export class ListAppointmentsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  doctorId?: string;

  @ApiPropertyOptional({ example: '2026-07-28' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD.' })
  date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({
    description: 'Free-text match on patient name or mobile number.',
    example: '9876543210',
  })
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    enum: ['today', 'upcoming', 'previous'],
    description:
      'Relative window (clinic timezone): today, upcoming (future) or previous (past).',
  })
  @IsOptional()
  @IsIn(['today', 'upcoming', 'previous'], {
    message: 'range must be today, upcoming or previous.',
  })
  range?: 'today' | 'upcoming' | 'previous';
}
