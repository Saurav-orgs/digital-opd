import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { OpdSchedule } from '../database/models/opd-schedule.model';
import { ScheduleException } from '../database/models/schedule-exception.model';
import { Appointment } from '../database/models/appointment.model';
import { Doctor } from '../database/models/doctor.model';
import {
  MarkLeaveDto,
  ReplaceSchedulesDto,
  ScheduleEntryDto,
} from './dto/schedule.dto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  AppointmentStatus,
  ScheduleExceptionType,
} from '../common/enums';
import { expandDates, isValidDate, toMinutes } from '../common/utils/clinic-time';
import { Op } from 'sequelize';

@Injectable()
export class OpdSchedulesService {
  constructor(
    @InjectModel(OpdSchedule) private readonly scheduleModel: typeof OpdSchedule,
    @InjectModel(ScheduleException)
    private readonly exceptionModel: typeof ScheduleException,
    @InjectModel(Appointment) private readonly appointmentModel: typeof Appointment,
    @InjectModel(Doctor) private readonly doctorModel: typeof Doctor,
    private readonly sequelize: Sequelize,
  ) {}

  async list(doctorId: string): Promise<OpdSchedule[]> {
    await this.assertDoctor(doctorId);
    return this.scheduleModel.findAll({
      where: { doctor_id: doctorId },
      order: [
        ['day_of_week', 'ASC'],
        ['start_time', 'ASC'],
      ],
    });
  }

  /** Replace the full weekly config. Validates per-day sessions don't overlap. */
  async replace(
    doctorId: string,
    dto: ReplaceSchedulesDto,
  ): Promise<OpdSchedule[]> {
    await this.assertDoctor(doctorId);
    this.assertNoOverlap(dto.entries);

    await this.sequelize.transaction(async (t) => {
      await this.scheduleModel.destroy({
        where: { doctor_id: doctorId },
        transaction: t,
      });
      if (dto.entries.length) {
        await this.scheduleModel.bulkCreate(
          dto.entries.map((e) => ({
            doctor_id: doctorId,
            day_of_week: e.day_of_week,
            start_time: e.start_time,
            end_time: e.end_time,
            slot_duration_min: e.slot_duration_min,
            is_active: e.is_active ?? true,
          })) as any,
          { transaction: t },
        );
      }
    });
    return this.list(doctorId);
  }

  /** Upcoming leave days for a doctor (today onward), for the schedule UI. */
  async listLeave(doctorId: string): Promise<ScheduleException[]> {
    await this.assertDoctor(doctorId);
    return this.exceptionModel.findAll({
      where: { doctor_id: doctorId, type: ScheduleExceptionType.LEAVE },
      order: [['date', 'ASC']],
    });
  }

  /**
   * Mark a date as leave. If the day already has confirmed bookings, the first
   * (unforced) call is rejected with LEAVE_HAS_BOOKINGS + the booking list so
   * the app can confirm with the doctor. A forced call marks leave anyway:
   * existing bookings stand (to be rescheduled), while new bookings see the day
   * as on-leave (SlotsService treats a LEAVE exception as unavailable).
   */
  async markLeave(doctorId: string, dto: MarkLeaveDto): Promise<ScheduleException[]> {
    await this.assertDoctor(doctorId);
    const dates = this.leaveDates(dto.date, dto.end_date);

    if (!dto.force) {
      const bookings = await this.appointmentModel.findAll({
        where: {
          doctor_id: doctorId,
          appointment_date: dates.length === 1 ? dates[0] : { [Op.in]: dates },
          status: AppointmentStatus.CONFIRMED,
        },
        order: [
          ['appointment_date', 'ASC'],
          ['start_time', 'ASC'],
        ],
      });
      if (bookings.length > 0) {
        throw new AppException(ErrorCode.LEAVE_HAS_BOOKINGS, {
          details: bookings.map((b) => ({
            id: b.id,
            appointment_date: b.appointment_date,
            start_time: b.start_time,
            end_time: b.end_time,
            patient_name: b.patient_name,
            patient_mobile: b.patient_mobile,
          })),
        });
      }
    }

    // One transaction for the span: a vacation half-marked because the
    // connection dropped on day four would be worse than not marked at all.
    return this.sequelize.transaction(async (t) => {
      const rows: ScheduleException[] = [];
      for (const date of dates) {
        const [record] = await this.exceptionModel.upsert(
          {
            doctor_id: doctorId,
            date,
            type: ScheduleExceptionType.LEAVE,
            start_time: null,
            end_time: null,
            slot_duration_min: null,
            reason: dto.reason ?? null,
          } as any,
          { transaction: t },
        );
        rows.push(record);
      }
      return rows;
    });
  }

  /** Remove leave on one date, or on every date from `date` to `to` inclusive. */
  async removeLeave(doctorId: string, date: string, to?: string): Promise<void> {
    await this.assertDoctor(doctorId);
    const dates = this.leaveDates(date, to);
    const deleted = await this.exceptionModel.destroy({
      where: {
        doctor_id: doctorId,
        date: dates.length === 1 ? dates[0] : { [Op.in]: dates },
        type: ScheduleExceptionType.LEAVE,
      },
    });
    if (!deleted) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: to ? 'No leave found in these dates.' : 'No leave found for this date.',
      });
    }
  }

  /** The dates a leave call names — a single day, or an inclusive span. */
  private leaveDates(date: string, end?: string): string[] {
    if (!isValidDate(date) || (end && !isValidDate(end))) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'Please choose a valid date.',
      });
    }
    if (!end || end === date) return [date];
    if (end < date) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'Leave cannot end before it starts.',
      });
    }
    return expandDates(date, end);
  }

  // ── helpers ────────────────────────────────────────────────

  private async assertDoctor(id: string): Promise<void> {
    const doctor = await this.doctorModel.findByPk(id);
    if (!doctor)
      throw new AppException(ErrorCode.NOT_FOUND, { message: 'Doctor not found.' });
  }

  /** Within each weekday, sessions must not overlap and must be well-formed. */
  private assertNoOverlap(entries: ScheduleEntryDto[]): void {
    const byDay = new Map<number, { start: number; end: number }[]>();
    for (const e of entries) {
      const start = toMinutes(e.start_time);
      const end = toMinutes(e.end_time);
      if (end <= start) {
        throw new AppException(ErrorCode.BAD_REQUEST, {
          message: `End time must be after start time (day ${e.day_of_week}).`,
        });
      }
      const list = byDay.get(e.day_of_week) ?? [];
      list.push({ start, end });
      byDay.set(e.day_of_week, list);
    }
    for (const list of byDay.values()) {
      list.sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i++) {
        if (list[i].start < list[i - 1].end) {
          throw new AppException(ErrorCode.SCHEDULE_OVERLAP);
        }
      }
    }
  }
}
