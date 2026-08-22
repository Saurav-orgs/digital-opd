import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, doctorsApi, appointmentsApi } from '../api/endpoints';
import type { Appointment } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { WalkInModal } from '../components/WalkInModal';
import { Badge, Empty, Loading } from '../components/ui';

type Range = 'previous' | 'today' | 'upcoming';

export default function Dashboard() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('today');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<string | undefined>(undefined);
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

  if (isLoading) return <Loading />;
  if (error) return <Empty>Could not load the dashboard.</Empty>;
  if (!data) return null;

  return (
    <>
      <div className="page-head" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Dashboard</h1>
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

      <div className="grid stat-tiles" style={{ marginBottom: 20 }}>
        <Tile accent="blue" icon="🗓" num={data.total} label="Today" />
        <Tile accent="gray" icon="📅" num={data.upcoming} label="Upcoming" />
        <Tile accent="gray" icon="🕓" num={data.previous} label="Previous" />
      </div>

      <div className="card" style={{ marginBottom: 20, padding: '20px 22px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Big Search Input */}
          <div style={{ position: 'relative', width: '100%' }}>
            <span
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 16,
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
              style={{
                width: '100%',
                padding: '12px 16px 12px 42px',
                fontSize: 15,
                borderRadius: 8,
              }}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          {/* Big Tab Buttons */}
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <TabButton
              label="Previous"
              active={range === 'previous'}
              pending={data.pending.previous}
              onClick={() => setRange('previous')}
            />
            <TabButton
              label="Today"
              active={range === 'today'}
              pending={data.pending.today}
              onClick={() => setRange('today')}
            />
            <TabButton
              label="Upcoming"
              active={range === 'upcoming'}
              pending={data.pending.upcoming}
              onClick={() => setRange('upcoming')}
            />
          </div>
        </div>
      </div>

      <RangeList range={range} search={search} onSelect={(id) => navigate(`/appointments/${id}`)} />

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
    <button
      className={`btn ${active ? 'btn-primary' : ''}`}
      onClick={onClick}
      style={{
        padding: '10px 24px',
        fontSize: 15,
        fontWeight: 600,
        borderRadius: 8,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span>{label}</span>
      {pending > 0 && (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
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
