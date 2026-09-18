import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { patientProfilesApi } from '../api/endpoints';
import type { ClinicPatient } from '../api/types';
import { Empty, Loading } from '../components/ui';
import { NARROW, useMediaQuery } from '../lib/useMediaQuery';
import { avatarTone, initials } from '../lib/avatar';
import { PhoneIcon, SearchIcon } from '../components/icons';
import { ageOf, prettyDate, shortGender } from '../lib/patientFormat';

/**
 * The clinic's patients, as people rather than as appointments.
 *
 * The appointment list answers "who is coming in"; this answers "who has been
 * here" — the question you have when someone rings up and you need their
 * record without knowing when they last came. Scoped to visits this clinic
 * actually had, so it is this practice's list and not the platform's.
 */
export default function PatientsPage() {
  const navigate = useNavigate();
  const narrow = useMediaQuery(NARROW);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<string | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim() || undefined), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['patients', search],
    queryFn: () => patientProfilesApi.list(search),
  });

  const rows = useMemo(() => data ?? [], [data]);

  return (
    <>
      <div className="page-head">
        <h1>Patients</h1>
        {rows.length > 0 && (
          <span className="muted" style={{ fontSize: 13 }}>
            {rows.length} registered
          </span>
        )}
      </div>

      <div className="list-panel">
        <div className="list-panel-head">
          <div className="dash-search">
            <span className="dash-search-icon" aria-hidden>
              <SearchIcon size={17} />
            </span>
            <input
              className="input"
              type="search"
              placeholder="Search by name, mobile number or patient ID…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <Loading />
        ) : error ? (
          <Empty>Could not load the patient list.</Empty>
        ) : !rows.length ? (
          <Empty>
            {search
              ? 'No patient matches that search.'
              : 'No patients yet — they appear here after their first visit.'}
          </Empty>
        ) : narrow ? (
          <div className="appt-cards">
            {rows.map((p) => (
              <PatientCard key={p.id} p={p} onOpen={() => navigate(`/patients/${p.id}`)} />
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
                  <th>Visits</th>
                  <th>Last visit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    className="clickable-row"
                    onClick={() => navigate(`/patients/${p.id}`)}
                  >
                    <td style={{ fontWeight: 600 }}>
                      <span className="row-name-cell">
                        <span
                          className={`appt-avatar sm ${avatarTone(p.name)}`}
                          aria-hidden
                        >
                          {initials(p.name)}
                        </span>
                        {p.name}
                      </span>
                    </td>
                    <td className="muted">{p.mobile || '—'}</td>
                    <td className="muted">
                      {[ageOf(p), p.gender].filter(Boolean).join(' · ')}
                    </td>
                    <td className="muted">{p.visit_count}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {prettyDate(p.last_visit_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Same two-row card as the appointment list — name, then "M · 42 yrs" and the
 * number — so the two screens read as one app. The badge on the right is the
 * last visit, with the visit count above it in place of the time.
 */
function PatientCard({ p, onOpen }: { p: ClinicPatient; onOpen: () => void }) {
  const who = [shortGender(p.gender), ageOf(p)].filter(Boolean).join(' · ');
  return (
    <button type="button" className="appt-card" onClick={onOpen}>
      <div className="appt-card-main">
        <span className={`appt-avatar ${avatarTone(p.name)}`} aria-hidden>
          {initials(p.name)}
        </span>
        <div className="appt-body">
          <div className="appt-card-top">
            <span className="appt-card-name">{p.name}</span>
          </div>
          {who && <div className="appt-meta">{who}</div>}
          {p.mobile && (
            <div className="appt-phone">
              <PhoneIcon />
              {p.mobile}
            </div>
          )}
        </div>
        <span className="appt-time-badge is-done">
          <span className="appt-time-date">
            {p.visit_count} visit{p.visit_count === 1 ? '' : 's'}
          </span>
          {prettyDate(p.last_visit_date)}
        </span>
      </div>
    </button>
  );
}
