import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, doctorsApi, appointmentsApi } from '../api/endpoints';
import type { Appointment } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AppointmentDetail } from '../components/AppointmentDetail';
import { WalkInModal } from '../components/WalkInModal';
import { Badge, Empty, Loading } from '../components/ui';

type Range = 'previous' | 'today' | 'upcoming';

export default function Dashboard() {
  const { user, can } = useAuth();
  const [range, setRange] = useState<Range>('today');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim() || undefined), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

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
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (isLoading) return <Loading />;
  if (error) return <Empty>Could not load the dashboard.</Empty>;
  if (!data) return null;

  const done = data.byStatus['done'] ?? 0;
  const onHold = data.byStatus['on_hold'] ?? 0;
  const pending = data.byStatus['pending'] ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {greeting}, {user?.name?.split(' ')[0]} 👋
          </h1>
          <p className="muted">Here’s what’s happening · {data.date}</p>
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

      <div className="grid stat-tiles" style={{ marginBottom: 16 }}>
        <Tile accent="blue" icon="🗓" num={data.total} label="Today" />
        <Tile accent="gray" icon="📅" num={data.upcoming} label="Upcoming" />
        <Tile accent="gray" icon="🕓" num={data.previous} label="Previous" />
        <Tile accent="teal" icon="✔" num={done} label="Today's done" />
        <Tile accent="amber" icon="⏸" num={onHold} label="Today's on hold" />
        <Tile accent="blue" icon="⏳" num={pending} label="Today's pending" />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input
            className="input"
            type="search"
            placeholder="Search name or phone…"
            style={{ width: 260 }}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <TabButton label="Previous" active={range === 'previous'} pending={data.pending.previous} onClick={() => setRange('previous')} />
          <TabButton label="Today" active={range === 'today'} pending={data.pending.today} onClick={() => setRange('today')} />
          <TabButton label="Upcoming" active={range === 'upcoming'} pending={data.pending.upcoming} onClick={() => setRange('upcoming')} />
        </div>
      </div>

      <RangeList range={range} search={search} onSelect={setSelected} />

      {selected && <AppointmentDetail id={selected} onClose={() => setSelected(null)} />}
      {walkInOpen && doctorId && (
        <WalkInModal doctorId={doctorId} onClose={() => setWalkInOpen(false)} />
      )}
    </>
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
    <button className={`btn btn-sm ${active ? 'btn-primary' : ''}`} onClick={onClick}>
      {label}
      {pending > 0 && (
        <span
          style={{
            marginLeft: 6,
            padding: '1px 6px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            background: 'var(--state-on-hold)',
            color: '#fff',
          }}
        >
          {pending}
        </span>
      )}
    </button>
  );
}

function RangeList({
  range,
  search,
  onSelect,
}: {
  range: Range;
  search?: string;
  onSelect: (id: string) => void;
}) {
  const listQ = useQuery({
    queryKey: ['appointments', { range, search }],
    queryFn: () => appointmentsApi.list({ range, search }),
  });

  if (listQ.isLoading) return <Loading />;
  if (!listQ.data?.length) return <Empty>No appointments here.</Empty>;

  return (
    <div className="stack" style={{ gap: 10 }}>
      {listQ.data.map((a) => (
        <AppointmentCard key={a.id} a={a} onClick={() => onSelect(a.id)} />
      ))}
    </div>
  );
}

function AppointmentCard({ a, onClick }: { a: Appointment; onClick: () => void }) {
  return (
    <div className="card clickable-row" onClick={onClick}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontWeight: 600 }}>{a.patient_name}</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {a.appointment_date} · {a.start_time?.slice(0, 5)}
        </span>
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{a.patient_mobile}</div>
      {a.on_leave && (
        <div
          className="row"
          style={{
            marginTop: 10,
            padding: '8px 10px',
            borderRadius: 8,
            background: '#fbf1e0',
            color: 'var(--state-on-hold)',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          Doctor is on leave this day — reschedule this booking.
        </div>
      )}
      <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
        {a.source === 'walk_in' && <Badge value="walk_in" label="Walk-in" />}
        <Badge value={a.consultation_status} />
      </div>
    </div>
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
