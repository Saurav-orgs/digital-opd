import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { literal, Op, UniqueConstraintError } from 'sequelize';
import { ConfigService } from '@nestjs/config';
import { Appointment } from '../database/models/appointment.model';
import { AppointmentPrescription } from '../database/models/prescription.model';
import { PatientReport } from '../database/models/patient-report.model';
import { Doctor } from '../database/models/doctor.model';
import { SlotsService } from '../slots/slots.service';
import { StorageService } from '../uploads/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrescriptionsService } from '../prescriptions/prescriptions.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { WalkInAppointmentDto } from './dto/walkin-appointment.dto';
import { RescheduleDto } from './dto/reschedule.dto';
import { ReminderDto } from './dto/reminder.dto';
import {
  AppointmentNotesDto,
  ConsultationDto,
  ListAppointmentsQueryDto,
} from './dto/manage-appointment.dto';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  AppointmentStatus,
  BookingSource,
  ConsultationStatus,
  NotificationType,
} from '../common/enums';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { nowInClinic } from '../common/utils/clinic-time';

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectModel(Appointment) private readonly appointmentModel: typeof Appointment,
    @InjectModel(AppointmentPrescription)
    private readonly prescriptionModel: typeof AppointmentPrescription,
    @InjectModel(PatientReport) private readonly reportModel: typeof PatientReport,
    @InjectModel(Doctor) private readonly doctorModel: typeof Doctor,
    private readonly slots: SlotsService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly prescriptions: PrescriptionsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Guest booking (plan §6). Concurrency-safe via partial unique index.
   * Payment happens in person at the clinic, so booking carries no screenshot
   * or payment state — a booked slot is simply `confirmed`.
   */
  async book(
    dto: CreateAppointmentDto,
    source: BookingSource,
  ): Promise<Appointment> {
    const doctor = await this.doctorModel.findByPk(dto.doctor_id);
    if (!doctor || !doctor.is_enabled) {
      throw new AppException(ErrorCode.DOCTOR_DISABLED);
    }

    // Validate slot (window / past / leave / exists) → derive end_time.
    const { endTime } = await this.slots.assertBookableSlot(
      dto.doctor_id,
      dto.appointment_date,
      dto.start_time,
    );

    // Fail fast on an obviously-taken slot before attempting the insert.
    await this.assertSlotFree(dto.doctor_id, dto.appointment_date, dto.start_time);

    try {
      const appointment = await this.appointmentModel.create({
        doctor_id: dto.doctor_id,
        appointment_date: dto.appointment_date,
        start_time: dto.start_time,
        end_time: endTime,
        patient_name: dto.patient_name,
        patient_mobile: dto.patient_mobile,
        patient_gender: dto.patient_gender,
        patient_age: dto.patient_age,
        patient_address: dto.patient_address ?? null,
        description: dto.description ?? null,
        status: AppointmentStatus.CONFIRMED,
        consultation_status: ConsultationStatus.PENDING,
        source,
      } as any);
      return this.withDoctor(appointment.id);
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        throw new AppException(ErrorCode.SLOT_ALREADY_BOOKED);
      }
      throw err;
    }
  }

  /**
   * In-clinic walk-in booking. Every admin account — the doctor and the staff
   * they add — is linked to the clinic's doctor profile, so the booking is
   * forced to that doctor and `dto.doctor_id` is only a fallback for an
   * unlinked account. Concurrency is enforced by the same partial unique index
   * as guest bookings.
   */
  async bookWalkIn(
    dto: WalkInAppointmentDto,
    user: AuthUser,
  ): Promise<Appointment> {
    const doctorId = user.doctorId ?? dto.doctor_id;
    if (!doctorId) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'A doctor is required for a walk-in booking.',
      });
    }

    const doctor = await this.doctorModel.findByPk(doctorId);
    if (!doctor || !doctor.is_enabled) {
      throw new AppException(ErrorCode.DOCTOR_DISABLED);
    }

    // Walk-ins may take the current in-progress slot (allowPast).
    const { endTime } = await this.slots.assertBookableSlot(
      doctorId,
      dto.appointment_date,
      dto.start_time,
      { allowPast: true },
    );
    await this.assertSlotFree(doctorId, dto.appointment_date, dto.start_time);

    try {
      const appointment = await this.appointmentModel.create(
        {
          doctor_id: doctorId,
          appointment_date: dto.appointment_date,
          start_time: dto.start_time,
          end_time: endTime,
          patient_name: dto.patient_name,
          patient_mobile: dto.patient_mobile,
          patient_gender: dto.patient_gender,
          patient_age: dto.patient_age,
          patient_address: dto.patient_address ?? null,
          description: dto.description ?? null,
          status: AppointmentStatus.CONFIRMED,
          consultation_status: ConsultationStatus.PENDING,
          source: BookingSource.WALK_IN,
        } as any,
      );
      return this.withDoctor(appointment.id);
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        throw new AppException(ErrorCode.SLOT_ALREADY_BOOKED);
      }
      throw err;
    }
  }

  async list(
    query: ListAppointmentsQueryDto,
    user: AuthUser,
  ): Promise<Record<string, any>[]> {
    const where: any = {};
    // Tenant scope: every clinical user (doctor + staff) has a doctorId and
    // sees only their tenant's appointments. Super admin has doctorId=null and
    // returns nothing on clinical routes.
    if (user.doctorId) {
      where.doctor_id = user.doctorId;
    } else {
      return []; // super admin has no clinical scope
    }
    if (query.date) where.appointment_date = query.date;
    // Relative window (clinic timezone) for the dashboard tabs.
    if (query.range) {
      const today = nowInClinic(
        this.config.get<string>('clinicTimezone') ?? 'Asia/Kolkata',
      ).date;
      if (query.range === 'today') where.appointment_date = today;
      else if (query.range === 'upcoming')
        where.appointment_date = { [Op.gt]: today };
      else if (query.range === 'previous')
        where.appointment_date = { [Op.lt]: today };
    }
    if (query.status) where.status = query.status;

    // Free-text search: match patient name or mobile (case-insensitive).
    const search = query.search?.trim();
    if (search) {
      const like = `%${search}%`;
      where[Op.or] = [
        { patient_name: { [Op.iLike]: like } },
        { patient_mobile: { [Op.iLike]: like } },
      ];
    }

    // Today: still-pending consultations first (in booking order), done last.
    // Upcoming reads soonest-first; previous (and default) newest-first.
    const dateDir = query.range === 'upcoming' ? 'ASC' : 'DESC';
    const order: any[] =
      query.range === 'today'
        ? [
            [
              literal(
                `CASE WHEN consultation_status = 'done' THEN 1 ELSE 0 END`,
              ),
              'ASC',
            ],
            ['start_time', 'ASC'],
          ]
        : [
            ['appointment_date', dateDir],
            ['start_time', 'ASC'],
          ];
    const rows = await this.appointmentModel.findAll({
      where,
      include: [{ model: Doctor, attributes: ['id', 'name', 'specialization'] }],
      order,
    });

    // Flag bookings that landed on a day the doctor later marked as leave, so
    // the dashboard can surface them for rescheduling.
    const leaveKeys = await this.slots.leaveDayKeys(
      rows.map((r) => ({ doctorId: r.doctor_id, date: r.appointment_date })),
    );
    return rows.map((r) => ({
      ...r.toJSON(),
      on_leave: leaveKeys.has(`${r.doctor_id}|${r.appointment_date}`),
    }));
  }

  async findOne(id: string, user: AuthUser) {
    const appointment = await this.withDoctor(id, true);
    this.assertOwnership(appointment, user);
    const prescriptions = await this.presignPrescriptions(appointment);
    const reports = await this.reportsForAppointment(id);
    return {
      ...appointment.toJSON(),
      prescriptions,
      reports,
      // Combined AI summary across all of this visit's reports (fields already
      // on the appointment row via toJSON: reports_summary / _status / _error /
      // _count).
      e_prescription: await this.prescriptions.findIssuedForAppointment(id),
    };
  }

  /**
   * Move a confirmed appointment to another bookable slot (same doctor). The
   * partial unique index guards against double-booking the target slot.
   */
  async reschedule(
    id: string,
    dto: RescheduleDto,
    user: AuthUser,
  ): Promise<Appointment> {
    const appointment = await this.findRaw(id);
    this.assertOwnership(appointment, user);
    if (appointment.status === AppointmentStatus.REJECTED) {
      throw new AppException(ErrorCode.BAD_REQUEST, {
        message: 'A rejected appointment cannot be rescheduled.',
      });
    }

    const { endTime } = await this.slots.assertBookableSlot(
      appointment.doctor_id,
      dto.appointment_date,
      dto.start_time,
    );
    // Free unless it's the slot this appointment already holds.
    const unchanged =
      appointment.appointment_date === dto.appointment_date &&
      appointment.start_time.slice(0, 5) === dto.start_time;
    if (!unchanged) {
      await this.assertSlotFree(
        appointment.doctor_id,
        dto.appointment_date,
        dto.start_time,
      );
    }

    try {
      await appointment.update({
        appointment_date: dto.appointment_date,
        start_time: dto.start_time,
        end_time: endTime,
      } as any);
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        throw new AppException(ErrorCode.SLOT_ALREADY_BOOKED);
      }
      throw err;
    }
    return this.withDoctor(id);
  }

  /** Doctor uploads one or more prescription images against a visit. */
  async addPrescriptions(
    id: string,
    files: Express.Multer.File[],
    user: AuthUser,
  ) {
    const appointment = await this.findRaw(id);
    this.assertOwnership(appointment, user);
    if (!files || files.length === 0) {
      throw new AppException(ErrorCode.FILE_REQUIRED);
    }
    files.forEach((f) => this.storage.validateImage(f));

    const keys: string[] = [];
    try {
      for (const file of files) {
        const { key } = await this.storage.uploadImage(
          file,
          `prescriptions/${appointment.doctor_id}`,
        );
        keys.push(key);
        await this.prescriptionModel.create({
          appointment_id: id,
          image_key: key,
        } as any);
      }
    } catch (err) {
      // Roll back any objects uploaded in this call on partial failure.
      await Promise.all(keys.map((k) => this.storage.delete(k)));
      throw err;
    }
    return this.findOne(id, user);
  }

  /** Remove a single prescription image (object + row). */
  async deletePrescription(id: string, prescriptionId: string, user: AuthUser) {
    const appointment = await this.findRaw(id);
    this.assertOwnership(appointment, user);
    const row = await this.prescriptionModel.findOne({
      where: { id: prescriptionId, appointment_id: id },
    });
    if (!row) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Prescription not found.',
      });
    }
    await this.storage.delete(row.image_key);
    await row.destroy();
    return this.findOne(id, user);
  }

  /**
   * Prior visits for a patient (matched by mobile, doctor-scoped), each with
   * the doctor's note + presigned prescription images. Referred to on the
   * patient's next OPD.
   */
  async history(mobile: string, user: AuthUser, excludeId?: string) {
    const doctorId = user.doctorId ?? undefined;
    if (!doctorId) return []; // super admin has no clinical scope

    // "Previous visits" means earlier than the visit being viewed — not merely
    // "every other visit". Anchor on the reference appointment's date/time so a
    // newer appointment never shows up under an older one's history.
    let before: { date: string; startTime: string } | undefined;
    if (excludeId) {
      const ref = await this.appointmentModel.findByPk(excludeId);
      if (ref) {
        before = { date: ref.appointment_date, startTime: ref.start_time };
      }
    }
    return this.visitsForMobile(mobile, {
      doctorId: doctorId ?? undefined,
      before,
    });
  }

  /** All visits for a patient's mobile, unscoped — used by the patient portal. */
  async patientVisits(mobile: string, doctorId?: string | null) {
    return this.visitsForMobile(mobile, doctorId ? { doctorId } : {});
  }

  private async visitsForMobile(
    mobile: string,
    opts: {
      doctorId?: string;
      before?: { date: string; startTime: string };
    } = {},
  ) {
    const where: any = { patient_mobile: mobile };
    if (opts.doctorId) where.doctor_id = opts.doctorId;
    // Strictly earlier than the reference visit: an earlier date, or the same
    // date at an earlier start time. This also excludes the reference visit
    // itself (same date + same time is not "before").
    if (opts.before) {
      where[Op.or] = [
        { appointment_date: { [Op.lt]: opts.before.date } },
        {
          appointment_date: opts.before.date,
          start_time: { [Op.lt]: opts.before.startTime },
        },
      ];
    }

    const rows = await this.appointmentModel.findAll({
      where,
      include: [
        { model: Doctor, attributes: ['id', 'name', 'specialization'] },
        { model: AppointmentPrescription },
      ],
      order: [
        ['appointment_date', 'DESC'],
        ['start_time', 'DESC'],
      ],
    });

    return Promise.all(
      rows.map(async (a) => ({
        ...a.toJSON(),
        accepts_reports: AppointmentsService.acceptsReports(a),
        prescriptions: await this.presignPrescriptions(a),
        reports: await this.reportsForAppointment(a.id),
        // Null until the doctor issues it — a draft is never patient-visible.
        e_prescription: await this.prescriptions.findIssuedForAppointment(a.id),
      })),
    );
  }

  /**
   * Whether a patient may still upload reports to this visit. Allowed until the
   * doctor closes it out — i.e. while pending or on_hold, but not once the OPD
   * is marked done (or the booking was rejected).
   */
  static acceptsReports(appointment: Appointment): boolean {
    return (
      appointment.consultation_status === ConsultationStatus.PENDING ||
      appointment.consultation_status === ConsultationStatus.ON_HOLD
    );
  }

  async setConsultation(
    id: string,
    dto: ConsultationDto,
    user: AuthUser,
  ): Promise<Appointment> {
    const appointment = await this.findRaw(id);
    this.assertOwnership(appointment, user);
    await appointment.update({ consultation_status: dto.status } as any);
    return this.withDoctor(id);
  }

  /** Save the doctor's free-text note for a visit (empty string clears it). */
  async setNotes(
    id: string,
    dto: AppointmentNotesDto,
    user: AuthUser,
  ): Promise<Appointment> {
    const appointment = await this.findRaw(id);
    this.assertOwnership(appointment, user);
    const notes = dto.notes.trim();
    await appointment.update({ doctor_notes: notes || null } as any);
    return this.withDoctor(id);
  }

  /**
   * Doctor sets a reminder for the patient's next visit; the patient gets an
   * in-app notification. Recorded on the visit itself, not a new appointment
   * — the patient still books the actual follow-up normally.
   */
  async addReminder(
    id: string,
    dto: ReminderDto,
    user: AuthUser,
  ): Promise<Appointment> {
    const appointment = await this.findRaw(id);
    this.assertOwnership(appointment, user);
    await appointment.update({
      next_visit_note: dto.message.trim(),
      next_visit_date: dto.suggested_date ?? null,
    } as any);

    const body = dto.suggested_date
      ? `${dto.message.trim()} (suggested: ${dto.suggested_date})`
      : dto.message.trim();
    await this.notifications.create(
      appointment.patient_mobile,
      NotificationType.APPOINTMENT_REMINDER,
      'Reminder for your next visit',
      body,
      { appointmentId: appointment.id, suggestedDate: dto.suggested_date ?? null },
      appointment.doctor_id,
    );

    return this.withDoctor(id);
  }

  // ── helpers ────────────────────────────────────────────────

  private async assertSlotFree(
    doctorId: string,
    date: string,
    startTime: string,
  ): Promise<void> {
    const existing = await this.appointmentModel.findOne({
      where: {
        doctor_id: doctorId,
        appointment_date: date,
        start_time: startTime,
        status: AppointmentStatus.CONFIRMED,
      },
    });
    if (existing) throw new AppException(ErrorCode.SLOT_ALREADY_BOOKED);
  }

  /** Reports (pathlab or patient self-uploaded) attached to this appointment. */
  private async reportsForAppointment(appointmentId: string) {
    const rows = await this.reportModel.findAll({
      where: { appointment_id: appointmentId },
      order: [['created_at', 'DESC']],
    });
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        title: r.title,
        url: await this.storage.presignedGetUrl(r.file_key),
        createdAt: r.get('createdAt'),
        // AI summary rides along so the doctor can read the gist without
        // opening each file; status lets the UI show progress or a failure.
        ai_summary: r.ai_summary,
        ai_summary_status: r.ai_summary_status,
        ai_summary_error: r.ai_summary_error,
      })),
    );
  }

  private async findRaw(id: string): Promise<Appointment> {
    const appointment = await this.appointmentModel.findByPk(id);
    if (!appointment) {
      throw new AppException(ErrorCode.NOT_FOUND, {
        message: 'Appointment not found.',
      });
    }
    return appointment;
  }

  private async withDoctor(
    id: string,
    withPrescriptions = false,
  ): Promise<Appointment> {
    return (await this.appointmentModel.findByPk(id, {
      include: [
        {
          model: Doctor,
          attributes: ['id', 'name', 'specialization', 'consultation_fee'],
        },
        ...(withPrescriptions ? [{ model: AppointmentPrescription }] : []),
      ],
    })) as Appointment;
  }

  /** Map an appointment's prescription rows to {id, url} with presigned URLs. */
  private async presignPrescriptions(
    appointment: Appointment,
  ): Promise<{ id: string; url: string | null }[]> {
    const rows = appointment.prescriptions ?? [];
    return Promise.all(
      rows.map(async (p) => ({
        id: p.id,
        url: await this.storage.presignedGetUrl(p.image_key),
      })),
    );
  }

  private assertOwnership(appointment: Appointment, user: AuthUser): void {
    // All clinical users (doctor + staff) have doctorId; they are scoped to
    // their tenant. Super admin (doctorId=null) is not a clinical user and
    // should not reach this path, but we block them anyway.
    if (!user.doctorId || appointment.doctor_id !== user.doctorId) {
      throw new AppException(ErrorCode.FORBIDDEN, {
        message: 'You can only access your own appointments.',
      });
    }
  }
}
