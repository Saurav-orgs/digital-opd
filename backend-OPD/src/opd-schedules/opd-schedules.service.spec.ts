import { ConfigService } from '@nestjs/config';
import { Op } from 'sequelize';
import { OpdSchedulesService } from './opd-schedules.service';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  AppointmentStatus,
  ConsultationStatus,
  NotificationType,
} from '../common/enums';

/**
 * Marking a vacation over a day that is already booked.
 *
 * Two rules the client asked for: the doctor is never *stopped* from going on
 * leave, and nobody — doctor or patient — is left thinking an appointment is
 * still happening. Models are mocked so the rules are exercised on their own.
 */
/** One confirmed booking, pending consultation unless told otherwise. */
const booking = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'appt-1',
  doctor_id: 'doc-1',
  appointment_date: '2026-11-03',
  start_time: '11:30',
  end_time: '11:45',
  patient_name: 'Asha Verma',
  patient_mobile: '9876543210',
  patient_profile_id: 'profile-1',
  ...over,
});

function build(opts: { bookings?: unknown[]; leaveTemplate?: string } = {}) {
  const appointmentModel = {
    findAll: jest.fn().mockResolvedValue(opts.bookings ?? []),
  };
  const exceptionModel = {
    upsert: jest.fn().mockImplementation(async (row: unknown) => [row]),
  };
  const notifications = { create: jest.fn().mockResolvedValue(undefined) };
  const whatsapp = {
    canSendNotice: (t: string) => !!t,
    sendTemplate: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: (key: string) =>
      key === 'whatsapp.leaveTemplate'
        ? (opts.leaveTemplate ?? '')
        : key === 'whatsapp.leaveTemplateLang'
          ? 'en_US'
          : undefined,
  } as unknown as ConfigService;
  const service = new OpdSchedulesService(
    { findAll: jest.fn() } as any,
    exceptionModel as any,
    appointmentModel as any,
    { findByPk: jest.fn().mockResolvedValue({ id: 'doc-1', name: 'Asha' }) } as any,
    notifications as any,
    whatsapp as any,
    config,
    // The span is marked in one transaction; here it just runs the callback.
    { transaction: (fn: (t: unknown) => unknown) => fn(undefined) } as any,
  );
  return { service, appointmentModel, exceptionModel, notifications, whatsapp };
}

const mark = (service: OpdSchedulesService, force?: boolean) =>
  service.markLeave('doc-1', { date: '2026-11-03', ...(force ? { force } : {}) });


describe('OpdSchedulesService — leave over bookings', () => {
  it('refuses the first time, and hands back what clashes', async () => {
    const { service, exceptionModel } = build({ bookings: [booking()] });
    const err = await mark(service).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe(ErrorCode.LEAVE_HAS_BOOKINGS);
    expect((err as AppException).details).toEqual([
      expect.objectContaining({ id: 'appt-1', start_time: '11:30', patient_name: 'Asha Verma' }),
    ]);
    // Nothing was written: the doctor has not answered yet.
    expect(exceptionModel.upsert).not.toHaveBeenCalled();
  });

  it('counts only the visits the doctor still owes, not the finished ones', async () => {
    const { service, appointmentModel } = build();
    await mark(service);
    expect(appointmentModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: AppointmentStatus.CONFIRMED,
          consultation_status: {
            [Op.in]: [ConsultationStatus.PENDING, ConsultationStatus.ON_HOLD],
          },
        }),
      }),
    );
  });

  it('marks the leave anyway when forced', async () => {
    const { service, exceptionModel } = build({ bookings: [booking()] });
    await expect(mark(service, true)).resolves.toHaveLength(1);
    expect(exceptionModel.upsert).toHaveBeenCalledTimes(1);
  });

  it('tells each affected patient in the app', async () => {
    const { service, notifications } = build({ bookings: [booking()] });
    await mark(service, true);
    expect(notifications.create).toHaveBeenCalledTimes(1);
    const [mobile, type, title, body] = notifications.create.mock.calls[0];
    expect(mobile).toBe('9876543210');
    expect(type).toBe(NotificationType.DOCTOR_ON_LEAVE);
    expect(title).toMatch(/moved/i);
    expect(body).toContain('Asha');
  });

  it('says nothing to anyone when the day was free', async () => {
    const { service, notifications, whatsapp } = build({ leaveTemplate: 'leave_notice' });
    await mark(service);
    expect(notifications.create).not.toHaveBeenCalled();
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
  });

  it('skips WhatsApp while no approved template is configured', async () => {
    const { service, whatsapp, notifications } = build({ bookings: [booking()] });
    await mark(service, true);
    expect(whatsapp.sendTemplate).not.toHaveBeenCalled();
    // …but the patient is still told, through the feed that needs no approval.
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('sends the WhatsApp notice once a template is configured', async () => {
    const { service, whatsapp } = build({
      bookings: [booking()],
      leaveTemplate: 'leave_notice',
    });
    await mark(service, true);
    expect(whatsapp.sendTemplate).toHaveBeenCalledWith(
      '9876543210',
      'leave_notice',
      'en_US',
      ['Asha Verma', 'Asha', expect.any(String), expect.any(String)],
      expect.objectContaining({ kind: 'leave_notice' }),
    );
  });

  it('keeps the leave when a message cannot be sent — it is already saved', async () => {
    const { service, whatsapp, notifications } = build({
      bookings: [booking()],
      leaveTemplate: 'leave_notice',
    });
    notifications.create.mockRejectedValueOnce(new Error('db is down'));
    whatsapp.sendTemplate.mockRejectedValueOnce(new Error('Meta said no'));
    await expect(mark(service, true)).resolves.toHaveLength(1);
  });
});
