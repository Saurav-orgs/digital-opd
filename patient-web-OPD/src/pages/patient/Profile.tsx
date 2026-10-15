import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarClock, FileText, Phone, Pill } from 'lucide-react';
import { patientApi } from '../../patientApi';
import { usePatientAuth } from '../../auth/PatientAuthContext';
import { RequirePatient } from '../../components/PatientSwitcher';
import { Patients } from './Patients';

/**
 * The patient's own account, in one place.
 *
 * Everything here existed already but only as separate screens reached from
 * the top bar, and the screen that manages the people on the number was
 * reachable by typing its URL and nothing else. More to the point, a patient
 * had no page that was *theirs*: the app was organised around the doctor whose
 * link they arrived on.
 *
 * So this is the account: the number it is, everyone registered on it, and the
 * way through to the history. The history itself deliberately is not scoped to
 * one doctor — see `MyVisits` — because "my visits" means all of them.
 */
export function Profile() {
  return (
    <RequirePatient>
      <ProfileBody />
    </RequirePatient>
  );
}

function ProfileBody() {
  const { patient, selected } = usePatientAuth();
  const profileId = selected!.id;

  // Counts only, so the two cards say how much is behind them rather than
  // making the patient open an empty screen to find out.
  const visitsQ = useQuery({
    queryKey: ['patient-visits', profileId, null],
    queryFn: () => patientApi.myVisits(profileId),
  });
  const reportsQ = useQuery({
    queryKey: ['patient-reports', profileId, null],
    queryFn: () => patientApi.myReports(profileId),
  });

  const visits = visitsQ.data ?? [];
  const prescriptions = visits.filter(
    (v) => v.e_prescription || v.prescriptions.length > 0,
  ).length;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>
        My profile
      </h2>
      <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 14 }}>
        Everything on this number, across every doctor you have seen.
      </p>

      <div className="section-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Phone size={16} color="var(--primary)" />
          <div>
            <div style={{ fontWeight: 700 }}>+91 {patient!.mobile}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              The number this account signs in with.
            </div>
          </div>
        </div>
      </div>

      {/* What the patient came to look at, with the size of each behind it. */}
      <div className="profile-tiles">
        <Link to="/visits" className="profile-tile">
          <CalendarClock size={18} color="var(--primary)" />
          <span className="profile-tile-num">{visitsQ.isLoading ? '—' : visits.length}</span>
          <span className="profile-tile-label">Visits</span>
        </Link>
        <Link to="/visits" className="profile-tile">
          <Pill size={18} color="var(--primary)" />
          <span className="profile-tile-num">{visitsQ.isLoading ? '—' : prescriptions}</span>
          <span className="profile-tile-label">Prescriptions</span>
        </Link>
        <Link to="/reports" className="profile-tile">
          <FileText size={18} color="var(--primary)" />
          <span className="profile-tile-num">
            {reportsQ.isLoading ? '—' : (reportsQ.data ?? []).length}
          </span>
          <span className="profile-tile-label">Reports</span>
        </Link>
      </div>

      {/* The manager itself, rather than a copy of it: adding, switching and
          removing a patient is one screen's worth of rules, and they should not
          exist twice. It brings its own heading. */}
      <div style={{ marginTop: 26 }}>
        <Patients />
      </div>
    </div>
  );
}
