import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { OpdSchedule } from '../database/models/opd-schedule.model';
import { ScheduleException } from '../database/models/schedule-exception.model';
import { Appointment } from '../database/models/appointment.model';
import {
  AppointmentStatus,
  ScheduleExceptionType,
} from '../common/enums';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  dayOfWeek,
  daysBetween,
  isValidDate,
  nowInClinic,
  toHHMM,
  toMinutes,
} from '../common/utils/clinic-time';

export type SlotStatus = 'available' | 'booked' | 'past';

export interface Slot {
  start_time: string; // HH:mm
  end_time: string; // HH:mm
  status: SlotStatus;
}

export interface DaySlots {
  date: string;
  available: boolean; // false when doctor is on leave / has no OPD
  reason?: 'leave' | 'no_opd' | 'out_of_window';
  slots: Slot[];
}

/** Visit length for a walk-in when the doctor has no schedule for that day. */
const DEFAULT_WALK_IN_MINUTES = 15;

interface SessionBlock {
  start: number; // minutes
  end: number; // minutes
  duration: number; // minutes
}

@Injectable()
export class SlotsService {
  private readonly tz: string;
  private readonly windowDays: number;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(OpdSchedule) private readonly scheduleModel: typeof OpdSchedule,
    @InjectModel(ScheduleException)
    private readonly exceptionModel: typeof ScheduleException,
    @InjectModel(Appointment) private readonly appointmentModel: typeof Appointment,
  ) {
    this.tz = this.config.get<string>('clinicTimezone') ?? 'Asia/Kolkata';
    this.windowDays = this.config.get<number>('bookingWindowDays') ?? 7;
  }

  /** Public slot grid for a doctor on a date. Never throws for leave/no-opd —
   *  returns a structured "not available" so the app can render it. */
  async getDaySlots(doctorId: string, date: string): Promise<DaySlots> {
    this.assertValidDate(date);
    const now = nowInClinic(this.tz);

    const windowError = this.windowReason(date, now.date);
    if (windowError) return { date, available: false, reason: windowError, slots: [] };

    const sessions = await this.resolveSessions(doctorId, date);
    if (sessions === 'leave')
      return { date, available: false, reason: 'leave', slots: [] };
    if (sessions.length === 0)
      return { date, available: false, reason: 'no_opd', slots: [] };

    const candidates = this.buildSlots(sessions);
    const booked = await this.bookedStartTimes(doctorId, date);
    const isToday = date === now.date;

    const slots: Slot[] = candidates.map((s) => {
      let status: SlotStatus = 'available';
      if (booked.has(s.start)) status = 'booked';
      else if (isToday && s.start <= now.minutes) status = 'past';
      return {
        start_time: toHHMM(s.start),
        end_time: toHHMM(s.end),
        status,
      };
    });

    return { date, available: true, slots };
  }

  /**
   * Booking-time guard: the requested slot must be a real, future, bookable
   * slot on that date. Returns the slot's end_time. Throws readable domain
   * errors otherwise. Concurrency (already-booked) is enforced by the DB.
   */
  async assertBookableSlot(
    doctorId: string,
    date: string,
    startTime: string,
    opts: { allowPast?: boolean } = {},
  ): Promise<{ endTime: string }> {
    this.assertValidDate(date);
    const now = nowInClinic(this.tz);

    const reason = this.windowReason(date, now.date);
    if (reason === 'out_of_window')
      throw new AppException(ErrorCode.DATE_OUT_OF_WINDOW);

    const sessions = await this.resolveSessions(doctorId, date);
    if (sessions === 'leave') throw new AppException(ErrorCode.DOCTOR_ON_LEAVE);
    if (sessions.length === 0) throw new AppException(ErrorCode.NO_OPD_ON_DATE);

    const start = toMinutes(startTime);
    const match = this.buildSlots(sessions).find((s) => s.start === start);
    if (!match) throw new AppException(ErrorCode.SLOT_NOT_FOUND);

    // Walk-ins (allowPast) may take the current in-progress slot.
    if (!opts.allowPast && date === now.date && start <= now.minutes) {
      throw new AppException(ErrorCode.SLOT_IN_PAST);
    }
    return { endTime: toHHMM(match.end) };
  }

  /**
   * End time for a walk-in.
   *
   * A walk-in is not booked from the grid — the patient is already in the room,
   * and the doctor decides when to see them, which is routinely outside any
   * published slot. So nothing here validates the time; it only works out how
   * long the visit should be, preferring the doctor's own configured slot
   * length for that day so a walk-in looks like every other appointment in the
   * list.
   */
  async walkInEndTime(
    doctorId: string,
    date: string,
    startTime: string,
  ): Promise<string> {
    let duration = DEFAULT_WALK_IN_MINUTES;
    try {
      const sessions = await this.resolveSessions(doctorId, date);
      if (sessions !== 'leave' && sessions.length > 0) {
        duration = sessions[0].duration || duration;
      }
    } catch {
      // No schedule for that day is normal for a walk-in; the default stands.
    }
    // Never roll past midnight into an earlier-looking end time.
    const end = Math.min(toMinutes(startTime) + duration, 23 * 60 + 59);
    return toHHMM(end);
  }

  /**
   * Given (doctorId, date) pairs, return the set of those that fall on a LEAVE
   * day, keyed as `${doctorId}|${date}`. Used to flag bookings that landed on a
   * day the doctor later marked as leave, so they can be rescheduled.
   */
  async leaveDayKeys(
    pairs: { doctorId: string; date: string }[],
  ): Promise<Set<string>> {
    const doctorIds = [...new Set(pairs.map((p) => p.doctorId))];
    const dates = [...new Set(pairs.map((p) => p.date))];
    if (doctorIds.length === 0 || dates.length === 0) return new Set();

    const rows = await this.exceptionModel.findAll({
      where: {
        doctor_id: { [Op.in]: doctorIds },
        date: { [Op.in]: dates },
        type: ScheduleExceptionType.LEAVE,
      },
      attributes: ['doctor_id', 'date'],
    });
    return new Set(rows.map((r) => `${r.doctor_id}|${r.date}`));
  }

  // ── internals ──────────────────────────────────────────────

  private assertValidDate(date: string): void {
    if (!isValidDate(date)) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'Please provide a valid date (YYYY-MM-DD).',
      });
    }
  }

  private windowReason(
    date: string,
    today: string,
  ): 'out_of_window' | null {
    const diff = daysBetween(today, date);
    if (diff < 0 || diff > this.windowDays) return 'out_of_window';
    return null;
  }

  /**
   * Resolve the day's session blocks. A `custom` exception overrides the
   * weekly config for that date; a `leave` exception blocks the day entirely.
   * Otherwise all active opd_schedules rows for the weekday are used (there may
   * be several — split sessions).
   */
  private async resolveSessions(
    doctorId: string,
    date: string,
  ): Promise<SessionBlock[] | 'leave'> {
    const exception = await this.exceptionModel.findOne({
      where: { doctor_id: doctorId, date },
    });

    if (exception?.type === ScheduleExceptionType.LEAVE) return 'leave';

    if (
      exception?.type === ScheduleExceptionType.CUSTOM &&
      exception.start_time &&
      exception.end_time &&
      exception.slot_duration_min
    ) {
      return [
        {
          start: toMinutes(exception.start_time),
          end: toMinutes(exception.end_time),
          duration: exception.slot_duration_min,
        },
      ];
    }

    const rows = await this.scheduleModel.findAll({
      where: {
        doctor_id: doctorId,
        day_of_week: dayOfWeek(date),
        is_active: true,
      },
    });
    return rows.map((r) => ({
      start: toMinutes(r.start_time),
      end: toMinutes(r.end_time),
      duration: r.slot_duration_min,
    }));
  }

  /** Generate + union + sort candidate slots across all session blocks. */
  private buildSlots(sessions: SessionBlock[]): { start: number; end: number }[] {
    const out: { start: number; end: number }[] = [];
    const seen = new Set<number>();
    for (const s of sessions) {
      if (s.duration <= 0 || s.end <= s.start) continue;
      for (let t = s.start; t + s.duration <= s.end; t += s.duration) {
        if (seen.has(t)) continue; // de-dupe overlapping session starts
        seen.add(t);
        out.push({ start: t, end: t + s.duration });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  private async bookedStartTimes(
    doctorId: string,
    date: string,
  ): Promise<Set<number>> {
    const rows = await this.appointmentModel.findAll({
      where: {
        doctor_id: doctorId,
        appointment_date: date,
        status: AppointmentStatus.CONFIRMED,
      },
      attributes: ['start_time'],
    });
    return new Set(rows.map((r) => toMinutes(r.start_time)));
  }
}
