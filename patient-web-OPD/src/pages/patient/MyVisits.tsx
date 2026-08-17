import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Stethoscope, FileText, Bell } from 'lucide-react';
import { patientApi } from '../../patientApi';
import type { PatientVisit } from '../../types';
import { StateView } from '../../components/StateView';

export const MyVisits: React.FC = () => {
  const { data: visits, isLoading, error, refetch } = useQuery({
    queryKey: ['patient-visits'],
    queryFn: patientApi.myVisits,
  });

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>
        My Visits
      </h2>
      <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
        Your consultation history — doctor's notes and prescriptions from each visit.
      </p>

      {isLoading ? (
        <StateView loading />
      ) : error ? (
        <StateView
          error={error instanceof Error ? error.message : 'Could not load your visits.'}
          onRetry={() => refetch()}
        />
      ) : !visits?.length ? (
        <StateView empty="No visits yet. Once you book an OPD appointment, it will show up here." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {visits.map((v) => (
            <VisitCard key={v.id} visit={v} />
          ))}
        </div>
      )}
    </div>
  );
};

const VisitCard: React.FC<{ visit: PatientVisit }> = ({ visit: v }) => {
  const [open, setOpen] = useState(false);
  const hasDetails =
    v.doctor_notes || v.next_visit_note || v.prescriptions.length > 0 || v.reports.length > 0;

  return (
    <div className="section-card">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: hasDetails ? 'pointer' : 'default' }}
        onClick={() => hasDetails && setOpen((o) => !o)}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, color: 'var(--text)' }}>
            <CalendarClock size={16} color="var(--primary)" />
            {v.appointment_date} · {v.start_time?.slice(0, 5)}
          </div>
          {v.doctor?.name && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              <Stethoscope size={13} />
              {v.doctor.name}
              {v.doctor.specialization && ` · ${v.doctor.specialization}`}
            </div>
          )}
        </div>
        <span
          className={'fee-badge'}
          style={{
            background: v.status === 'rejected' ? '#FEE2E2' : v.consultation_status === 'done' ? '#DCFCE7' : '#EFF6FF',
            color: v.status === 'rejected' ? '#B91C1C' : v.consultation_status === 'done' ? '#166534' : '#1D4ED8',
          }}
        >
          {v.status === 'rejected' ? 'Rejected' : v.consultation_status.replace('_', ' ')}
        </span>
      </div>

      {hasDetails && open && (
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
          {v.description && (
            <p style={{ margin: '0 0 8px', fontSize: '13.5px', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--text)' }}>Reason:</strong> {v.description}
            </p>
          )}
          {v.doctor_notes && (
            <p style={{ margin: '0 0 8px', fontSize: '13.5px' }}>
              <strong>Doctor's note:</strong> {v.doctor_notes}
            </p>
          )}
          {v.next_visit_note && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', background: '#EFF6FF', padding: '10px 12px', borderRadius: '8px', margin: '0 0 8px' }}>
              <Bell size={16} color="#1D4ED8" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '13px' }}>
                {v.next_visit_note}
                {v.next_visit_date && (
                  <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                    Suggested date: {v.next_visit_date}
                  </div>
                )}
              </div>
            </div>
          )}
          {v.prescriptions.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                <FileText size={14} />
                Prescriptions
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {v.prescriptions.map((p) => (
                  <a key={p.id} href={p.url ?? undefined} target="_blank" rel="noreferrer">
                    <img
                      src={p.url ?? undefined}
                      alt="Prescription"
                      style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
          {v.reports.length > 0 && (
            <div style={{ marginTop: v.prescriptions.length > 0 ? '12px' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                <FileText size={14} />
                Reports
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {v.reports.map((r) => (
                  <a key={r.id} href={r.url ?? undefined} target="_blank" rel="noreferrer" style={{ fontSize: '13px' }}>
                    📄 {r.title}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
