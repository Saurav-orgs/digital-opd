import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  ConsultationStatus,
  NotificationType,
  ScheduleExceptionType,
} from '../common/enums';
import {
  expandDates,
  isValidDate,
  readableDate,
  to12Hour,
  toMinutes,
} from '../common/utils/clinic-time';
import { Op } from 'sequelize';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

/**
 * The consultations a leave day still has to answer for.
 *
 * A visit already seen, called off, or that nobody turned up for needs no
 * rescheduling — marking this afternoon as leave must not warn the doctor
 * about the patient they finished with at ten.
 */
const UNFINISHED = [ConsultationStatus.PENDING, ConsultationStatus.ON_HOLD];

@Injectable()
export class OpdSchedulesService {
  private readonly logger = new Logger(OpdSchedulesService.name);

  constructor(
    @InjectModel(OpdSchedule) private readonly scheduleModel: typeof OpdSchedule,
    @InjectModel(ScheduleException)
    private readonly exceptionModel: typeof ScheduleException,
    @InjectModel(Appointment) private readonly appointmentModel: typeof Appointment,
    @InjectModel(Doctor) private readonly doctorModel: typeof Doctor,
    private readonly notifications: NotificationsService,
    private readonly whatsapp: WhatsAppService,
    private readonly config: ConfigService,
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
   * Mark a date as leave. If the day already has bookings the doctor still
   * owes a consultation for, the first (unforced) call is rejected with
   * LEAVE_HAS_BOOKINGS + the booking list so the app can confirm with the
   * doctor. A forced call marks leave anyway: existing bookings stand (to be
   * rescheduled), while new bookings see the day as on-leave (SlotsService
   * treats a LEAVE exception as unavailable).
   *
   * Forcing it also tells each affected patient, because a doctor who is away
   * and a patient who still thinks they have 11:30 is exactly the wasted trip
   * this is meant to prevent.
   */
  async markLeave(doctorId: string, dto: MarkLeaveDto): Promise<ScheduleException[]> {
    const doctor = await this.assertDoctor(doctorId);
    const dates = this.leaveDates(dto.date, dto.end_date);

    const bookings = await this.unfinishedBookings(doctorId, dates);
    if (!dto.force && bookings.length > 0) {
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

    // One transaction for the span: a vacation half-marked because the
    // connection dropped on day four would be worse than not marked at all.
    const rows = await this.sequelize.transaction(async (t) => {
      const marked: ScheduleException[] = [];
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
        marked.push(record);
      }
      return marked;
    });

    // After the commit, never inside it: a patient told their visit has to
    // move, about leave that then rolled back, has been told a lie.
    if (bookings.length > 0) await this.announceLeave(doctor, bookings);
    return rows;
  }

  /**
   * The bookings on these days that still need the doctor — what the warning
   * counts and what the patients are told about.
   */
  private async unfinishedBookings(
    doctorId: string,
    dates: string[],
  ): Promise<Appointment[]> {
    return this.appointmentModel.findAll({
      where: {
        doctor_id: doctorId,
        appointment_date: dates.length === 1 ? dates[0] : { [Op.in]: dates },
        status: AppointmentStatus.CONFIRMED,
        consultation_status: { [Op.in]: UNFINISHED },
      },
      order: [
        ['appointment_date', 'ASC'],
        ['start_time', 'ASC'],
      ],
    });
  }

  /**
   * Tell every affected patient, twice over where we can.
   *
   * The in-app notification is the one that always goes out — it is the same
   * feed that already carries "Appointment rescheduled", and it needs nobody's
   * approval. WhatsApp reaches the patient who is not in the app, but only
   * through a template Meta has approved; until `WA_LEAVE_TEMPLATE_NAME` names
   * one, that half is skipped rather than failed.
   *
   * Nothing here throws. The leave is committed by the time this runs, and
   * failing the request over an undelivered message would tell the doctor
   * their vacation did not save when it did.
   */
  private async announceLeave(doctor: Doctor, bookings: Appointment[]): Promise<void> {
    const template = this.config.get<string>('whatsapp.leaveTemplate') ?? '';
    const language = this.config.get<string>('whatsapp.leaveTemplateLang') ?? 'en_US';
    const canWhatsApp = this.whatsapp.canSendNotice(template);

    for (const b of bookings) {
      const when = `${readableDate(b.appointment_date)} at ${to12Hour(b.start_time)}`;
      try {
        // One at a time, deliberately. `Promise.all` over a fortnight of
        // bookings would fire a burst of WhatsApp sends at Meta, which is what
        // its rate limiter exists to refuse — and a refused notice is worse
        // than a slow one, because nobody is waiting on this loop.
        // oxlint-disable-next-line no-await-in-loop
        await this.notifications.create(
          b.patient_mobile,
          NotificationType.DOCTOR_ON_LEAVE,
          'Your appointment needs to be moved',
          // No "Dr" prefix: the stored name usually carries its own title
          // ("Dr Meera Iyer"), and prefixing produced "Dr Dr Meera Iyer".
          // Nothing else in the system prefixes it either.
          `${doctor.name} is not available on ${readableDate(b.appointment_date)}. ` +
            `The clinic will call you to move ${b.patient_name}'s ${to12Hour(b.start_time)} appointment.`,
          {
            appointmentId: b.id,
            date: b.appointment_date,
            startTime: b.start_time,
          },
          b.doctor_id,
          b.patient_profile_id,
        );
      } catch (err) {
        this.logger.error(
          `Could not record the leave notice for appointment ${b.id}: ${(err as Error).message}`,
        );
      }

      if (!canWhatsApp) continue;
      try {
        // Sequential for the same reason as the notification above.
        // oxlint-disable-next-line no-await-in-loop
        await this.whatsapp.sendTemplate(
          b.patient_mobile,
          template,
          language,
          [b.patient_name, doctor.name, readableDate(b.appointment_date), to12Hour(b.start_time)],
          { kind: 'leave_notice', reference: `appointment:${b.id}` },
        );
      } catch (err) {
        // Already recorded in `whatsapp_messages` with Meta's own reason; this
        // line is so the leave's own log tells the same story.
        this.logger.warn(
          `Leave notice for ${b.patient_name} (${when}) was not sent on WhatsApp: ${(err as Error).message}`,
        );
      }
    }
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

  private async assertDoctor(id: string): Promise<Doctor> {
    const doctor = await this.doctorModel.findByPk(id);
    if (!doctor)
      throw new AppException(ErrorCode.NOT_FOUND, { message: 'Doctor not found.' });
    return doctor;
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
