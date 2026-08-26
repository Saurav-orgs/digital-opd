import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, ExternalLink } from 'lucide-react';
import { patientApi } from '../../patientApi';
import { useDoctorCtx } from '../../context/DoctorContext';
import { StateView } from '../../components/StateView';
import { PatientSwitcher, RequirePatient } from '../../components/PatientSwitcher';
import { usePatientAuth } from '../../auth/PatientAuthContext';

export const Reports: React.FC = () => (
  <RequirePatient>
    <ReportsForPatient />
  </RequirePatient>
);

const ReportsForPatient: React.FC = () => {
  const { doctor } = useDoctorCtx();
  const { selected } = usePatientAuth();
  const profileId = selected!.id;

  const { data: reports, isLoading, error, refetch } = useQuery({
    queryKey: ['patient-reports', profileId, doctor?.id],
    queryFn: () => patientApi.myReports(profileId, doctor?.id),
  });

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>
        My Reports
      </h2>
      <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: '14px' }}>
        {selected!.name}'s lab reports from the clinic, plus anything uploaded against a
        visit. To add a report, open the visit under <strong>My Visits</strong> and
        upload it there.
      </p>

      <PatientSwitcher />

      {isLoading ? (
        <StateView loading />
      ) : error ? (
        <StateView
          error={error instanceof Error ? error.message : 'Could not load your reports.'}
          onRetry={() => refetch()}
        />
      ) : !reports?.length ? (
        <StateView empty="No reports available yet." />
      ) : (
        <div className="section-card" style={{ padding: 0 }}>
          {reports.map((r, i) => (
            <a
              key={r.id}
              href={r.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '16px 20px',
                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                color: 'var(--text)',
                textDecoration: 'none',
              }}
            >
              <FileText size={20} color="var(--primary)" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '14.5px' }}>{r.title}</div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                  {new Date(r.createdAt).toLocaleDateString()}
                </div>
              </div>
              <ExternalLink size={16} color="var(--text-secondary)" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
};
