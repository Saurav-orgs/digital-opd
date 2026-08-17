import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doctorsApi, schedulesApi } from '../api/endpoints';
import type { ScheduleEntry } from '../api/types';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Field, Loading } from '../components/ui';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hhmm = (t: string) => t.slice(0, 5);

interface Session { start_time: string; end_time: string; slot_duration_min: number }

export default function DoctorSchedule() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can('opd_schedules', 'update');

  const doctorQ = useQuery({ queryKey: ['doctor', id], queryFn: () => doctorsApi.get(id) });
  const schedQ = useQuery({ queryKey: ['schedules', id], queryFn: () => schedulesApi.list(id) });

  // Local editable model: sessions grouped by weekday.
  const [byDay, setByDay] = useState<Record<number, Session[]>>({});

  useEffect(() => {
    if (!schedQ.data) return;
    const grouped: Record<number, Session[]> = {};
    for (const e of schedQ.data) {
      (grouped[e.day_of_week] ??= []).push({
        start_time: hhmm(e.start_time),
        end_time: hhmm(e.end_time),
        slot_duration_min: e.slot_duration_min,
      });
    }
    setByDay(grouped);
  }, [schedQ.data]);

  const save = useMutation({
    mutationFn: () => {
      const entries: ScheduleEntry[] = [];
      for (const [day, sessions] of Object.entries(byDay)) {
        for (const s of sessions) {
          entries.push({ day_of_week: Number(day), ...s });
        }
      }
      return schedulesApi.replace(id, entries);
    },
    onSuccess: () => toast.success('Schedule saved'),
    onError: (e) => toast.error(e),
  });

  if (doctorQ.isLoading || schedQ.isLoading) return <Loading />;

  const addSession = (day: number) =>
    setByDay((prev) => ({
      ...prev,
      [day]: [...(prev[day] ?? []), { start_time: '11:00', end_time: '14:00', slot_duration_min: 10 }],
    }));

  const removeSession = (day: number, idx: number) =>
    setByDay((prev) => ({ ...prev, [day]: prev[day].filter((_, i) => i !== idx) }));

  const patchSession = (day: number, idx: number, patch: Partial<Session>) =>
    setByDay((prev) => ({
      ...prev,
      [day]: prev[day].map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{doctorQ.data?.name} · schedule</h1>
          <span className="muted">
            Add multiple sessions to one day for split OPD (e.g. morning &amp; evening).
          </span>
        </div>
        <div className="row">
          <button className="btn" onClick={() => navigate('/doctors')}>Back</button>
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
          {DAYS.map((label, day) => (
            <div key={day} style={{ padding: '10px 0', borderBottom: 'var(--hairline)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong style={{ fontWeight: 500 }}>{label}</strong>
                {canEdit && (
                  <button className="btn btn-sm btn-ghost" onClick={() => addSession(day)}>
                    + Add session
                  </button>
                )}
              </div>
              {(byDay[day] ?? []).length === 0 ? (
                <span className="muted" style={{ fontSize: 13 }}>No OPD</span>
              ) : (
                (byDay[day] ?? []).map((s, idx) => (
                  <div key={idx} className="row" style={{ marginTop: 8 }}>
                    <input
                      className="input" type="time" style={{ width: 120 }} disabled={!canEdit}
                      value={s.start_time}
                      onChange={(e) => patchSession(day, idx, { start_time: e.target.value })}
                    />
                    <span className="muted">to</span>
                    <input
                      className="input" type="time" style={{ width: 120 }} disabled={!canEdit}
                      value={s.end_time}
                      onChange={(e) => patchSession(day, idx, { end_time: e.target.value })}
                    />
                    <select
                      className="select" style={{ width: 110 }} disabled={!canEdit}
                      value={s.slot_duration_min}
                      onChange={(e) => patchSession(day, idx, { slot_duration_min: Number(e.target.value) })}
                    >
                      {[5, 10, 15, 20, 30].map((m) => (
                        <option key={m} value={m}>{m} min</option>
                      ))}
                    </select>
                    {canEdit && (
                      <button className="btn btn-sm btn-danger" onClick={() => removeSession(day, idx)}>
                        Remove
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          ))}
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

function LeavePanel({ doctorId, canEdit }: { doctorId: string; canEdit: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState('');
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
    mutationFn: () => schedulesApi.markLeave(doctorId, date, reason || undefined),
    onSuccess: () => {
      refresh();
      toast.success('Leave marked', `${date} is now blocked for booking.`);
      setDate('');
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
    mutationFn: (d: string) => schedulesApi.removeLeave(doctorId, d),
    onSuccess: () => {
      refresh();
      toast.success('Leave removed');
    },
    onError: (e) => toast.error(e),
  });

  return (
    <div className="card">
      <div className="card-title">Leave days</div>
      <Field label="Date">
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Reason (optional)">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <button
        className="btn btn-primary btn-sm"
        style={{ width: '100%', justifyContent: 'center' }}
        disabled={!canEdit || !date || mark.isPending}
        onClick={() => mark.mutate()}
      >
        Mark this date as leave
      </button>
      <p className="muted" style={{ fontSize: 12, margin: '10px 0' }}>
        Blocked if the day already has confirmed bookings.
      </p>

      <div style={{ borderTop: 'var(--hairline)', paddingTop: 12 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
          Scheduled leave
        </div>
        {leaveQ.isLoading ? (
          <span className="muted">Loading…</span>
        ) : !leaveQ.data?.length ? (
          <span className="muted">No leave marked.</span>
        ) : (
          leaveQ.data.map((l) => (
            <div key={l.id} className="leave-item">
              <div>
                <div>{formatDate(l.date)}</div>
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
                  onClick={() => remove.mutate(l.date)}
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
