/**
 * Timezone-aware helpers pinned to the clinic timezone (plan §12.10).
 * All slot/date reasoning uses the clinic wall-clock, never the server's.
 */

/** Current wall-clock in the given IANA timezone. */
export function nowInClinic(timeZone: string): {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  minutes: number; // minutes since midnight
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  // en-CA formats hour "24" at midnight in some engines; normalise.
  const hour = map.hour === '24' ? '00' : map.hour;
  const date = `${map.year}-${map.month}-${map.day}`;
  const time = `${hour}:${map.minute}`;
  return { date, time, minutes: toMinutes(time) };
}

/** "HH:mm" or "HH:mm:ss" → minutes since midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** minutes since midnight → "HH:mm". */
export function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Whole days between two YYYY-MM-DD dates (b - a), timezone-agnostic. */
export function daysBetween(a: string, b: string): number {
  const da = Date.UTC(...(a.split('-').map(Number) as [number, number, number]));
  const db = Date.UTC(...(b.split('-').map(Number) as [number, number, number]));
  return Math.round((db - da) / 86400000);
}

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD date. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Basic YYYY-MM-DD shape + real-date check. */
export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}
