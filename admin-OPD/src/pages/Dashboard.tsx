import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doctorsApi, appointmentsApi } from '../api/endpoints';
import type { Appointment, ConsultationStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { WalkInModal } from '../components/WalkInModal';
import { TopbarPortal } from '../components/TopbarPortal';
import { BookingQrModal } from '../components/BookingQr';
import { Badge, ConfirmDialog, Empty, FloatingCta, Loading, SearchField } from '../components/ui';
import { NARROW, useMediaQuery } from '../lib/useMediaQuery';
import { displayStatus, isCancelled, isMissed } from '../lib/appointmentStatus';
import { avatarTone, initials } from '../lib/avatar';
import { Download } from 'lucide-react';
import { useToast } from '../components/Toast';
import { useAnchoredMenu } from '../lib/anchoredMenu';
import {
  CheckCircleIcon,
  PhoneIcon,
  PlusPersonIcon,
  QrIcon,
  ResetIcon,
} from '../components/icons';

/**
 * The screen is one day at a time now.
 *
 * It used to be three range tabs — Previous / Today / Upcoming — with a date
 * filter popover beside them, which is two controls answering the same
 * question and neither of them "show me Thursday". The range was a client
 * invention anyway: the API takes a date, so a day navigator maps straight
 * onto it.
 */
type StatusFilter = 'all' | 'done' | 'pending' | 'missed';

/** Today in the clinic's own day, as YYYY-MM-DD. */
function todayISO(): string {
  const n = new Date();
  return [
    n.getFullYear(),
    String(n.getMonth() + 1).padStart(2, '0'),
    String(n.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Calendar arithmetic on a YYYY-MM-DD string, in whole days. */
function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d + days));
  return at.toISOString().slice(0, 10);
}

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  // "Fri, 25 September". Built from the parts rather than from one
  // `toLocaleDateString` call, because en-GB renders the weekday without the
  // comma the design has, and the comma is what stops it reading as a single
  // run-on phrase.
  const weekday = at.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const month = at.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return `${weekday}, ${d} ${month}`;
}

export default function Dashboard() {
  const { user, isDoctor } = useAuth();
  const navigate = useNavigate();
  const [day, setDay] = useState<string>(todayISO);
  const [status, setStatus] = useState<StatusFilter>('all');
  // The design folds the four figures away behind one. Opened, they are the
  // status filter — so the toolbar's separate filter popover is gone.
  const [statsOpen, setStatsOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<string | undefined>(undefined);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim() || undefined), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

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

  // Walk-ins — and with them new patients — are the doctor's to add. A staff
  // login with a role sees the queue and works it, but does not register
  // people into it; the client was explicit about that.
  const canCreate = isDoctor;
  const isToday = day === todayISO();
  const filtersActive = !!search || status !== 'all';

  const dayInputRef = useRef<HTMLInputElement>(null);
  /** Open the native calendar from anywhere on the date chip. */
  const openDayPicker = (e: React.MouseEvent) => {
    const el = dayInputRef.current;
    // Where `showPicker` does not exist, the label's own click-forwarding is
    // left to do whatever it did before — which is all there ever was.
    if (!el?.showPicker) return;
    // And where it does, that forwarding is stopped: a click arriving at the
    // input just after the picker opened closes it again.
    e.preventDefault();
    try {
      el.showPicker();
    } catch {
      // Thrown when the browser does not count this as a user gesture.
      el.focus();
    }
  };

  /*
   * The day's appointments, fetched here rather than inside the table: the
   * KPI figures are counts of these rows, and Export writes them. Reading
   * them from the global summary instead would make the tiles describe a
   * different set from the list under them.
   */
  const listQ = useQuery({
    queryKey: ['appointments', { day, search }],
    queryFn: () => appointmentsApi.list({ date: day, search }),
  });
  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      done: rows.filter((a) => isDone(a.consultation_status)).length,
      missed: rows.filter((a) => isMissed(a)).length,
      pending: rows.filter(
        (a) => isOpen(a.consultation_status) && !isCancelled(a) && !isMissed(a),
      ).length,
    }),
    [rows],
  );

  const shown = useMemo(() => {
    if (status === 'all') return rows;
    if (status === 'done') return rows.filter((a) => isDone(a.consultation_status));
    if (status === 'missed') return rows.filter((a) => isMissed(a));
    return rows.filter(
      (a) => isOpen(a.consultation_status) && !isCancelled(a) && !isMissed(a),
    );
  }, [rows, status]);

  /**
   * The day as a spreadsheet.
   *
   * Built in the browser from rows already on screen — the desk wants what it
   * is looking at, and a server-side export would be a second definition of
   * "the day" to keep in step with this one. Quoted properly: a patient's
   * name can contain a comma, and a CSV that breaks on one is worse than none.
   */
  const exportCsv = () => {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      ['Time', 'Patient', 'Mobile', 'Age', 'Gender', 'Status', 'Reports'],
      ...shown.map((a) => [
        a.start_time?.slice(0, 5) ?? '',
        a.patient_name,
        a.patient_mobile,
        a.patient_age ?? '',
        a.patient_gender ?? '',
        displayStatus(a),
        a.reports_count ?? 0,
      ]),
    ]
      .map((r) => r.map(cell).join(','))
      .join('\r\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `appointments-${day}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    setSearchInput('');
    setSearch(undefined);
    setStatus('all');
  };

  /*
   * The page used to block on `dashboardApi.summary` — it fed the four stat
   * tiles. The KPI figures are counts of the day's own rows now, so that
   * request is gone entirely rather than left fetching for nothing: an error
   * from it was taking down the whole screen, including a list that had
   * loaded perfectly well beside it.
   *
   * The list has its own loading and empty states inside `DayTable`, so the
   * header, the day axis and the KPI strip stay on screen while a day loads
   * instead of the page blanking to a spinner on every arrow press.
   */

  /*
   * The four tiles come out of the summary that was already being fetched:
   * "completed" is today's confirmed count less the ones still pending, and
   * "remaining" is that pending count. No new endpoint, no second request.
   */
  const doctorName = meQ.data?.name ?? user?.name ?? '';

  return (
    <>
      {/* On a phone the teal band is gone — the design spends that height on
          rows instead — and the doctor's initials live in the top bar. The
          band itself is hidden by CSS below 700px, not unmounted, so the
          wider layouts keep it untouched. */}
      <TopbarPortal>
        <span className="topbar-title">
          {!isDoctor && user ? (
            // Staff on a phone: who is signed in, and whose clinic it is.
            <>
              <span className="topbar-who">
                {user.name}
                {user.roleName && <span className="role-chip">{user.roleName}</span>}
              </span>
              <span className="topbar-sub">{doctorName}</span>
            </>
          ) : (
            'Appointments'
          )}
        </span>
        {meQ.data?.profile_photo_url ? (
          <img className="topbar-avatar" src={meQ.data.profile_photo_url} alt="" />
        ) : (
          <span className="topbar-avatar" aria-hidden title={doctorName}>
            {initials(doctorName)}
          </span>
        )}
      </TopbarPortal>

      {/*
        The teal DoctorHero band is gone. It named the doctor to the doctor on
        the screen they open most, and the design spends that height on rows
        instead; the name is in the sidebar and the top bar already.
      */}
      <div className="page-head">
        <h1>Appointments</h1>
        <div className="dash-head-actions">
          {meQ.data?.public_slug && (
            <button className="btn btn-sm" onClick={() => setQrOpen(true)}>
              <QrIcon size={16} />
              Clinic QR
            </button>
          )}
          {canCreate && (
            <FloatingCta>
              <button
                className="btn btn-primary"
                disabled={!doctorId}
                onClick={() => setWalkInOpen(true)}
              >
                <PlusPersonIcon size={17} />
                Walk-in
              </button>
            </FloatingCta>
          )}
        </div>
      </div>

      {/*
        One figure, with the rest behind a toggle.
        Four tiles were on screen permanently in four colours, which implied a
        relationship between the numbers that does not exist and spent the top
        of the page on something the doctor reads once. Opened, the four are
        also the status filter — click one and the list narrows — which is why
        the toolbar's separate filter popover went with them.
      */}
      {/* Filters and the list read as one surface: the toolbar acts on the
          rows directly below it, so a seam between them would be a lie. */}
      <div className="list-panel">
        <div className="list-panel-head dash-controls">
          {/*
            The day axis. `‹ Today [Fri, 25 September ▾] ›` — one control for
            the question the three range tabs and the date popover were
            splitting between them.
          */}
          <div className="day-nav">
            <button
              type="button"
              className="day-arrow"
              aria-label="Previous day"
              onClick={() => setDay((d) => shiftDay(d, -1))}
            >
              ‹
            </button>
            <button
              type="button"
              className={`day-today ${isToday ? 'is-today' : ''}`}
              onClick={() => setDay(todayISO())}
              disabled={isToday}
            >
              Today
            </button>
            {/*
              The whole chip opens the calendar, not just the ▾ at its end.
              The transparent `input` is stretched across the chip, but a
              click on a date input's text area does not open its picker in
              Chrome — only the calendar icon does, and that icon is invisible
              and an eighth of the chip wide — so the date read as a button
              that mostly did nothing. `showPicker` is asked for the one
              behaviour we actually want; where it does not exist the click
              still lands on the input underneath, which is the old behaviour
              rather than none.
            */}
            <label className="day-pick" onClick={openDayPicker}>
              <span>{dayLabel(day)}</span>
              {/* The browser's own date picker rather than a popover of our
                  own: it is the one control every phone already knows. */}
              <input
                ref={dayInputRef}
                type="date"
                value={day}
                aria-label="Pick a date"
                onChange={(e) => e.target.value && setDay(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="day-arrow"
              aria-label="Next day"
              onClick={() => setDay((d) => shiftDay(d, 1))}
            >
              ›
            </button>
          </div>

          <button
            type="button"
            className={`kpi kpi-total ${status === 'all' ? 'selected' : ''}`}
            onClick={() => setStatus('all')}
          >
            <span className="kpi-label">Total booked</span>
            <span className="kpi-num">{counts.total}</span>
          </button>

          {/* A switch: it turns a persistent view on and off, which is not
              what a link means. The label does not change with the state —
              the switch position already says which way it is. */}
          <button
            type="button"
            className="kpi-toggle"
            role="switch"
            aria-checked={statsOpen}
            aria-expanded={statsOpen}
            onClick={() => setStatsOpen((v) => !v)}
          >
            <span className="kpi-switch" aria-hidden />
            Show all statistics
          </button>

          <SearchField
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Search by name or mobile number"
            label="Search appointments"
          />

          <button
            className="reset-filters-btn"
            onClick={resetFilters}
            disabled={!filtersActive}
            title="Reset filters"
            aria-label="Reset filters"
          >
            <ResetIcon size={17} />
          </button>

          <button className="btn btn-sm dash-export" onClick={exportCsv} disabled={!rows.length}>
            <Download size={15} />
            Export
          </button>
        </div>

        {/*
          The other three figures drop in under the row rather than pushing it
          wider. They are the status filter as well as the count — click one
          and the list narrows — which is why the toolbar has no separate
          filter popover.
        */}
        {statsOpen && (
          <div className="kpi-drawer">
            <button
              type="button"
              className={`kpi ${status === 'done' ? 'selected' : ''}`}
              onClick={() => setStatus((v) => (v === 'done' ? 'all' : 'done'))}
            >
              <span className="kpi-label">Completed</span>
              <span className="kpi-num">{counts.done}</span>
            </button>
            <button
              type="button"
              className={`kpi ${status === 'pending' ? 'selected' : ''}`}
              onClick={() => setStatus((v) => (v === 'pending' ? 'all' : 'pending'))}
            >
              <span className="kpi-label">Pending</span>
              <span className="kpi-num">{counts.pending}</span>
            </button>
            <button
              type="button"
              className={`kpi ${status === 'missed' ? 'selected' : ''}`}
              onClick={() => setStatus((v) => (v === 'missed' ? 'all' : 'missed'))}
            >
              <span className="kpi-label">Missed</span>
              <span className="kpi-num">{counts.missed}</span>
            </button>
          </div>
        )}

        <DayTable
          rows={shown}
          canAct={canCreate}
          loading={listQ.isLoading}
          isToday={isToday}
          filtersActive={filtersActive}
          onSelect={(id) => navigate(`/appointments/${id}`)}
        />
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

/** "Female" → "F", "Male" → "M"; anything else as written (the design's own picker is F / M / Other). */
function shortGender(g: string | null | undefined) {
  const v = (g ?? '').trim();
  if (!v) return '';
  const first = v[0].toUpperCase();
  if (first === 'M' || first === 'F') return first;
  return v[0].toUpperCase() + v.slice(1).toLowerCase();
}

/**
 * "2 reports" for the meta line beside the age and gender — the one thing
 * about a visit a doctor wants to know before opening it, and the list
 * endpoint already sends the count (it omits the reports themselves).
 * Nothing is printed for a visit with none, so the line stays short.
 */
function reportsLabel(n: number | undefined) {
  if (!n) return '';
  return n === 1 ? '1 report' : `${n} reports`;
}

/** "09:30:00" → "9:30 AM", the way the design prints it. */
function fmtTime(t: string | null | undefined) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return t.slice(0, 5);
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function isDone(status: ConsultationStatus) {
  return status === 'done';
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

/**
 * The design's left accent bar: where this visit sits in the day.
 *
 * Past rows dim. A day the doctor has already worked through is reference,
 * and on any day but today every row is in that state — which is the honest
 * reading of a list you are looking back at.
 */
function bucketOf(a: Appointment, isToday: boolean, isNext: boolean): string {
  if (!isToday) return 'previous';
  // Anything that is over — seen, missed or called off — recedes to grey.
  if (!isOpen(a.consultation_status) || isCancelled(a)) return 'today-done';
  return isNext ? 'today-next' : 'today-wait';
}

/**
 * One day's list. Presentational — the page owns the query, because the KPI
 * figures above are counts of these same rows and must not come from a
 * different request.
 */
function DayTable({
  rows: filtered,
  loading,
  isToday,
  filtersActive,
  canAct,
  onSelect,
}: {
  rows: Appointment[];
  loading: boolean;
  isToday: boolean;
  filtersActive: boolean;
  /** False for a viewer who may read the queue but not work it. */
  canAct: boolean;
  onSelect: (id: string) => void;
}) {
  const narrow = useMediaQuery(NARROW);
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuFor(null), []);
  const { menuRef, style } = useAnchoredMenu(!!menuFor, menuBtn, closeMenu);

  const onSelectionChange = (next: Set<string>) => setSelected(next);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['appointments'] });
  };

  /** Marking a visit done from the list, without opening it. */
  const markDone = useMutation({
    mutationFn: (id: string) => appointmentsApi.setConsultation(id, 'done'),
    onSuccess: () => {
      refresh();
      toast.success('Marked as completed');
    },
    onError: (e) => toast.error(e),
  });

  /*
   * Cancel is the only thing in the row menu. Cancelling frees the slot and
   * keeps the row, so the day still reads as what happened; nothing on this
   * screen deletes an appointment.
   */
  const cancel = useMutation({
    mutationFn: (id: string) => appointmentsApi.setConsultation(id, 'rejected'),
    onSuccess: () => {
      refresh();
      setCancelling(null);
      toast.success('Appointment cancelled', 'The slot is free to book again.');
    },
    onError: (e) => {
      setCancelling(null);
      toast.error(e);
    },
  });

  const bulkDone = async () => {
    const ids = [...selected];
    for (const id of ids) {
      try {
        await appointmentsApi.setConsultation(id, 'done');
      } catch {
        // Keep going: one refusal should not strand the rest of the batch.
      }
    }
    setSelected(new Set());
    refresh();
    toast.success(`${ids.length} appointment${ids.length === 1 ? '' : 's'} marked as completed`);
  };

  /*
   * The first appointment still pending is the one the doctor is about to
   * see. Marking it is what turns a list into a queue — and only on today:
   * on any other day there is no "next".
   */
  const nextId = useMemo(() => {
    if (!isToday) return null;
    return (
      filtered.find((a) => isOpen(a.consultation_status) && !isCancelled(a))?.id ?? null
    );
  }, [filtered, isToday]);

  if (loading) return <Loading />;
  if (!filtered.length) {
    return (
      <Empty>
        {filtersActive
          ? 'No appointments match your search or filters.'
          : isToday
            ? 'No appointments today.'
            : 'No appointments on this day.'}
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
    // Every row is the same date now, so the date-group headings the three
    // range tabs needed are gone with them.
    return (
      <div className="appt-cards">
        {filtered.map((a) => (
          <AppointmentCard
            key={a.id}
            a={a}
            bucket={bucketOf(a, isToday, a.id === nextId)}
            isNext={a.id === nextId}
            onClick={() => onSelect(a.id)}
          />
        ))}
      </div>
    );
  }

  const allSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id));

  return (
    <div className="table-wrap">
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>
            {selected.size} selected
          </span>
          {canAct && (
            <button className="btn btn-sm" onClick={bulkDone}>
              Mark as completed
            </button>
          )}
          <button className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      <table className="appt-table">
        <thead>
          <tr>
            {/* Bulk select is desktop-only by design — a phone row is a card
                with no room for a checkbox, and the actions it enables are
                desk work rather than something done between patients. */}
            <th className="c-check">
              <input
                type="checkbox"
                aria-label="Select every appointment"
                checked={allSelected}
                onChange={(e) =>
                  onSelectionChange(
                    e.target.checked ? new Set(filtered.map((a) => a.id)) : new Set(),
                  )
                }
              />
            </th>
            <th>Patient</th>
            <th>Contact</th>
            <th>Reports</th>
            <th>Status</th>
            {/* One day per view, so every row carries the same date and only
                the time differs. */}
            <th>Time</th>
            <th className="c-actions" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <AppointmentRow
              key={a.id}
              a={a}
              bucket={bucketOf(a, isToday, a.id === nextId)}
              isNext={a.id === nextId}
              checked={selected.has(a.id)}
              onCheck={(next) => {
                const s = new Set(selected);
                if (next) s.add(a.id);
                else s.delete(a.id);
                setSelected(s);
              }}
              onMarkDone={() => markDone.mutate(a.id)}
              markingDone={markDone.isPending}
              menuOpen={menuFor === a.id}
              onMenu={() => setMenuFor((v) => (v === a.id ? null : a.id))}
              menuRef={menuFor === a.id ? menuBtn : nullRef}
              onClick={() => onSelect(a.id)}
            />
          ))}
        </tbody>
      </table>

      {menuFor && (
        <div ref={menuRef} className="action-menu-dropdown" style={{ ...style, zIndex: 70 }}>
          <button
            className="action-menu-item danger"
            onClick={() => {
              const row = filtered.find((x) => x.id === menuFor) ?? null;
              setMenuFor(null);
              setCancelling(row);
            }}
          >
            Cancel appointment
          </button>
        </div>
      )}

      {cancelling && (
        <ConfirmDialog
          title="Cancel this appointment?"
          message={
            <>
              {cancelling.patient_name}'s {cancelling.start_time?.slice(0, 5)} slot is
              freed and can be booked again. The row stays on the day, marked
              cancelled.
            </>
          }
          confirmLabel="Cancel it"
          cancelLabel="Keep it"
          destructive
          busy={cancel.isPending}
          onConfirm={() => cancel.mutate(cancelling.id)}
          onCancel={() => setCancelling(null)}
        />
      )}
    </div>
  );
}

/** A stable placeholder, so a row that owns no open menu passes a real ref. */
const nullRef = { current: null } as React.RefObject<HTMLButtonElement | null>;

/**
 * One appointment as a card — the phone and tablet equivalent of a row.
 *
 * The person, the contact, the time, and how many reports the visit carries.
 * The count rides the age-and-gender line rather than a strip of its own —
 * the strip the design once carried made every card a different height, which
 * is why it was dropped; a few more words on a line that is already there
 * costs nothing. The "Note added" strip stays gone: it belongs on the visit.
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
  const missed = isMissed(a);
  const over = done || cancelled || missed || a.consultation_status === 'no_show';
  // "M · 29 yrs · 2 reports", so the line has room for the number beside it
  // and the card stays two rows tall whatever the name and number are.
  const who = [
    shortGender(a.patient_gender),
    a.patient_age && `${a.patient_age} yrs`,
    reportsLabel(a.reports_count),
  ]
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
            {missed && <span className="appt-badge missed">Missed</span>}
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
  isNext,
  checked,
  onCheck,
  onMarkDone,
  markingDone,
  menuOpen,
  onMenu,
  menuRef,
  onClick,
}: {
  a: Appointment;
  bucket: string;
  isNext: boolean;
  checked: boolean;
  onCheck: (next: boolean) => void;
  onMarkDone: () => void;
  markingDone: boolean;
  menuOpen: boolean;
  onMenu: () => void;
  menuRef: React.RefObject<HTMLButtonElement | null>;
  onClick: () => void;
}) {
  // The report count has a column of its own now, so it comes off this line.
  const who = [
    // Capitalised, as the design has it — the column stores "female".
    a.patient_gender && a.patient_gender[0].toUpperCase() + a.patient_gender.slice(1),
    a.patient_age && `${a.patient_age} yrs`,
    a.description?.trim() || null,
  ]
    .filter(Boolean)
    .join(' · ');

  const over =
    isDone(a.consultation_status) || isCancelled(a) || isMissed(a);

  return (
    <tr className={`clickable-row appt-row ${bucket}`} onClick={onClick}>
      {/* Stops a tick or a menu press opening the visit underneath it. */}
      <td className="c-check" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${a.patient_name}`}
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
        />
      </td>
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
            {/* Age, gender and the report count fold under the name rather
                than taking columns of their own, which is what the design's
                table does. */}
            {who && <span className="row-sub">{who}</span>}
          </span>
        </span>
      </td>
      <td className="muted">{a.patient_mobile}</td>
      {/* A column of its own, as the design has it: a paperclip and a count,
          or a dash when the visit carries nothing. */}
      <td className="c-reports muted">
        {a.reports_count ? (
          <span className="rep-count">
            <ClipIcon />
            {a.reports_count}
          </span>
        ) : (
          <span aria-label="No reports">—</span>
        )}
      </td>
      <td>
        {/* A patient's own cancellation lives on the appointment, not the
            consultation; it reads the same as the clinic's. A stale pending
            reads as Missed. */}
        <Badge value={displayStatus(a)} />
      </td>
      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
        {a.start_time?.slice(0, 5)}
      </td>
      <td className="c-actions" onClick={(e) => e.stopPropagation()}>
        <div className="row-actions">
          {/* Marking a visit done without opening it — the desk's move when
              the patient has already been seen and left. Greyed once the
              visit is over rather than hidden, so the column does not jump
              about as the day fills in. */}
          <button
            type="button"
            className={`row-act done ${over ? 'is-over' : ''}`}
            disabled={over || markingDone}
            title={over ? displayStatus(a) : 'Mark as completed'}
            aria-label={over ? displayStatus(a) : 'Mark as completed'}
            onClick={onMarkDone}
          >
            <CheckCircleIcon size={17} />
          </button>
          <button
            ref={menuRef as React.RefObject<HTMLButtonElement>}
            type="button"
            className="row-act"
            aria-label="More actions"
            aria-expanded={menuOpen}
            onClick={onMenu}
          >
            ⋮
          </button>
        </div>
      </td>
    </tr>
  );
}

/** A paperclip, for the reports column. */
function ClipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l8-8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

