import type { Appointment, ConsultationStatus } from '../api/types';

/**
 * Is this visit still waiting on the doctor?
 *
 * The question behind "pending" on the list, behind which rows a leave day
 * still owes a consultation for, and behind which visit is next. It lived in
 * `Dashboard.tsx` until the leave warning needed the same answer on the visit
 * screen; two copies of a rule about status columns is how they drift.
 */
export function isOpen(status: ConsultationStatus): boolean {
  return status === 'pending' || status === 'on_hold';
}

/** Today as "YYYY-MM-DD" in the browser's own timezone, the way the server
 *  dates appointments. */
function todayIso() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Has this visit been called off, by either side?
 *
 * Two columns can say so and they are written by different doors: the clinic
 * cancelling sets `consultation_status = 'rejected'`, a patient withdrawing
 * their own booking sets `status = 'cancelled'`, and the clinic's cancel sets
 * both (it has to, or the slot stays held). Every screen means the same thing
 * by "cancelled", so the question is asked in one place.
 */
export function isCancelled(a: Appointment): boolean {
  return (
    a.status === 'cancelled' ||
    a.status === 'rejected' ||
    a.consultation_status === 'rejected'
  );
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
  if (isCancelled(a)) return false;
  if (a.consultation_status !== 'pending' && a.consultation_status !== 'on_hold') return false;
  return a.appointment_date < todayIso();
}

/**
 * Does this visit have to be moved because the doctor is away that day?
 *
 * `on_leave` alone is not the question — it only says the day was marked as
 * leave, which is just as true of the visit that was cancelled last week and
 * of the one the doctor already saw. Warning about those sends the clinic
 * ringing patients who need no call.
 */
export function needsReschedule(a: Appointment): boolean {
  return a.on_leave && isOpen(a.consultation_status) && !isCancelled(a) && !isMissed(a);
}

/** The status value to render for a visit, `missed` standing in for a stale
 *  `pending`. Only a display value — never send it back to the server. */
export function displayStatus(a: Appointment): string {
  if (isCancelled(a)) return 'rejected';
  return isMissed(a) ? 'missed' : a.consultation_status;
}
