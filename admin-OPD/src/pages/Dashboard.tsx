import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, doctorsApi, appointmentsApi } from '../api/endpoints';
import type { Appointment, ConsultationStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { WalkInModal } from '../components/WalkInModal';
import { Badge, Empty, Loading } from '../components/ui';
import { NARROW, useMediaQuery } from '../lib/useMediaQuery';

type Range = 'previous' | 'today' | 'upcoming';
type StatusFilter = 'pending' | 'done' | 'all';

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(base: Date, n: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}
const YESTERDAY_STR = toDateStr(addDays(new Date(), -1));
const TOMORROW_STR = toDateStr(addDays(new Date(), 1));

export default function Dashboard() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('today');
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [date, setDate] = useState<string | undefined>(undefined);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<string | undefined>(undefined);
  const [walkInOpen, setWalkInOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim() || undefined), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // A specific date only makes sense within the tab that allows it; drop it
  // whenever the tab changes so switching tabs never carries a stale filter.
  function selectRange(r: Range) {
    setRange(r);
    setDate(undefined);
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.summary,
  });

  // Doctor to book walk-ins for: every clinic account is linked to the single
  // doctor profile, so the link answers it; the list is only a fallback for an
  // unlinked account (mirrors WalkInFormScreen).
  const doctorsQ = useQuery({
    queryKey: ['doctors'],
    queryFn: doctorsApi.list,
    enabled: !user?.doctorId,
  });
  const doctorId = user?.doctorId ?? doctorsQ.data?.[0]?.id;

  const canCreate = can('appointments', 'create');

  if (isLoading) return <Loading />;
  if (error) return <Empty>Could not load the appointments.</Empty>;
  if (!data) return null;

  return (
    <>
      <div className="page-head" style={{ marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Appointments</h1>
        </div>
        {canCreate && (
          <button
            className="btn btn-primary"
            disabled={!doctorId}
            onClick={() => setWalkInOpen(true)}
          >
            + Walk-in Patient
          </button>
        )}
      </div>

      <div className="grid stat-tiles" style={{ marginBottom: 14 }}>
        <Tile accent="gray" icon="🕓" num={data.previous} label="Previous" />
        <Tile accent="blue" icon="🗓" num={data.total} label="Today" />
        <Tile accent="gray" icon="📅" num={data.upcoming} label="Upcoming" />
      </div>

      {/* Filters and the list read as one surface: the toolbar acts on the
          rows directly below it, so a seam between them would be a lie. */}
      <div className="list-panel">
        <div className="list-panel-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200 }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontSize: 14,
                    color: 'var(--muted)',
                    pointerEvents: 'none',
                  }}
                >
                  🔍
                </span>
                <input
                  className="input"
                  type="search"
                  placeholder="Search patient name, mobile number…"
                  style={{ width: '100%', padding: '9px 12px 9px 36px' }}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>

              {/* Status filter sits right beside the date filter, not its own row. */}
              <div className="row" style={{ gap: 8, flexWrap: 'nowrap', flex: '0 0 auto' }}>
                <DateFilter range={range} date={date} onChange={setDate} />
                <select
                  className="select"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StatusFilter)}
                  style={{ width: 130, flex: '0 0 auto' }}
                  aria-label="Filter by status"
                >
                  <option value="pending">Pending</option>
                  <option value="done">Completed</option>
                  <option value="all">All statuses</option>
                </select>
              </div>
            </div>

            {/* Range tabs — always one row, sized down on narrow screens. */}
            <div className="range-tabs">
              <TabButton
                label="Previous"
                active={range === 'previous'}
                pending={data.pending.previous}
                onClick={() => selectRange('previous')}
              />
              <TabButton
                label="Today"
                active={range === 'today'}
                pending={data.pending.today}
                onClick={() => selectRange('today')}
              />
              <TabButton
                label="Upcoming"
                active={range === 'upcoming'}
                pending={data.pending.upcoming}
                onClick={() => selectRange('upcoming')}
              />
            </div>
          </div>
        </div>

        <RangeTable
          range={range}
          search={search}
          date={date}
          status={status}
          onSelect={(id) => navigate(`/appointments/${id}`)}
        />
      </div>

      {walkInOpen && doctorId && (
        <WalkInModal doctorId={doctorId} onClose={() => setWalkInOpen(false)} />
      )}
    </>
  );
}

/** Contextual date narrowing: previous/upcoming are bounded, today has none. */
function DateFilter({
  range,
  date,
  onChange,
}: {
  range: Range;
  date: string | undefined;
  onChange: (d: string | undefined) => void;
}) {
  // The Today tab is already one day. A date box there could only ever read
  // back the day the tab is named after, which is why it was disabled — and a
  // control that cannot be used is better absent than greyed out.
  if (range === 'today') return null;
  const bound =
    range === 'previous' ? { max: YESTERDAY_STR } : { min: TOMORROW_STR };
  return (
    <input
      className="input"
      type="date"
      value={date ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      {...bound}
      style={{ width: 150 }}
      aria-label={range === 'previous' ? 'Pick a previous date' : 'Pick an upcoming date'}
      title={range === 'previous' ? 'Pick a previous date' : 'Pick an upcoming date'}
    />
  );
}

function TabButton({
  label,
  active,
  pending,
  onClick,
}: {
  label: string;
  active: boolean;
  pending: number;
  onClick: () => void;
}) {
  return (
    <button
      className={`btn range-tab ${active ? 'btn-primary' : ''}`}
      onClick={onClick}
    >
      <span>{label}</span>
      {pending > 0 && (
        <span
          className="range-tab-count"
          style={{
            background: active ? '#fff' : 'var(--state-on-hold)',
            color: active ? 'var(--primary)' : '#fff',
          }}
        >
          {pending}
        </span>
      )}
    </button>
  );
}

function isDone(status: ConsultationStatus) {
  return status === 'done';
}

function RangeTable({
  range,
  search,
  date,
  status,
  onSelect,
}: {
  range: Range;
  search?: string;
  date?: string;
  status: StatusFilter;
  onSelect: (id: string) => void;
}) {
  const narrow = useMediaQuery(NARROW);
  const listQ = useQuery({
    queryKey: ['appointments', { range, search, date }],
    queryFn: () => appointmentsApi.list({ range, search, date }),
  });

  const filtered = useMemo(() => {
    const rows = listQ.data ?? [];
    if (status === 'all') return rows;
    if (status === 'done') return rows.filter((a) => isDone(a.consultation_status));
    return rows.filter((a) => !isDone(a.consultation_status));
  }, [listQ.data, status]);

  if (listQ.isLoading) return <Loading />;
  if (!listQ.data?.length) return <Empty>No appointments here.</Empty>;
  if (!filtered.length) return <Empty>No {status} appointments here.</Empty>;

  /*
   * On a phone the table did not fit, so it scrolled sideways — which hides the
   * status column exactly when the doctor is scanning for what still needs
   * doing, and makes tapping a row a two-handed job. A card puts the whole
   * appointment on screen at once and gives the tap a proper target.
   */
  if (narrow) {
    return (
      <div className="appt-cards">
        {filtered.map((a) => (
          <AppointmentCard
            key={a.id}
            a={a}
            showDate={range !== 'today'}
            onClick={() => onSelect(a.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Patient</th>
            <th>Mobile</th>
            <th>Age / Gender</th>
            {/* Every row on the Today tab carries today's date, so printing it
                on each of them says nothing — the time is the part that
                differs. The other two tabs span days and still need it. */}
            <th>{range === 'today' ? 'Time' : 'Date & time'}</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <AppointmentRow
              key={a.id}
              a={a}
              showDate={range !== 'today'}
              onClick={() => onSelect(a.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One appointment as a card — the phone equivalent of a table row. */
function AppointmentCard({
  a,
  showDate,
  onClick,
}: {
  a: Appointment;
  showDate: boolean;
  onClick: () => void;
}) {
  const when = `${showDate ? `${a.appointment_date} · ` : ''}${a.start_time?.slice(0, 5)}`;
  const who = [a.patient_age, a.patient_gender].filter(Boolean).join(' · ');

  return (
    <button type="button" className="appt-card" onClick={onClick}>
      <div className="appt-card-top">
        <span className="appt-card-name">
          {a.patient_name}
          {a.on_leave && (
            <span
              title="Doctor is on leave this day — reschedule this booking."
              style={{ marginLeft: 6, color: 'var(--state-on-hold)' }}
            >
              ⚠️
            </span>
          )}
        </span>
        <Badge value={a.consultation_status} />
      </div>
      <div className="appt-card-meta">
        <span>{a.patient_mobile}</span>
        {who && <span>· {who}</span>}
      </div>
      <div className="appt-card-meta">🕑 {when}</div>
    </button>
  );
}

function AppointmentRow({
  a,
  showDate,
  onClick,
}: {
  a: Appointment;
  showDate: boolean;
  onClick: () => void;
}) {
  return (
    <tr className="clickable-row" onClick={onClick}>
      <td style={{ fontWeight: 600 }}>
        {a.patient_name}
        {a.on_leave && (
          <span
            title="Doctor is on leave this day — reschedule this booking."
            style={{ marginLeft: 6, color: 'var(--state-on-hold)' }}
          >
            ⚠️
          </span>
        )}
      </td>
      <td className="muted">{a.patient_mobile}</td>
      <td className="muted">
        {[a.patient_age, a.patient_gender].filter(Boolean).join(' · ') || '—'}
      </td>
      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
        {showDate ? `${a.appointment_date} · ` : ''}
        {a.start_time?.slice(0, 5)}
      </td>
      <td><Badge value={a.consultation_status} /></td>
    </tr>
  );
}

function Tile({
  accent,
  icon,
  num,
  label,
}: {
  accent: 'blue' | 'teal' | 'amber' | 'gray';
  icon: string;
  num: number;
  label: string;
}) {
  const bar = {
    blue: 'var(--primary)',
    teal: 'var(--secondary)',
    amber: 'var(--state-on-hold)',
    gray: 'var(--state-booked)',
  }[accent];
  return (
    <div className={`card stat accent-${accent}`}>
      <div className="stat-bar" style={{ background: bar }} />
      <span className="ico">{icon}</span>
      <div className="num">{num}</div>
      <div className="label">{label}</div>
    </div>
  );
}
