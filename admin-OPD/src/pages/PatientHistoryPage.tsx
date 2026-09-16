import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { appointmentsApi } from '../api/endpoints';
import { Empty, Loading } from '../components/ui';
import { avatarTone, initials } from '../lib/avatar';
import { HistoryVisit } from '../components/HistoryVisit';
import { VisitRangeFilter, useVisitRange } from '../components/VisitRangeFilter';

/**
 * Everything this patient has been seen for before, on its own screen.
 *
 * It used to be a card at the bottom of the consultation, underneath the
 * prescription — which is the wrong place for it twice over: it is reference
 * rather than work, so it pushed the actual task down the page, and a doctor
 * reaching for "what happened last time" had to scroll past the thing they
 * were in the middle of writing to find it.
 *
 * Keyed by the current appointment rather than the patient, because that is
 * what the caller has and it is also what has to be excluded from the list —
 * the visit you are in is not part of its own history.
 */
export default function PatientHistoryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: a, isLoading: loadingAppointment } = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => appointmentsApi.get(id!),
    enabled: !!id,
  });

  const historyQ = useQuery({
    queryKey: ['appointment-history', a?.patient_profile_id, id],
    queryFn: () => appointmentsApi.history(a!.patient_profile_id!, id!),
    enabled: !!a?.patient_profile_id && !!id,
  });

  const visits = historyQ.data ?? [];
  const range = useVisitRange(visits);

  if (loadingAppointment) return <Loading />;
  if (!a) return <Empty>Could not load this patient.</Empty>;

  const genderAge = [
    a.patient_gender ? a.patient_gender[0].toUpperCase() + a.patient_gender.slice(1) : null,
    a.patient_age != null ? `${a.patient_age} yrs` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="visit-topbar">
        <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/appointments/${id}`)}>
          ← Back to visit
        </button>
      </div>

      <div className="visit-patient-card">
        <span className={`appt-avatar ${avatarTone(a.patient_name)}`} aria-hidden>
          {initials(a.patient_name)}
        </span>
        <div className="visit-patient-body">
          <h1 className="visit-patient-name">{a.patient_name}</h1>
          <div className="pc-meta">
            {[genderAge, a.patient_mobile].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      <h2 className="section-label">Previous visits</h2>

      {historyQ.isLoading ? (
        <Loading />
      ) : !visits.length ? (
        <Empty>No earlier visits for this patient.</Empty>
      ) : (
        <>
          <VisitRangeFilter range={range} total={visits.length} />
          <div className="stack" style={{ gap: 12 }}>
            {range.filtered.map((h) => (
              <HistoryVisit key={h.id} visit={h} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
