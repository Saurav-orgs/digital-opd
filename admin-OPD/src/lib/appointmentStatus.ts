import type { Appointment } from '../api/types';

/** Today as "YYYY-MM-DD" in the browser's own timezone, the way the server
 *  dates appointments. */
function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A visit whose day has passed with nobody pressing anything.
 *
 * The doctor can mark a no-show, but on a busy day most missed visits are
 * simply never touched, so they sit in Previous still reading "pending" as if
 * the patient were in the waiting room. Nothing is written to the record:
 * this is only how such a visit is described, and marking it done or a
 * no-show still overrides it.
 */
export function isMissed(a: Appointment): boolean {
  if (a.status === 'cancelled') return false;
  if (a.consultation_status !== 'pending' && a.consultation_status !== 'on_hold') return false;
  return a.appointment_date < todayIso();
}

/** The status value to render for a visit, `missed` standing in for a stale
 *  `pending`. Only a display value — never send it back to the server. */
export function displayStatus(a: Appointment): string {
  if (a.status === 'cancelled') return 'rejected';
  return isMissed(a) ? 'missed' : a.consultation_status;
}
