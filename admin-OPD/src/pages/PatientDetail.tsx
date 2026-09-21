import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi, blockedNumbersApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog, Empty, Loading } from '../components/ui';
import { avatarTone, initials } from '../lib/avatar';
import { HistoryVisit } from '../components/HistoryVisit';
import { VisitRangeFilter, useVisitRange } from '../components/VisitRangeFilter';

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
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const canBlock = can('appointments', 'update');

  const visitsQ = useQuery({
    queryKey: ['patient-visits', profileId],
    queryFn: () => appointmentsApi.history(profileId!),
    enabled: !!profileId,
  });

  const visits = visitsQ.data ?? [];
  const range = useVisitRange(visits);
  const latest = visits[0];

  // ── Block / unblock this patient's number ─────────────────
  // The block lives on the number, not the profile, so a family sharing a
  // phone is blocked together — the same rule the Blocked screen applies.
  const blockedQ = useQuery({
    queryKey: ['blocked-numbers'],
    queryFn: blockedNumbersApi.list,
    enabled: canBlock,
  });
  const blockRow = latest
    ? blockedQ.data?.find((b) => b.mobile === latest.patient_mobile) ?? null
    : null;
  const [confirming, setConfirming] = useState<'block' | 'unblock' | null>(null);

  const blockMut = useMutation({
    mutationFn: () =>
      blockedNumbersApi.block(latest!.patient_mobile, 'Blocked from patient profile'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-numbers'] });
      toast.success(`${latest?.patient_name} blocked`, 'They can no longer book with this clinic.');
      setConfirming(null);
    },
    onError: (e) => {
      toast.error(e);
      setConfirming(null);
    },
  });
  const unblockMut = useMutation({
    mutationFn: () => blockedNumbersApi.unblock(blockRow!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocked-numbers'] });
      toast.success('Number unblocked');
      setConfirming(null);
    },
    onError: (e) => {
      toast.error(e);
      setConfirming(null);
    },
  });

  if (visitsQ.isLoading) return <Loading />;

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
          <h1 className="visit-patient-name">
            {latest.patient_name}
            {blockRow && (
              <span
                className="appt-badge cancelled"
                style={{ marginLeft: 8, verticalAlign: 'middle' }}
                title={blockRow.reason || 'Cannot book online with this clinic'}
              >
                Blocked
              </span>
            )}
          </h1>
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
        {canBlock && latest.patient_mobile && (
          blockRow ? (
            <button className="btn btn-sm" onClick={() => setConfirming('unblock')}>
              Unblock
            </button>
          ) : (
            <button className="btn btn-sm btn-danger" onClick={() => setConfirming('block')}>
              Block patient
            </button>
          )
        )}
      </div>

      <h2 className="section-label">Visits</h2>
      <VisitRangeFilter range={range} total={visits.length} />

      <div className="stack" style={{ gap: 12 }}>
        {range.filtered.map((v) => (
          <HistoryVisit key={v.id} visit={v} />
        ))}
      </div>

      {confirming === 'block' && (
        <ConfirmDialog
          title="Block this patient?"
          message={
            <>
              {latest.patient_mobile} will no longer be able to book with this clinic.
              Existing appointments are left alone, and the number can be unblocked
              from here or from the Blocked screen.
            </>
          }
          confirmLabel="Block"
          destructive
          busy={blockMut.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => blockMut.mutate()}
        />
      )}
      {confirming === 'unblock' && blockRow && (
        <ConfirmDialog
          title="Unblock this number?"
          confirmLabel="Unblock"
          busy={unblockMut.isPending}
          message={
            <>
              <strong>{latest.patient_name}</strong> ({latest.patient_mobile}) will be able
              to book online with your clinic again.
            </>
          }
          onCancel={() => setConfirming(null)}
          onConfirm={() => unblockMut.mutate()}
        />
      )}
    </div>
  );
}
