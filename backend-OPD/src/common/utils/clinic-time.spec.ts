import {
  toMinutes,
  toHHMM,
  daysBetween,
  dayOfWeek,
  isValidDate,
} from './clinic-time';

describe('clinic-time utils', () => {
  it('converts time to/from minutes', () => {
    expect(toMinutes('11:00')).toBe(660);
    expect(toMinutes('17:30')).toBe(1050);
    expect(toMinutes('09:05:00')).toBe(545);
    expect(toHHMM(660)).toBe('11:00');
    expect(toHHMM(1050)).toBe('17:30');
  });

  it('computes days between dates', () => {
    expect(daysBetween('2026-07-24', '2026-07-24')).toBe(0);
    expect(daysBetween('2026-07-24', '2026-07-31')).toBe(7);
    expect(daysBetween('2026-07-24', '2026-07-23')).toBe(-1);
  });

  it('computes day of week (0=Sun)', () => {
    expect(dayOfWeek('2026-07-24')).toBe(5); // Friday
    expect(dayOfWeek('2026-07-26')).toBe(0); // Sunday
  });

  it('validates date strings', () => {
    expect(isValidDate('2026-07-24')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('24-07-2026')).toBe(false);
  });
});
