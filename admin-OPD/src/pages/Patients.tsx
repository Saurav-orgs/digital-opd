import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarPlus, Download, UserPlus } from 'lucide-react';
import { blockedNumbersApi, patientProfilesApi } from '../api/endpoints';
import type { ClinicPatient } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Empty, Loading, Modal, SearchField } from '../components/ui';
import { PatientFormModal } from '../components/PatientFormModal';
import { WalkInModal } from '../components/WalkInModal';
import { NARROW, useMediaQuery } from '../lib/useMediaQuery';
import { avatarTone, initials } from '../lib/avatar';
import { BlockIcon, PhoneIcon } from '../components/icons';
import { ageOf, prettyDate, prettyGender, shortGender } from '../lib/patientFormat';
import { matchesName } from '../lib/patientSearch';
import { BlockedNumbers } from './BlockedNumbers';

type Segment = 'all' | 'recent' | 'blocked';
type Sort = 'recent' | 'name' | 'visits';

/** Days between a YYYY-MM-DD date and today; large when there is no date. */
function daysAgo(date: string | null): number {
  if (!date) return 1e9;
  const then = new Date(`${date}T00:00:00`).getTime();
  if (Number.isNaN(then)) return 1e9;
  return Math.floor((Date.now() - then) / 86_400_000);
}

/**
 * The clinic's patients, as people rather than as appointments.
 *
 * The appointment list answers "who is coming in"; this answers "who has been
 * here" — and now "who are they", with the clinical summary the desk keeps by
 * hand. Filtering, sorting, family grouping and search all run over the one
 * list the server returns, so they are instant and the Conditions column, the
 * segments and the search all read the same rows.
 */
export default function PatientsPage() {
  const navigate = useNavigate();
  const narrow = useMediaQuery(NARROW);
  const { can, isDoctor } = useAuth();
  const doctorId = useDoctorId();

  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [groupByFamily, setGroupByFamily] = useState(false);

  const [blockedOpen, setBlockedOpen] = useState(false);
  // The new/edit form, and the walk-in it can hand off to.
  const [form, setForm] = useState<{ editing?: ClinicPatient | null; mobile?: string } | null>(
    null,
  );
  const [bookMobile, setBookMobile] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['patients'],
    queryFn: () => patientProfilesApi.list(),
  });
  const all = useMemo(() => data ?? [], [data]);

  const { data: blocked } = useQuery({
    queryKey: ['blocked-numbers'],
    queryFn: blockedNumbersApi.list,
    enabled: can('appointments', 'read'),
  });
  const blockedMobiles = useMemo(
    () => new Set((blocked ?? []).map((b) => b.mobile)),
    [blocked],
  );
  const isBlocked = (m: string) => blockedMobiles.has(m);

  // ── Segment counts, then filter · search · sort ──────────────
  const counts = useMemo(
    () => ({
      all: all.length,
      recent: all.filter((p) => daysAgo(p.last_visit_date) <= 7).length,
      blocked: all.filter((p) => blockedMobiles.has(p.mobile)).length,
    }),
    [all, blockedMobiles],
  );

  const rows = useMemo(() => {
    let list = all;
    if (segment === 'recent') list = list.filter((p) => daysAgo(p.last_visit_date) <= 7);
    if (segment === 'blocked') list = list.filter((p) => blockedMobiles.has(p.mobile));
    const q = search.trim();
    if (q) {
      list = list.filter(
        (p) =>
          matchesName(p.name, q) ||
          p.mobile.includes(q.replace(/\D/g, '')) ||
          (p.conditions ?? []).some((c) => matchesName(c, q)),
      );
    }
    return list.toSorted((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'visits'
          ? b.visit_count - a.visit_count
          : (b.last_visit_date ?? '').localeCompare(a.last_visit_date ?? ''),
    );
  }, [all, segment, search, sort, blockedMobiles]);

  // Grouped by number, each family under one header, when the toggle is on.
  const families = useMemo(() => {
    if (!groupByFamily) return null;
    const by = new Map<string, ClinicPatient[]>();
    for (const p of rows) {
      const g = by.get(p.mobile) ?? [];
      g.push(p);
      by.set(p.mobile, g);
    }
    return [...by.entries()];
  }, [rows, groupByFamily]);

  const canCreate = can('patients', 'create') || isDoctor;

  const exportCsv = () => downloadPatientsCsv(rows, blockedMobiles);

  const openProfile = (id: string) => navigate(`/patients/${id}`);
  const book = (mobile: string) => setBookMobile(mobile);

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
          <h1>Patients</h1>
          {all.length > 0 && (
            <span className="muted" style={{ fontSize: 13 }}>
              {all.length} registered
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {can('appointments', 'read') && (
            <button className="btn" onClick={() => setBlockedOpen(true)}>
              <BlockIcon size={16} />
              Blocked numbers
              {blockedMobiles.size > 0 && (
                <span className="muted" style={{ marginLeft: 2 }}>
                  {blockedMobiles.size}
                </span>
              )}
            </button>
          )}
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>
            <Download size={16} />
            Export
          </button>
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setForm({})}>
              <UserPlus size={16} />
              New patient
            </button>
          )}
        </div>
      </div>

      <div className="list-panel">
        <div className="list-panel-head patients-toolbar">
          <div className="seg" role="tablist" aria-label="Filter patients">
            {(
              [
                ['all', 'All'],
                ['recent', 'Seen this week'],
                ['blocked', 'Blocked'],
              ] as [Segment, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={segment === key}
                className={segment === key ? 'selected' : ''}
                onClick={() => setSegment(key)}
              >
                {label}
                <span className="seg-n">{counts[key]}</span>
              </button>
            ))}
          </div>

          {!narrow && (
            <>
              <label className="sort-pill">
                <span className="muted">Sort</span>
                <select
                  className="select"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                >
                  <option value="recent">Last visit</option>
                  <option value="name">Name A–Z</option>
                  <option value="visits">Most visits</option>
                </select>
              </label>
              <button
                type="button"
                className={`chip-toggle ${groupByFamily ? 'on' : ''}`}
                aria-pressed={groupByFamily}
                onClick={() => setGroupByFamily((v) => !v)}
              >
                Group by family
              </button>
            </>
          )}

          <div className="toolbar-grow" />
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search name, mobile or condition…"
            label="Search patients"
          />
        </div>

        {isLoading ? (
          <Loading />
        ) : error ? (
          <Empty>Could not load the patient list.</Empty>
        ) : !rows.length ? (
          <Empty>
            {all.length
              ? 'No patient matches that search or filter.'
              : 'No patients yet — register one, or they appear here after their first visit.'}
          </Empty>
        ) : narrow ? (
          <div className="appt-cards">
            {rows.map((p) => (
              <PatientCard
                key={p.id}
                p={p}
                blocked={isBlocked(p.mobile)}
                onOpen={() => openProfile(p.id)}
                onBook={() => book(p.mobile)}
              />
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Mobile</th>
                  <th>Age / Gender</th>
                  <th>Conditions</th>
                  <th>Visits</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {families
                  ? families.map(([mobile, members]) => (
                      <FamilyGroup
                        key={mobile}
                        mobile={mobile}
                        members={members}
                        blocked={isBlocked(mobile)}
                        onOpen={openProfile}
                        onBook={book}
                        onAddFamily={
                          canCreate ? () => setForm({ mobile }) : undefined
                        }
                      />
                    ))
                  : rows.map((p) => (
                      <PatientRow
                        key={p.id}
                        p={p}
                        blocked={isBlocked(p.mobile)}
                        onOpen={openProfile}
                        onBook={book}
                      />
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {blockedOpen && (
        <Modal title="Blocked numbers" onClose={() => setBlockedOpen(false)} large>
          <BlockedNumbers embedded />
        </Modal>
      )}

      {form && (
        <PatientFormModal
          editing={form.editing ?? null}
          presetMobile={form.mobile}
          allPatients={all}
          onClose={() => setForm(null)}
          onSaved={(saved, alsoBook) => {
            setForm(null);
            if (alsoBook) setBookMobile(saved.mobile);
            else openProfile(saved.id);
          }}
        />
      )}

      {bookMobile && doctorId && (
        <WalkInModal
          doctorId={doctorId}
          initialMobile={bookMobile}
          onClose={() => setBookMobile(null)}
        />
      )}
    </>
  );
}

/** The doctor whose clinic this is — for the walk-in booking modal. */
function useDoctorId(): string | undefined {
  const { user } = useAuth();
  return user?.doctorId ?? undefined;
}

function Conditions({ list }: { list?: string[] }) {
  const conds = list ?? [];
  if (!conds.length) return <span className="muted">—</span>;
  return (
    <span className="cond-chips">
      {conds.slice(0, 2).map((c) => (
        <span key={c} className="cond-chip">
          {c}
        </span>
      ))}
      {conds.length > 2 && <span className="cond-chip more">+{conds.length - 2}</span>}
    </span>
  );
}

function RowActions({
  onBook,
  onOpen,
}: {
  onBook: () => void;
  onOpen: () => void;
}) {
  return (
    <span className="row-acts">
      <button
        className="icon-act"
        title="Book appointment"
        onClick={(e) => {
          e.stopPropagation();
          onBook();
        }}
      >
        <CalendarPlus size={17} aria-hidden />
        <span className="sr-only">Book appointment</span>
      </button>
      <button
        className="icon-act go"
        title="Open profile"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <ArrowRight size={17} aria-hidden />
        <span className="sr-only">Open profile</span>
      </button>
    </span>
  );
}

function PatientRow({
  p,
  blocked,
  onOpen,
  onBook,
}: {
  p: ClinicPatient;
  blocked: boolean;
  onOpen: (id: string) => void;
  onBook: (mobile: string) => void;
}) {
  return (
    <tr className="clickable-row" onClick={() => onOpen(p.id)}>
      <td style={{ fontWeight: 600 }}>
        <span className="row-name-cell">
          <span className={`appt-avatar sm ${avatarTone(p.name)}`} aria-hidden>
            {initials(p.name)}
          </span>
          {p.name}
          {blocked && <span className="appt-badge cancelled">Blocked</span>}
        </span>
      </td>
      <td className="muted">{p.mobile || '—'}</td>
      <td className="muted">
        {[ageOf(p), prettyGender(p.gender)].filter(Boolean).join(' · ') || '—'}
      </td>
      <td>
        <Conditions list={p.conditions} />
      </td>
      <td className="muted">{p.visit_count}</td>
      <td>
        <RowActions onBook={() => onBook(p.mobile)} onOpen={() => onOpen(p.id)} />
      </td>
    </tr>
  );
}

function FamilyGroup({
  mobile,
  members,
  blocked,
  onOpen,
  onBook,
  onAddFamily,
}: {
  mobile: string;
  members: ClinicPatient[];
  blocked: boolean;
  onOpen: (id: string) => void;
  onBook: (mobile: string) => void;
  onAddFamily?: () => void;
}) {
  return (
    <>
      <tr className="family-head">
        <td colSpan={6}>
          <span className="fam-phone">{mobile}</span>
          <span className="muted">
            · {members.length} family member{members.length === 1 ? '' : 's'}
          </span>
          {blocked && <span className="appt-badge cancelled">Blocked</span>}
          {onAddFamily && (
            <button
              className="link-btn"
              style={{ marginLeft: 'auto' }}
              onClick={(e) => {
                e.stopPropagation();
                onAddFamily();
              }}
            >
              + Add family member
            </button>
          )}
        </td>
      </tr>
      {members.map((p) => (
        <PatientRow
          key={p.id}
          p={p}
          blocked={blocked}
          onOpen={onOpen}
          onBook={onBook}
        />
      ))}
    </>
  );
}

/**
 * The phone card: name, then "F · 42 yrs" and the number, with conditions and
 * the visit badge. Row actions gain labels because icon-only is ambiguous on a
 * phone.
 */
function PatientCard({
  p,
  blocked,
  onOpen,
  onBook,
}: {
  p: ClinicPatient;
  blocked: boolean;
  onOpen: () => void;
  onBook: () => void;
}) {
  const who = [shortGender(p.gender), ageOf(p)].filter(Boolean).join(' · ');
  return (
    <div className="appt-card is-static">
      <button type="button" className="appt-card-main" onClick={onOpen}>
        <span className={`appt-avatar ${avatarTone(p.name)}`} aria-hidden>
          {initials(p.name)}
        </span>
        <div className="appt-body">
          <div className="appt-card-top">
            <span className="appt-card-name">{p.name}</span>
            {blocked && <span className="appt-badge cancelled">Blocked</span>}
          </div>
          {who && <div className="appt-meta">{who}</div>}
          {p.mobile && (
            <div className="appt-phone">
              <PhoneIcon />
              {p.mobile}
            </div>
          )}
          {(p.conditions ?? []).length > 0 && (
            <div style={{ marginTop: 6 }}>
              <Conditions list={p.conditions} />
            </div>
          )}
        </div>
        <span className="appt-time-badge is-done">
          <span className="appt-time-date">
            {p.visit_count} visit{p.visit_count === 1 ? '' : 's'}
          </span>
          {prettyDate(p.last_visit_date)}
        </span>
      </button>
      <div className="appt-card-actions">
        <button className="btn btn-sm" onClick={onBook}>
          Book
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onOpen}>
          Open
        </button>
      </div>
    </div>
  );
}

/** CSV-quote a cell: wrap in quotes and double any quotes inside. */
function csvCell(v: string): string {
  return `"${(v ?? '').replace(/"/g, '""')}"`;
}

/** A real CSV of the rows as filtered — the question the desk asked, exported. */
function downloadPatientsCsv(rows: ClinicPatient[], blockedMobiles: Set<string>) {
  const header = ['Name', 'Mobile', 'Age', 'Gender', 'Conditions', 'Visits', 'Last visit', 'Blocked'];
  const lines = rows.map((p) =>
    [
      p.name,
      p.mobile,
      ageOf(p).replace(' yrs', ''),
      prettyGender(p.gender),
      (p.conditions ?? []).join('; '),
      String(p.visit_count),
      prettyDate(p.last_visit_date),
      blockedMobiles.has(p.mobile) ? 'Yes' : 'No',
    ]
      .map((c) => csvCell(c ?? ''))
      .join(','),
  );
  const csv = [header.map(csvCell).join(','), ...lines].join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `patients-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
