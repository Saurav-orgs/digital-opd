import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doctorsApi, patientProfilesApi } from '../api/endpoints';
import type { ClinicPatient } from '../api/types';
import { Badge, Empty, InfoRow, Loading } from '../components/ui';
import { useToast } from '../components/Toast';
import { PhoneIcon, SearchIcon } from '../components/icons';
import { NARROW, useMediaQuery } from '../lib/useMediaQuery';
import { avatarTone, initials } from '../lib/avatar';
import { ageOf, prettyDate, shortGender } from '../lib/patientFormat';

const MAX_LICENSE_BYTES = 6 * 1024 * 1024;

/**
 * One doctor, for the super admin: who they are, how to reach them, the
 * certificate they registered with, and everyone their clinic has seen.
 *
 * A page rather than the dialog it used to be. The patient list is the
 * reason: a clinic's whole register does not belong in a 520px modal, and
 * the client said as much. Editing stays in Edit & QR on the Doctors list.
 * Uploading a certificate is allowed here because a doctor created before
 * that existed has none, and this is where an admin notices.
 */
export default function DoctorDetailPage() {
  const { doctorId = '' } = useParams<{ doctorId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const profileQ = useQuery({
    queryKey: ['doctor-profile', doctorId],
    queryFn: () => doctorsApi.profile(doctorId),
    enabled: !!doctorId,
  });

  const upload = useMutation({
    mutationFn: (file: File) => doctorsApi.uploadLicense(doctorId, file),
    onSuccess: () => {
      toast.success('Certificate uploaded');
      qc.invalidateQueries({ queryKey: ['doctor-profile', doctorId] });
      qc.invalidateQueries({ queryKey: ['doctors'] });
    },
    onError: (e: any) => setError(e?.message ?? 'Could not upload the certificate.'),
  });

  const d = profileQ.data;

  if (profileQ.isLoading) return <Loading />;
  if (profileQ.isError || !d) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="visit-topbar">
          <button className="btn btn-sm btn-ghost" onClick={() => navigate('/doctors')}>
            ← Doctors
          </button>
        </div>
        <Empty>Could not load this doctor.</Empty>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="visit-topbar">
        <button className="btn btn-sm btn-ghost" onClick={() => navigate('/doctors')}>
          ← Doctors
        </button>
      </div>

      <div className="visit-patient-card">
        <span className={`appt-avatar ${avatarTone(d.name)}`} aria-hidden>
          {initials(d.name)}
        </span>
        <div className="visit-patient-body" style={{ flex: 1 }}>
          <h1 className="visit-patient-name">{d.name}</h1>
          <div className="pc-meta">
            {[d.specialization, d.qualifications].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <Badge
          value={d.is_enabled ? 'confirmed' : 'rejected'}
          label={d.is_enabled ? 'Active' : 'Disabled'}
        />
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>Details</div>
          <InfoRow label="Login email" value={d.login_email ?? '—'} copyable />
          <InfoRow label="Mobile" value={d.contact_mobile ?? '—'} />
          <InfoRow label="Registration no." value={d.license_number ?? '—'} />
          <InfoRow
            label="Account"
            value={`${d.is_enabled ? 'Active' : 'Disabled'} · login ${d.login_active ? 'enabled' : 'disabled'}`}
          />
          <InfoRow
            label="Terms accepted"
            value={
              d.terms_accepted_at
                ? `${new Date(d.terms_accepted_at).toLocaleDateString()}${d.terms_version ? ` (v${d.terms_version})` : ''}`
                : 'Not recorded'
            }
          />
        </div>

        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>
            Practice licence / certificate
          </div>
          {d.license_url ? (
            <a className="btn btn-sm btn-primary" href={d.license_url} target="_blank" rel="noreferrer">
              Open certificate
            </a>
          ) : (
            <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
              No certificate on file for this doctor.
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > MAX_LICENSE_BYTES) {
                setError('That file is larger than 6 MB. Please choose a smaller one.');
                return;
              }
              setError('');
              upload.mutate(f);
            }}
          />
          <div>
            <button
              className="btn btn-sm"
              style={{ marginTop: 8 }}
              disabled={upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              {upload.isPending
                ? 'Uploading…'
                : d.license_url
                  ? 'Replace certificate'
                  : 'Upload certificate'}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            PDF or image, up to 6 MB. The link above expires after 15 minutes.
          </p>
          {error && (
            <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: 4 }}>{error}</p>
          )}
        </div>
      </div>

      <h2 className="section-label" style={{ marginTop: 20 }}>Patients</h2>
      <DoctorPatients doctorId={doctorId} />
    </div>
  );
}

/**
 * Everyone this doctor's clinic has seen — the same list the doctor gets
 * under Patients, read-only, with the same table and phone cards.
 */
function DoctorPatients({ doctorId }: { doctorId: string }) {
  const narrow = useMediaQuery(NARROW);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<string | undefined>(undefined);
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim() || undefined), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['doctor-patients', doctorId, search],
    queryFn: () => patientProfilesApi.listForDoctor(doctorId, search),
  });
  const rows = useMemo(() => data ?? [], [data]);

  return (
    <div className="list-panel">
      <div className="list-panel-head row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div className="dash-search" style={{ flex: 1 }}>
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
        {data && (
          <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
            {rows.length} {search ? 'matching' : 'registered'}
          </span>
        )}
      </div>

      {isLoading ? (
        <Loading />
      ) : error ? (
        <Empty>Could not load this doctor's patients.</Empty>
      ) : !rows.length ? (
        <Empty>
          {search
            ? 'No patient matches that search.'
            : 'No patients yet — they appear here after their first visit.'}
        </Empty>
      ) : narrow ? (
        <div className="appt-cards">
          {rows.map((p) => (
            <PatientCard key={p.id} p={p} />
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
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>
                    <span className="row-name-cell">
                      <span className={`appt-avatar sm ${avatarTone(p.name)}`} aria-hidden>
                        {initials(p.name)}
                      </span>
                      {p.name}
                    </span>
                  </td>
                  <td className="muted">{p.mobile || '—'}</td>
                  <td className="muted">{[ageOf(p), p.gender].filter(Boolean).join(' · ')}</td>
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
  );
}

/** The Patients page's phone card, minus the click: there is no record to open from here. */
function PatientCard({ p }: { p: ClinicPatient }) {
  const who = [shortGender(p.gender), ageOf(p)].filter(Boolean).join(' · ');
  return (
    <div className="appt-card">
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
    </div>
  );
}
