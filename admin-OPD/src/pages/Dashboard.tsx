import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, doctorsApi, appointmentsApi } from '../api/endpoints';
import type { Appointment, ConsultationStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { WalkInModal } from '../components/WalkInModal';
import { Badge, Empty, Loading } from '../components/ui';

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
const TODAY_STR = toDateStr(new Date());
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
            + Walk-in
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
                  <option value="done">Done</option>
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

/** Contextual date narrowing: today is fixed, previous/upcoming are bounded. */
function DateFilter({
  range,
  date,
  onChange,
}: {
  range: Range;
  date: string | undefined;
  onChange: (d: string | undefined) => void;
}) {
  if (range === 'today') {
    return (
      <input
        className="input"
        type="date"
        value={TODAY_STR}
        disabled
        title="Today"
        style={{ width: 150 }}
        aria-label="Date"
      />
    );
  }
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

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Patient</th>
            <th>Mobile</th>
            <th>Age / Gender</th>
            <th>Date &amp; time</th>
            <th>Reports</th>
            <th>Source</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <AppointmentRow key={a.id} a={a} onClick={() => onSelect(a.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AppointmentRow({ a, onClick }: { a: Appointment; onClick: () => void }) {
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
        {a.appointment_date} · {a.start_time?.slice(0, 5)}
      </td>
      <td>
        <ReportsCell count={a.reports_count ?? 0} />
      </td>
      <td>{a.source === 'walk_in' ? <Badge value="walk_in" label="Walk-in" /> : <span className="muted" style={{ textTransform: 'capitalize' }}>{a.source}</span>}</td>
      <td><Badge value={a.consultation_status} /></td>
    </tr>
  );
}

/**
 * How many reports the patient attached to this visit. Reads as a quiet dash
 * when there are none, so a row with reports stands out at a glance.
 */
function ReportsCell({ count }: { count: number }) {
  if (count === 0) return <span className="muted">—</span>;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 9px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: 'var(--primary-tint)',
        color: 'var(--primary)',
        whiteSpace: 'nowrap',
      }}
      title={`${count} report${count > 1 ? 's' : ''} uploaded`}
    >
      📄 {count}
    </span>
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
