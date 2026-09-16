import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { schedulesApi } from '../api/endpoints';
import type { ScheduleEntry } from '../api/types';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Empty, Field, Loading } from '../components/ui';
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
export default function DoctorSchedule() {
  const navigate = useNavigate();
  const { can, user, isDoctor } = useAuth();
  const toast = useToast();
  const canEdit = can('opd_schedules', 'update');
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

  const save = useMutation({
    mutationFn: () => {
      const entries: ScheduleEntry[] = [];
      for (const day of workingDays(timings)) {
        for (const slot of timings[day].slots) {
          entries.push({
            day_of_week: day,
            start_time: slot.start_time,
            end_time: slot.end_time,
            slot_duration_min: slotMins,
          });
        }
      }
      return schedulesApi.replace(id, entries);
    },
    onSuccess: () => toast.success('Schedule saved'),
    onError: (e) => toast.error(e),
  });

  if (!isDoctor || !id) return <Empty>This page is for the doctor’s account.</Empty>;
  if (schedQ.isLoading) return <Loading />;


  return (
    <>
      <div className="page-head">
        <div>
          <h1>My schedule</h1>
          <span className="muted">
            Add multiple sessions to one day for split OPD (e.g. morning &amp; evening).
          </span>
        </div>
        <div className="row">
          <button className="btn" onClick={() => navigate('/profile')}>Back</button>
          {canEdit && (
            <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save schedule'}
            </button>
          )}
        </div>
      </div>

      <div className="grid cols-2-1">
        <div className="card">
          <div className="card-title">Weekly hours</div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
            Open a day to add its time slots, then save it. A day can have more
            than one slot. Days you leave unset are days off.
          </div>

          <DayAvailabilityEditor
            timings={timings}
            onChange={setTimings}
            onNotify={(m) => toast.success(m)}
          />

          <label className="form-label" style={{ marginTop: 14 }}>
            Each appointment slot
          </label>
          <select
            className="select"
            value={slotMins}
            disabled={!canEdit}
            onChange={(e) => setSlotMins(Number(e.target.value))}
          >
            {[5, 10, 15, 20, 30, 45, 60].map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>
          <span className="hint">
            Saving a day here records it; the schedule reaches the server when
            you press Save schedule.
          </span>
        </div>

        <div className="stack">
          <LeavePanel doctorId={id} canEdit={canEdit} />
          <SlotPreview doctorId={id} />
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

  const mark = useMutation({
    mutationFn: () =>
      schedulesApi.markLeave(doctorId, date, reason || undefined, endDate || undefined),
    onSuccess: () => {
      refresh();
      const span = formatSpan({ from: date, to: endDate || date, reason: null });
      toast.success(
        'Leave marked',
        `${span} ${endDate && endDate !== date ? 'are' : 'is'} now blocked for booking.`,
      );
      setDate('');
      setEndDate('');
      setReason('');
    },
    onError: (e) => {
      // Surface the blocking bookings clearly (LEAVE_HAS_BOOKINGS).
      if (e instanceof ApiError && e.code === 'LEAVE_HAS_BOOKINGS') {
        const n = Array.isArray(e.details) ? e.details.length : 0;
        toast.error(e, `${e.message} (${n} booking${n === 1 ? '' : 's'})`);
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
      <div className="time-row">
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
        onClick={() => mark.mutate()}
      >
        {mark.isPending
          ? 'Marking…'
          : endDate && endDate !== date
            ? 'Mark these dates as leave'
            : 'Mark this date as leave'}
      </button>
      <p className="muted" style={{ fontSize: 12, margin: '10px 0' }}>
        Blocked if any of the days already has confirmed bookings.
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
    </div>
  );
}

function SlotPreview({ doctorId }: { doctorId: string }) {
  const [date, setDate] = useState('');
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
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(66px, 1fr))', gap: 6 }}>
            {slotsQ.data.slots.map((s) => (
              <div key={s.start_time} className={`slot slot-${s.status}`}>{s.start_time}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
