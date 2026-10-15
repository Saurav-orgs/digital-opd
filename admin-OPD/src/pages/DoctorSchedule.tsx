import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CalendarClock, ChevronDown, Timer, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { schedulesApi, type LeaveClash } from '../api/endpoints';
import type { ScheduleEntry, Slot } from '../api/types';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Empty, Field, Loading, Modal } from '../components/ui';
import { WalkInModal } from '../components/WalkInModal';
import {
  DayAvailabilityEditor,
  workingDays,
  type DayTimings,
} from '../components/DayAvailabilityEditor';

const hhmm = (t: string) => t.slice(0, 5);

/**
 * The doctor's own OPD schedule, reached from My Profile. Self-scoped to the
 * logged-in doctor's linked profile — the clinic has a single doctor.
 *
 * Shares the registration form's per-day editor, at the client's request, so
 * setting hours works the same whether it is done at sign-up or changed a year
 * later. The one thing this screen adds is that a day already saved on the
 * server arrives saved — nothing is "unset" here that the clinic is already
 * open for.
 */
/** One write of the whole week: what to store, how long a slot is, what to say. */
interface SaveArgs {
  week: DayTimings;
  mins: number;
  message: string;
}

export default function DoctorSchedule() {
  const { can, user, isDoctor } = useAuth();
  /*
   * Set by the first-login wizard, which sends the doctor straight here. The
   * account already has a week of hours by then — nobody chose them, so the
   * screen says so once rather than letting a doctor find out from a patient
   * who booked 10:30 on a day the clinic is shut.
   */
  const location = useLocation();
  const [showWelcome, setShowWelcome] = useState(
    !!(location.state as { fresh?: boolean } | null)?.fresh,
  );
  const toast = useToast();
  const qc = useQueryClient();
  const canEdit = can('opd_schedules', 'update');
  // Booking a slot off the grid is a booking, not a schedule edit — a role
  // that may set hours but not take appointments gets the read-only grid.
  const canBook = can('appointments', 'create');
  const id = user?.doctorId ?? '';

  const schedQ = useQuery({
    queryKey: ['schedules', id],
    queryFn: () => schedulesApi.list(id),
    enabled: !!id,
  });

  const [timings, setTimings] = useState<DayTimings>({});
  // One duration for the whole week, which is what the sign-up form collects.
  // An existing schedule may hold several; the first one wins and the rest are
  // brought into line on the next save rather than silently kept apart.
  const [slotMins, setSlotMins] = useState(15);

  useEffect(() => {
    if (!schedQ.data) return;
    const next: DayTimings = {};
    for (const e of schedQ.data) {
      const day = next[e.day_of_week] ?? { slots: [], saved: true };
      day.slots.push({ start_time: hhmm(e.start_time), end_time: hhmm(e.end_time) });
      next[e.day_of_week] = day;
    }
    for (const day of Object.values(next)) {
      day.slots.sort((x, y) => x.start_time.localeCompare(y.start_time));
    }
    setTimings(next);
    if (schedQ.data[0]) setSlotMins(schedQ.data[0].slot_duration_min);
  }, [schedQ.data]);

  /*
   * One write per action, from the day the doctor is actually editing.
   *
   * There used to be a "Save schedule" button at the top of the page and the
   * day's own "Save Mon" only set a local flag — so the day said it was saved
   * and nothing had left the browser. The endpoint replaces the whole week in
   * one call, so sending the week on every day-level action costs no more than
   * the old button did and means the word "save" is finally true.
   *
   * `week` and `mins` are passed in rather than read from state: the caller
   * hands over the values it has just produced, and waiting for a re-render
   * before saving would send the previous ones.
   */
  const save = useMutation({
    mutationFn: ({ week, mins }: SaveArgs) => {
      const entries: ScheduleEntry[] = [];
      for (const day of workingDays(week)) {
        for (const slot of week[day].slots) {
          entries.push({
            day_of_week: day,
            start_time: slot.start_time,
            end_time: slot.end_time,
            slot_duration_min: mins,
          });
        }
      }
      return schedulesApi.replace(id, entries);
    },
    onMutate: ({ week, mins }) => {
      // Shown immediately; `onError` puts the old week back.
      const previous = { timings, slotMins };
      setTimings(week);
      setSlotMins(mins);
      return { previous };
    },
    onSuccess: (_data, { message }) => {
      toast.success(message);
      // The preview beside this reads the same hours.
      qc.invalidateQueries({ queryKey: ['slots', id] });
    },
    onError: (e, _vars, context) => {
      // Never leave a day reading "saved" over hours the server refused.
      if (context?.previous) {
        setTimings(context.previous.timings);
        setSlotMins(context.previous.slotMins);
      }
      toast.error(e);
    },
  });

  /** A day-level action: the week the editor just built, at the current length. */
  const persist = (week: DayTimings, message: string) =>
    save.mutate({ week, mins: slotMins, message });

  /** The slot-length pill: the week as it stands, at the new length. */
  const persistSlotLength = (mins: number) =>
    save.mutate({ week: timings, mins, message: `Slots are now ${mins} minutes` });

  if (!isDoctor || !id) return <Empty>This page is for the doctor’s account.</Empty>;
  if (schedQ.isLoading) return <Loading />;


  return (
    <>
      <div className="page-head">
        <div>
          <h1>My time slots</h1>
          <span className="muted">
            Add multiple sessions to one day for split OPD (e.g. morning &amp; evening).
          </span>
        </div>
      </div>

      {showWelcome && (
        <div className="tg-welcome" role="status">
          <span className="tg-welcome-icon" aria-hidden>
            <CalendarClock size={18} />
          </span>
          <div>
            <b>Your clinic is open Monday to Saturday, 10:00 AM – 2:00 PM.</b>
            <span>
              That is our starting point, not your decision — open any day
              below and change it. Leave it as it is and patients can book
              these hours straight away.
            </span>
          </div>
          <button
            type="button"
            className="tg-welcome-x"
            aria-label="Dismiss"
            onClick={() => setShowWelcome(false)}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      )}

      <div className="grid cols-2-1">
        <div className="card">
          {/*
            Slot length sits in the card's header, as a pill, rather than as a
            labelled select under the seven days. It applies to the whole week
            — not to the day you happen to have open — and at the bottom of the
            list it read like a property of the last row.
          */}
          <div className="tg-card-head">
            <div className="tg-card-head-text">
              <div className="card-title">Weekly hours</div>
              <div className="tg-sub">
                Open a day to set its hours and save it — each day is saved on
                its own. A day can have more than one slot, and days left unset
                are days off.
              </div>
            </div>
            <label className="tg-slotlen" title="How long one appointment is">
              <Timer size={15} aria-hidden />
              <span className="sr-only">Length of one appointment slot</span>
              {/* Saved on change for the same reason the days are: this used
                  to reach the server only via "Save schedule", so without it a
                  change here would be silently dropped. It applies to the whole
                  week, so the week is what gets written. */}
              <select
                value={slotMins}
                disabled={!canEdit || save.isPending}
                onChange={(e) => persistSlotLength(Number(e.target.value))}
              >
                {[5, 10, 15, 20, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>{m} min slots</option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden />
            </label>
          </div>

          <DayAvailabilityEditor
            timings={timings}
            onChange={setTimings}
            onPersist={persist}
            saving={save.isPending}
          />

        </div>

        <div className="stack">
          <LeavePanel doctorId={id} canEdit={canEdit} />
          <SlotPreview doctorId={id} canBook={canBook} />
        </div>
      </div>
    </>
  );
}

function formatDate(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The day after a YYYY-MM-DD date, as YYYY-MM-DD. */
function nextDay(d: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day + 1));
  return dt.toISOString().slice(0, 10);
}

/** A run of leave days: one date, or a first-to-last span. */
interface LeaveSpan {
  from: string;
  to: string;
  reason: string | null;
}

/**
 * Leave is kept a day at a time, but a vacation is one thing to the doctor.
 * Consecutive dates with the same reason fold into one span, so a fortnight
 * off reads as "12 – 25 Oct", not fourteen rows.
 */
function groupLeave(rows: { date: string; reason: string | null }[]): LeaveSpan[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const spans: LeaveSpan[] = [];
  for (const r of sorted) {
    const last = spans[spans.length - 1];
    if (last && nextDay(last.to) === r.date && (last.reason ?? '') === (r.reason ?? '')) {
      last.to = r.date;
    } else {
      spans.push({ from: r.date, to: r.date, reason: r.reason ?? null });
    }
  }
  return spans;
}

/** "Sat, 12 Oct 2026" or "12 Oct – 25 Oct 2026" for a span. */
function formatSpan(s: LeaveSpan): string {
  if (s.from === s.to) return formatDate(s.from);
  const short = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
  };
  const year = s.to.slice(0, 4);
  return `${short(s.from)} – ${short(s.to)} ${year}`;
}

function LeavePanel({ doctorId, canEdit }: { doctorId: string; canEdit: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const leaveQ = useQuery({
    queryKey: ['leave', doctorId],
    queryFn: () => schedulesApi.listLeave(doctorId),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['leave', doctorId] });
    qc.invalidateQueries({ queryKey: ['slots', doctorId] });
  };

  /*
   * The bookings the server refused over, held while the doctor decides.
   *
   * The refusal used to end at a red toast reading "… (3 bookings)": no way to
   * see which three, and no way to go on. A doctor does not stop being away
   * because the day is booked — the booking is what has to move — so the
   * answer is to show them and ask, then send the same call back with `force`.
   */
  const [clashes, setClashes] = useState<LeaveClash[] | null>(null);

  const mark = useMutation({
    mutationFn: (force?: boolean) =>
      schedulesApi.markLeave(doctorId, date, reason || undefined, endDate || undefined, force),
    onSuccess: (_data, force) => {
      refresh();
      // The visits on those days now carry an "On leave" warning, and the list
      // counts them — so the appointments the doctor must ring round about do
      // not depend on remembering this moment.
      qc.invalidateQueries({ queryKey: ['appointments'] });
      const span = formatSpan({ from: date, to: endDate || date, reason: null });
      const moved = force ? clashes?.length ?? 0 : 0;
      toast.success(
        'Leave marked',
        moved > 0
          ? `${span} ${endDate && endDate !== date ? 'are' : 'is'} now blocked. ` +
              `${moved} booking${moved === 1 ? '' : 's'} still need${moved === 1 ? 's' : ''} ` +
              `rescheduling — ${moved === 1 ? 'that patient has' : 'those patients have'} been notified.`
          : `${span} ${endDate && endDate !== date ? 'are' : 'is'} now blocked for booking.`,
      );
      setClashes(null);
      setDate('');
      setEndDate('');
      setReason('');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'LEAVE_HAS_BOOKINGS') {
        setClashes(Array.isArray(e.details) ? (e.details as LeaveClash[]) : []);
      } else {
        toast.error(e);
      }
    },
  });

  const remove = useMutation({
    mutationFn: (span: LeaveSpan) => schedulesApi.removeLeave(doctorId, span.from, span.to),
    onSuccess: () => {
      refresh();
      toast.success('Leave removed');
    },
    onError: (e) => toast.error(e),
  });

  const rangeInvalid = !!endDate && !!date && endDate < date;
  const spans = groupLeave(leaveQ.data ?? []);

  return (
    <div className="card">
      <div className="card-title">Vacation &amp; leave</div>
      <div className="leave-dates">
        <div>
          <label className="form-label">From</label>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              // A single day is the common case: the end follows the start
              // until the doctor moves it.
              if (!endDate || endDate < e.target.value) setEndDate(e.target.value);
            }}
          />
        </div>
        <div>
          <label className="form-label">To</label>
          <input
            className="input"
            type="date"
            min={date || undefined}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      {rangeInvalid && <div className="field-err">Leave cannot end before it starts.</div>}
      <Field label="Reason (optional)">
        <input
          className="input"
          placeholder="e.g. Family vacation"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <button
        className="btn btn-primary btn-sm"
        style={{ width: '100%', justifyContent: 'center' }}
        disabled={!canEdit || !date || rangeInvalid || mark.isPending}
        onClick={() => mark.mutate(undefined)}
      >
        {mark.isPending
          ? 'Marking…'
          : endDate && endDate !== date
            ? 'Mark these dates as leave'
            : 'Mark this date as leave'}
      </button>
      <p className="muted" style={{ fontSize: 12, margin: '10px 0' }}>
        If any of the days is already booked, you will be shown the bookings
        before the leave is marked.
      </p>

      <div style={{ borderTop: 'var(--hairline)', paddingTop: 12 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
          Scheduled leave
        </div>
        {leaveQ.isLoading ? (
          <span className="muted">Loading…</span>
        ) : !spans.length ? (
          <span className="muted">No leave marked.</span>
        ) : (
          spans.map((l) => (
            <div key={l.from} className="leave-item">
              <div>
                <div>{formatSpan(l)}</div>
                {l.reason && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {l.reason}
                  </div>
                )}
              </div>
              {canEdit && (
                <button
                  className="btn btn-sm btn-danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(l)}
                >
                  Remove
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {clashes && (
        <LeaveClashDialog
          clashes={clashes}
          busy={mark.isPending}
          onCancel={() => setClashes(null)}
          onConfirm={() => mark.mutate(true)}
        />
      )}
    </div>
  );
}

/**
 * "These bookings clash — go ahead anyway?"
 *
 * Shown instead of refusing. The doctor is going to be away whatever this
 * screen says; what they need is the list to ring round, which is why each row
 * carries the patient's number as a `tel:` link rather than just a name.
 */
function LeaveClashDialog({
  clashes,
  busy,
  onCancel,
  onConfirm,
}: {
  clashes: LeaveClash[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      title={`${clashes.length} booking${clashes.length === 1 ? '' : 's'} on these days`}
      onClose={onCancel}
      persistent
      footer={
        <div className="modal-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            Go back
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Marking…' : 'Mark leave anyway'}
          </button>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 0 }}>
        The leave will be marked and no new bookings can be made, but these
        visits stay where they are until you move them. Each patient is told
        their appointment has to change.
      </p>
      <div className="leave-clash-list">
        {clashes.map((c) => (
          <div key={c.id} className="leave-clash">
            <div>
              <div style={{ fontWeight: 600 }}>{c.patient_name}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {formatDate(c.appointment_date)} · {hhmm(c.start_time)}
              </div>
            </div>
            <a className="btn btn-sm" href={`tel:${c.patient_mobile}`}>
              {c.patient_mobile}
            </a>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * The day's slots as the patient would see them — and a way to take one.
 *
 * It was a read-only preview: the doctor could see that 11:30 was free on
 * Thursday but had no way to give it to the patient on the phone, because the
 * only booking in the panel is Walk-in, which is always "now". Tapping a free
 * slot here opens the same registration form with that date and time attached,
 * held to the grid (see `WalkInModal`'s `slot` prop) so a slot someone took in
 * the meantime is refused rather than quietly moved.
 *
 * Booked and past slots stay inert: a past slot cannot be given away, and a
 * booked one belongs to a patient — double-booking is a walk-in's job, from
 * the appointment list, where the doctor can see who is already in it.
 */
function SlotPreview({ doctorId, canBook }: { doctorId: string; canBook: boolean }) {
  const [date, setDate] = useState('');
  const [booking, setBooking] = useState<Slot | null>(null);
  const slotsQ = useQuery({
    queryKey: ['slots', doctorId, date],
    queryFn: () => schedulesApi.slots(doctorId, date),
    enabled: !!date,
  });

  return (
    <div className="card">
      <div className="card-title">Preview slots</div>
      <Field label="Date">
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {!date ? (
        <span className="muted">Pick a date to preview generated slots.</span>
      ) : slotsQ.isLoading ? (
        <Loading />
      ) : !slotsQ.data?.available ? (
        <span className="muted">Not available ({slotsQ.data?.reason?.replace('_', ' ')}).</span>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {slotsQ.data.slots.length} slots
            {canBook && ' · tap a free slot to book it'}
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(66px, 1fr))', gap: 6 }}>
            {slotsQ.data.slots.map((s) => {
              const pickable = canBook && s.status === 'available';
              return (
                <button
                  key={s.start_time}
                  type="button"
                  className={`slot slot-${s.status}${pickable ? ' slot-pickable' : ''}`}
                  disabled={!pickable}
                  title={
                    pickable
                      ? `Book ${s.start_time}`
                      : s.status === 'booked'
                        ? 'Already booked'
                        : undefined
                  }
                  onClick={() => pickable && setBooking(s)}
                >
                  {s.start_time}
                </button>
              );
            })}
          </div>
        </>
      )}

      {booking && (
        <WalkInModal
          doctorId={doctorId}
          slot={{ date, startTime: booking.start_time }}
          onClose={() => setBooking(null)}
        />
      )}
    </div>
  );
}
