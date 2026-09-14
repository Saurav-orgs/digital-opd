import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, doctorsApi, appointmentsApi } from '../api/endpoints';
import type { Appointment, ConsultationStatus, Doctor } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { WalkInModal } from '../components/WalkInModal';
import { TopbarPortal } from '../components/TopbarPortal';
import { BookingQrModal } from '../components/BookingQr';
import { Badge, Empty, Loading } from '../components/ui';
import { NARROW, useMediaQuery } from '../lib/useMediaQuery';
import { avatarTone, initials } from '../lib/avatar';
import {
  CalendarIcon,
  CheckCircleIcon,
  FilterIcon,
  PhoneIcon,
  PlusPersonIcon,
  QrIcon,
  ResetIcon,
  SearchIcon,
} from '../components/icons';

type Range = 'previous' | 'today' | 'upcoming';
/** Matches the design's popover: All is the default, not Pending. */
type StatusFilter = 'all' | 'pending' | 'done';

const STATUS_LABEL: Record<StatusFilter, string> = {
  all: 'All',
  pending: 'Pending',
  done: 'Completed',
};

export default function Dashboard() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('today');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [date, setDate] = useState<string | undefined>(undefined);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<string | undefined>(undefined);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim() || undefined), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.summary,
  });

  /*
   * The hero names the doctor. `/doctors/me` carries no permission guard — any
   * account with a doctorId can read its own profile — so this needs no backend
   * change. A super admin has no doctorId and gets the plain header.
   */
  const meQ = useQuery({
    queryKey: ['doctors', 'me'],
    queryFn: doctorsApi.me,
    enabled: !!user?.doctorId,
  });

  // Doctor to book walk-ins for: every clinic account is linked to the single
  // doctor profile, so the link answers it; the list is only a fallback for an
  // unlinked account.
  const doctorsQ = useQuery({
    queryKey: ['doctors'],
    queryFn: doctorsApi.list,
    enabled: !user?.doctorId,
  });
  const doctorId = user?.doctorId ?? doctorsQ.data?.[0]?.id;

  const canCreate = can('appointments', 'create');
  const filtersActive = !!search || status !== 'all' || !!date;

  const resetFilters = () => {
    setSearchInput('');
    setSearch(undefined);
    setStatus('all');
    setDate(undefined);
  };

  if (isLoading) return <Loading />;
  if (error) return <Empty>Could not load the appointments.</Empty>;
  if (!data) return null;

  /*
   * The four tiles come out of the summary that was already being fetched:
   * "completed" is today's confirmed count less the ones still pending, and
   * "remaining" is that pending count. No new endpoint, no second request.
   */
  const completedToday = Math.max(0, data.total - data.pending.today);

  const doctorName = meQ.data?.name ?? user?.name ?? '';

  return (
    <>
      {/* On a phone the teal band is gone — the design spends that height on
          rows instead — and the doctor's initials live in the top bar. The
          band itself is hidden by CSS below 700px, not unmounted, so the
          wider layouts keep it untouched. */}
      <TopbarPortal>
        <span className="topbar-title">Appointments</span>
        {meQ.data?.profile_photo_url ? (
          <img className="topbar-avatar" src={meQ.data.profile_photo_url} alt="" />
        ) : (
          <span className="topbar-avatar" aria-hidden title={doctorName}>
            {initials(doctorName)}
          </span>
        )}
      </TopbarPortal>

      <DoctorHero doctor={meQ.data} fallbackName={user?.name ?? ''} />

      <div className="stat-row">
        <StatTile accent="teal" icon={<CalendarIcon size={20} />} num={data.total} label="Today" />
        <StatTile
          accent="marigold"
          icon={<CheckCircleIcon size={20} />}
          num={completedToday}
          label="Completed"
        />
        <StatTile
          accent="berry"
          icon={<HourglassIcon />}
          num={data.pending.today}
          label="Remaining"
        />
        <StatTile accent="sky" icon={<CalendarIcon size={20} />} num={data.upcoming} label="Upcoming" />
      </div>

      {/* Filters and the list read as one surface: the toolbar acts on the
          rows directly below it, so a seam between them would be a lie. */}
      <div className="list-panel">
        <div className="list-panel-head">
          <div className="dash-toolbar">
            <div className="dash-search">
              <span className="dash-search-icon" aria-hidden>
                <SearchIcon size={17} />
              </span>
              <input
                className="input"
                type="search"
                placeholder="Search by name or mobile number"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>

            <div className="dash-toolbar-filters">
              <FilterPopover
                label={STATUS_LABEL[status]}
                active={status !== 'all'}
                icon={<FilterIcon size={16} />}
              >
                {(close) =>
                  (Object.keys(STATUS_LABEL) as StatusFilter[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`filter-opt ${status === key ? 'selected' : ''}`}
                      onClick={() => {
                        setStatus(key);
                        close();
                      }}
                    >
                      {STATUS_LABEL[key]}
                    </button>
                  ))
                }
              </FilterPopover>

              <FilterPopover
                label={date ? prettyShortDate(date) : 'Date'}
                active={!!date}
                icon={<CalendarIcon size={16} />}
              >
                {(close) => (
                  <>
                    <button
                      type="button"
                      className={`filter-opt ${!date ? 'selected' : ''}`}
                      onClick={() => {
                        setDate(undefined);
                        close();
                      }}
                    >
                      Any date
                    </button>
                    <div className="filter-date">
                      <input
                        className="input"
                        type="date"
                        value={date ?? ''}
                        onChange={(e) => {
                          setDate(e.target.value || undefined);
                          close();
                        }}
                        aria-label="Filter by date"
                      />
                    </div>
                  </>
                )}
              </FilterPopover>

              <button
                className="reset-filters-btn"
                onClick={resetFilters}
                disabled={!filtersActive}
                title="Reset filters"
                aria-label="Reset filters"
              >
                <ResetIcon size={17} />
              </button>
            </div>
          </div>

          {/* Range tabs — always one row, sized down on narrow screens. */}
          <div className="range-tabs">
            <TabButton
              label="Previous"
              active={range === 'previous'}
              count={data.previous}
              pending={data.pending.previous}
              onClick={() => setRange('previous')}
            />
            <TabButton
              label="Today"
              active={range === 'today'}
              count={data.total}
              pending={data.pending.today}
              onClick={() => setRange('today')}
            />
            <TabButton
              label="Upcoming"
              active={range === 'upcoming'}
              count={data.upcoming}
              pending={data.pending.upcoming}
              onClick={() => setRange('upcoming')}
            />
          </div>
        </div>

        <RangeTable
          range={range}
          search={search}
          date={date}
          status={status}
          filtersActive={filtersActive}
          onSelect={(id) => navigate(`/appointments/${id}`)}
        />
      </div>

      {/*
        The design floats the walk-in action rather than filing it in the
        toolbar. It is the one thing on this screen that creates something, and
        it has to be reachable with the list scrolled to any position — the
        front desk books a walk-in while looking at the queue, not at the top
        of the page.
      */}
      <div className="fab-row">
        {/* The booking QR next to it: the other thing the desk is asked for
            while looking at the queue is "how do I book next time?". */}
        {meQ.data?.public_slug && (
          <button
            className="fab-walkin fab-qr"
            onClick={() => setQrOpen(true)}
            title="Booking QR code"
            aria-label="Booking QR code"
          >
            <QrIcon size={19} />
            <span>QR</span>
          </button>
        )}
        {canCreate && (
          <button
            className="fab-walkin"
            disabled={!doctorId}
            onClick={() => setWalkInOpen(true)}
          >
            <PlusPersonIcon size={19} />
            <span>Walk In</span>
          </button>
        )}
      </div>

      {walkInOpen && doctorId && (
        <WalkInModal doctorId={doctorId} onClose={() => setWalkInOpen(false)} />
      )}
      {qrOpen && meQ.data && (
        <BookingQrModal doctor={meQ.data} onClose={() => setQrOpen(false)} />
      )}
    </>
  );
}

function HourglassIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 3h10M7 21h10M8 3v3.5c0 2 4 3.4 4 5.5s-4 3.5-4 5.5V21M16 3v3.5c0 2-4 3.4-4 5.5s4 3.5 4 5.5V21" />
    </svg>
  );
}

/** "Female" → "F", "Male" → "M"; anything else as written (the design's own picker is F / M / Other). */
function shortGender(g: string | null | undefined) {
  const v = (g ?? '').trim();
  if (!v) return '';
  const first = v[0].toUpperCase();
  if (first === 'M' || first === 'F') return first;
  return v[0].toUpperCase() + v.slice(1).toLowerCase();
}

/** "09:30:00" → "9:30 AM", the way the design prints it. */
function fmtTime(t: string | null | undefined) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return t.slice(0, 5);
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Heading over a day's cards: "Yesterday", "Tomorrow", or "Wed, 2 Sept". */
function dateGroupLabel(date: string) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const offset = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  if (offset === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "2026-09-04" → "4 Sep". */
function prettyShortDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * A filter button with a panel under it.
 *
 * The design uses these rather than native selects because the date filter has
 * two controls in one panel ("Any date" and a picker), which a `<select>`
 * cannot hold. Both filters use it so they read as one row.
 */
function FilterPopover({
  label,
  active,
  icon,
  children,
}: {
  label: string;
  active: boolean;
  icon: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="filter-btn-wrap" ref={wrapRef}>
      <button
        className={`filter-btn ${active ? 'active-filter' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {icon}
        <span>{label}</span>
      </button>
      {open && <div className="filter-panel">{children(() => setOpen(false))}</div>}
    </div>
  );
}

/**
 * Who the doctor is. The clinic line and the date that used to sit under the
 * name are gone — the updated design drops both, and neither was telling the
 * doctor something they did not know.
 */
function DoctorHero({
  doctor,
  fallbackName,
}: {
  doctor: Doctor | undefined;
  fallbackName: string;
}) {
  const name = doctor?.name ?? fallbackName;
  const meta = [doctor?.qualifications, doctor?.specialization]
    .filter(Boolean)
    .join(' · ');

  return (
    <header className="doc-hero">
      <div className="doc-hero-top">
        {doctor?.profile_photo_url ? (
          <img className="doc-avatar" src={doctor.profile_photo_url} alt="" />
        ) : (
          <span className="doc-avatar" aria-hidden>
            {initials(name)}
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <h1 className="doc-name">{name}</h1>
          {meta && <div className="doc-meta">{meta}</div>}
        </div>
      </div>
    </header>
  );
}

function TabButton({
  label,
  active,
  count,
  pending,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  pending: number;
  onClick: () => void;
}) {
  return (
    <button
      className={`range-tab ${active ? 'active' : ''}`}
      onClick={onClick}
      title={pending > 0 ? `${pending} still to see` : undefined}
    >
      <span>{label}</span>
      <span className="range-tab-count">({count})</span>
      {/* The amber dot is the only thing that says "there is work left here" —
          the count beside it is the whole tab, done and undone together. */}
      {pending > 0 && !active && <span className="range-tab-dot" aria-hidden />}
    </button>
  );
}

function isDone(status: ConsultationStatus) {
  return status === 'done';
}

/**
 * Called off, by either side: the clinic cancelling sets the consultation to
 * `rejected`; a patient withdrawing their own booking sets the appointment
 * itself to `cancelled`. Both read as "Cancelled" on the list.
 */
function isCancelled(a: Appointment) {
  return a.consultation_status === 'rejected' || a.status === 'cancelled';
}

/**
 * Is this visit still waiting on the doctor?
 *
 * Not simply "not done": a no-show never happened and a cancelled visit was
 * called off, so neither is work left to do. Counting them as pending would
 * put them in the Pending filter and, worse, mark one of them as the patient
 * the doctor is about to see.
 */
function isOpen(status: ConsultationStatus) {
  return status === 'pending' || status === 'on_hold';
}

/** The design's left accent bar: where this visit sits in the day. */
function bucketOf(a: Appointment, range: Range, isNext: boolean): string {
  if (range === 'previous') return 'previous';
  if (range === 'upcoming') return 'upcoming';
  // Anything that is over — seen, missed or called off — recedes to grey.
  if (!isOpen(a.consultation_status) || isCancelled(a)) return 'today-done';
  return isNext ? 'today-next' : 'today-wait';
}

function RangeTable({
  range,
  search,
  date,
  status,
  filtersActive,
  onSelect,
}: {
  range: Range;
  search?: string;
  date?: string;
  status: StatusFilter;
  filtersActive: boolean;
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
    return rows.filter((a) => isOpen(a.consultation_status));
  }, [listQ.data, status]);

  /*
   * The first appointment of the day that is still pending is the one the
   * doctor is about to see. Marking it is what turns a list into a queue.
   */
  const nextId = useMemo(() => {
    if (range !== 'today') return null;
    return (
      filtered.find((a) => isOpen(a.consultation_status) && !isCancelled(a))?.id ?? null
    );
  }, [filtered, range]);

  if (listQ.isLoading) return <Loading />;
  if (!filtered.length) {
    return (
      <Empty>
        {filtersActive
          ? 'No appointments match your search or filters.'
          : `No ${range === 'today' ? 'appointments today' : `${range} appointments`}.`}
      </Empty>
    );
  }

  /*
   * Below the desktop breakpoint the table did not fit, so it scrolled
   * sideways — which hides the status column exactly when the doctor is
   * scanning for what still needs doing, and makes tapping a row a two-handed
   * job. A card puts the whole appointment on screen at once.
   */
  if (narrow) {
    // The server already orders Previous newest-first and Upcoming
    // soonest-first, so a heading goes in wherever the date changes. Today
    // is one day and needs none.
    let lastDate: string | null = null;
    return (
      <div className="appt-cards">
        {filtered.map((a) => {
          const heading =
            range !== 'today' && a.appointment_date !== lastDate
              ? dateGroupLabel(a.appointment_date)
              : null;
          lastDate = a.appointment_date;
          return (
            <Fragment key={a.id}>
              {heading && <div className="date-group">{heading}</div>}
              <AppointmentCard
                a={a}
                bucket={bucketOf(a, range, a.id === nextId)}
                isNext={a.id === nextId}
                onClick={() => onSelect(a.id)}
              />
            </Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Patient</th>
            <th>Contact</th>
            <th>Status</th>
            {/* Every row on the Today tab carries today's date, so printing it
                on each of them says nothing — the time is the part that
                differs. The other two tabs span days and still need it. */}
            <th>{range === 'today' ? 'Time' : 'Date & time'}</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <AppointmentRow
              key={a.id}
              a={a}
              bucket={bucketOf(a, range, a.id === nextId)}
              showDate={range !== 'today'}
              isNext={a.id === nextId}
              onClick={() => onSelect(a.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One appointment as a card — the phone and tablet equivalent of a row.
 *
 * Deliberately just the person, the contact and the time. The reports count
 * and "Note added" strip the design once carried were dropped from the list:
 * they made every card a different height and belong on the visit itself.
 * The date is not on the card either — Previous and Upcoming group their
 * cards under a date heading instead, so it would only repeat that.
 */
function AppointmentCard({
  a,
  bucket,
  isNext,
  onClick,
}: {
  a: Appointment;
  bucket: string;
  isNext: boolean;
  onClick: () => void;
}) {
  const done = isDone(a.consultation_status);
  const cancelled = isCancelled(a);
  const over = done || cancelled || a.consultation_status === 'no_show';
  // "M · 29 yrs", so the line has room for the number beside it and the card
  // stays two rows tall whatever the name and number are.
  const who = [shortGender(a.patient_gender), a.patient_age && `${a.patient_age} yrs`]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`appt-card ${bucket}`} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="appt-card-main">
        <span className={`appt-avatar ${avatarTone(a.patient_name)}`} aria-hidden>
          {initials(a.patient_name)}
        </span>
        <div className="appt-body">
          <div className="appt-card-top">
            <span className="appt-card-name">{a.patient_name}</span>
            {isNext && <span className="appt-badge next">Next</span>}
            {done && <span className="appt-badge done">Completed</span>}
            {cancelled && <span className="appt-badge cancelled">Cancelled</span>}
            {!cancelled && a.consultation_status === 'no_show' && (
              <span className="appt-badge no-show">No-show</span>
            )}
            {a.on_leave && (
              <span
                className="appt-badge leave"
                title="Doctor is on leave this day — reschedule this booking."
              >
                ⚠️ On leave
              </span>
            )}
          </div>
          {who && <div className="appt-meta">{who}</div>}
          <a
            className="appt-phone"
            href={`tel:${a.patient_mobile}`}
            onClick={(e) => e.stopPropagation()}
          >
            <PhoneIcon />
            {a.patient_mobile}
          </a>
        </div>
        <span className={`appt-time-badge ${over ? 'is-done' : ''}`}>
          {fmtTime(a.start_time)}
        </span>
      </div>
    </div>
  );
}

function AppointmentRow({
  a,
  bucket,
  showDate,
  isNext,
  onClick,
}: {
  a: Appointment;
  bucket: string;
  showDate: boolean;
  isNext: boolean;
  onClick: () => void;
}) {
  const who = [a.patient_gender, a.patient_age && `${a.patient_age} yrs`]
    .filter(Boolean)
    .join(' · ');

  return (
    <tr className={`clickable-row appt-row ${bucket}`} onClick={onClick}>
      <td>
        <span className="row-name-cell">
          <span className={`appt-avatar sm ${avatarTone(a.patient_name)}`} aria-hidden>
            {initials(a.patient_name)}
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="row-name">
              {a.patient_name}
              {isNext && <span className="appt-badge next">Next</span>}
              {a.on_leave && (
                <span
                  title="Doctor is on leave this day — reschedule this booking."
                  style={{ marginLeft: 6, color: 'var(--state-on-hold)' }}
                >
                  ⚠️
                </span>
              )}
            </span>
            {/* Age and gender fold under the name rather than taking a column
                of their own, which is what the design's table does. */}
            {who && <span className="row-sub">{who}</span>}
          </span>
        </span>
      </td>
      <td className="muted">{a.patient_mobile}</td>
      <td>
        {/* A patient's own cancellation lives on the appointment, not the
            consultation; it reads the same as the clinic's. */}
        <Badge value={isCancelled(a) ? 'rejected' : a.consultation_status} />
      </td>
      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
        {showDate ? `${a.appointment_date} · ` : ''}
        {a.start_time?.slice(0, 5)}
      </td>
    </tr>
  );
}

function StatTile({
  accent,
  icon,
  num,
  label,
}: {
  accent: 'teal' | 'marigold' | 'berry' | 'sky';
  icon: React.ReactNode;
  num: number;
  label: string;
}) {
  return (
    <div className={`stat-tile ${accent}`}>
      <span className="stat-icon" aria-hidden>
        {icon}
      </span>
      <div className="stat-num">{num}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
