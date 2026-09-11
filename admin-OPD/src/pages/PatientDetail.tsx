import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { appointmentsApi } from '../api/endpoints';
import { Empty, Loading } from '../components/ui';
import { avatarTone, initials } from '../lib/avatar';
import { HistoryVisit } from '../components/HistoryVisit';

/**
 * One patient's whole record, reached from the Patients list.
 *
 * Built on the same history endpoint as the in-consultation view — it is
 * scoped by patient rather than by number, so a family member's visits can
 * never surface under someone else's name. Nothing here needs a patient-by-id
 * endpoint: the visits carry the identity, and the most recent one is the
 * current picture of who they are.
 */
export default function PatientDetailPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();

  const visitsQ = useQuery({
    queryKey: ['patient-visits', profileId],
    queryFn: () => appointmentsApi.history(profileId!),
    enabled: !!profileId,
  });

  if (visitsQ.isLoading) return <Loading />;

  const visits = visitsQ.data ?? [];
  const latest = visits[0];

  if (!latest) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="visit-topbar">
          <button className="btn btn-sm btn-ghost" onClick={() => navigate('/patients')}>
            ← Patients
          </button>
        </div>
        <Empty>No visits on record for this patient.</Empty>
      </div>
    );
  }

  const genderAge = [
    latest.patient_gender
      ? latest.patient_gender[0].toUpperCase() + latest.patient_gender.slice(1)
      : null,
    latest.patient_age != null ? `${latest.patient_age} yrs` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="visit-topbar">
        <button className="btn btn-sm btn-ghost" onClick={() => navigate('/patients')}>
          ← Patients
        </button>
      </div>

      <div className="visit-patient-card">
        <span className={`appt-avatar ${avatarTone(latest.patient_name)}`} aria-hidden>
          {initials(latest.patient_name)}
        </span>
        <div className="visit-patient-body">
          <h1 className="visit-patient-name">{latest.patient_name}</h1>
          <div className="pc-meta">
            {[genderAge, latest.patient_mobile].filter(Boolean).join(' · ')}
          </div>
          {latest.patientProfile && (
            <div className="muted" style={{ fontSize: 12 }}>
              {latest.patientProfile.patient_code}
              {latest.patientProfile.relation ? ` · ${latest.patientProfile.relation}` : ''}
            </div>
          )}
        </div>
      </div>

      <h2 className="section-label">
        Visits ({visits.length})
      </h2>

      <div className="stack" style={{ gap: 12 }}>
        {visits.map((v) => (
          <HistoryVisit key={v.id} visit={v} />
        ))}
      </div>
    </div>
  );
}
