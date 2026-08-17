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
import { toMinutes } from '../common/utils/clinic-time';

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
  async markLeave(doctorId: string, dto: MarkLeaveDto): Promise<ScheduleException> {
    await this.assertDoctor(doctorId);

    if (!dto.force) {
      const bookings = await this.appointmentModel.findAll({
        where: {
          doctor_id: doctorId,
          appointment_date: dto.date,
          status: AppointmentStatus.CONFIRMED,
        },
        order: [['start_time', 'ASC']],
      });
      if (bookings.length > 0) {
        throw new AppException(ErrorCode.LEAVE_HAS_BOOKINGS, {
          details: bookings.map((b) => ({
            id: b.id,
            start_time: b.start_time,
            end_time: b.end_time,
            patient_name: b.patient_name,
            patient_mobile: b.patient_mobile,
          })),
        });
      }
    }

    const [record] = await this.exceptionModel.upsert(
      {
        doctor_id: doctorId,
        date: dto.date,
        type: ScheduleExceptionType.LEAVE,
        start_time: null,
        end_time: null,
        slot_duration_min: null,
        reason: dto.reason ?? null,
      } as any,
    );
    return record;
  }

  async removeLeave(doctorId: string, date: string): Promise<void> {
    await this.assertDoctor(doctorId);
    const deleted = await this.exceptionModel.destroy({
      where: {
        doctor_id: doctorId,
        date,
        type: ScheduleExceptionType.LEAVE,
      },
    });
    if (!deleted) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'No leave found for this date.',
      });
    }
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
