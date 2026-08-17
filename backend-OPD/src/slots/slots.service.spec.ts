import { ConfigService } from '@nestjs/config';
import { SlotsService } from './slots.service';
import { dayOfWeek, toHHMM } from '../common/utils/clinic-time';

/**
 * Slot-engine unit tests (plan §5). Models are mocked so we exercise the pure
 * generation/union/marking logic deterministically. Dates are chosen relative
 * to "today" to stay inside the 7-day booking window.
 */
describe('SlotsService', () => {
  const config = {
    get: (key: string) =>
      key === 'clinicTimezone' ? 'Asia/Kolkata' : key === 'bookingWindowDays' ? 7 : undefined,
  } as unknown as ConfigService;

  // A future date within the window (3 days out) and its weekday.
  const target = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const targetDow = dayOfWeek(target);

  function build(opts: {
    sessions?: any[];
    exception?: any;
    booked?: string[];
  }) {
    const scheduleModel = {
      findAll: jest.fn().mockResolvedValue(
        (opts.sessions ?? []).map((s) => ({ ...s, day_of_week: targetDow, is_active: true })),
      ),
    };
    const exceptionModel = {
      findOne: jest.fn().mockResolvedValue(opts.exception ?? null),
    };
    const appointmentModel = {
      findAll: jest
        .fn()
        .mockResolvedValue((opts.booked ?? []).map((t) => ({ start_time: t }))),
    };
    return new SlotsService(
      config,
      scheduleModel as any,
      exceptionModel as any,
      appointmentModel as any,
    );
  }

  it('generates dynamic slot count for one session (11:00–14:00 @10 → 18)', async () => {
    const svc = build({
      sessions: [{ start_time: '11:00', end_time: '14:00', slot_duration_min: 10 }],
    });
    const res = await svc.getDaySlots('doc', target);
    expect(res.available).toBe(true);
    expect(res.slots).toHaveLength(18);
    expect(res.slots[0].start_time).toBe('11:00');
    expect(res.slots[17].end_time).toBe('14:00');
  });

  it('unions split sessions with a gap (11–14 & 17–19 @10 → 30, none in 14–17)', async () => {
    const svc = build({
      sessions: [
        { start_time: '11:00', end_time: '14:00', slot_duration_min: 10 },
        { start_time: '17:00', end_time: '19:00', slot_duration_min: 10 },
      ],
    });
    const res = await svc.getDaySlots('doc', target);
    expect(res.slots).toHaveLength(30);
    expect(res.slots.filter((s) => s.start_time >= '14:00' && s.start_time < '17:00')).toHaveLength(0);
    // sorted across the union
    const times = res.slots.map((s) => s.start_time);
    expect(times).toEqual([...times].sort());
  });

  it('supports different durations per session (15:00–18:00 @15 → 12)', async () => {
    const svc = build({
      sessions: [{ start_time: '15:00', end_time: '18:00', slot_duration_min: 15 }],
    });
    const res = await svc.getDaySlots('doc', target);
    expect(res.slots).toHaveLength(12);
  });

  it('marks booked slots', async () => {
    const svc = build({
      sessions: [{ start_time: '11:00', end_time: '12:00', slot_duration_min: 10 }],
      booked: ['11:30:00'],
    });
    const res = await svc.getDaySlots('doc', target);
    expect(res.slots.find((s) => s.start_time === '11:30')?.status).toBe('booked');
    expect(res.slots.find((s) => s.start_time === '11:00')?.status).toBe('available');
  });

  it('returns not-available on a leave day', async () => {
    const svc = build({
      sessions: [{ start_time: '11:00', end_time: '14:00', slot_duration_min: 10 }],
      exception: { type: 'leave' },
    });
    const res = await svc.getDaySlots('doc', target);
    expect(res.available).toBe(false);
    expect(res.reason).toBe('leave');
  });

  it('returns no_opd when the weekday has no sessions', async () => {
    const svc = build({ sessions: [] });
    const res = await svc.getDaySlots('doc', target);
    expect(res.available).toBe(false);
    expect(res.reason).toBe('no_opd');
  });

  it('flags out-of-window dates', async () => {
    const svc = build({
      sessions: [{ start_time: '11:00', end_time: '14:00', slot_duration_min: 10 }],
    });
    const far = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const res = await svc.getDaySlots('doc', far);
    expect(res.available).toBe(false);
    expect(res.reason).toBe('out_of_window');
  });

  it('honours a custom exception override', async () => {
    const svc = build({
      sessions: [{ start_time: '11:00', end_time: '14:00', slot_duration_min: 10 }],
      exception: {
        type: 'custom',
        start_time: '09:00',
        end_time: '10:00',
        slot_duration_min: 10,
      },
    });
    const res = await svc.getDaySlots('doc', target);
    expect(res.slots).toHaveLength(6);
    expect(res.slots[0].start_time).toBe('09:00');
  });
});
