import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Stethoscope, FileText, Bell, Upload, Pill, Download } from 'lucide-react';
import { patientApi } from '../../patientApi';
import { ApiException, type PatientVisit, type IssuedPrescription } from '../../types';
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
        Your consultation history — doctor's notes and prescriptions from each visit. You
        can upload reports to a visit until the doctor marks it done.
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
  // The card expands to reveal details and/or the report-upload box.
  const expandable =
    !!v.doctor_notes ||
    !!v.next_visit_note ||
    !!v.e_prescription ||
    v.prescriptions.length > 0 ||
    v.reports.length > 0 ||
    v.accepts_reports;

  return (
    <div className="section-card">
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: expandable ? 'pointer' : 'default' }}
        onClick={() => expandable && setOpen((o) => !o)}
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

      {expandable && open && (
        <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' }}>
          {v.e_prescription && <PrescriptionCard prescription={v.e_prescription} />}
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
          {v.accepts_reports && <ReportUploader appointmentId={v.id} />}
        </div>
      )}
    </div>
  );
};

/** The doctor's issued e-prescription for this visit, with a downloadable PDF. */
const PrescriptionCard: React.FC<{ prescription: IssuedPrescription }> = ({
  prescription: p,
}) => (
  <div
    style={{
      border: '1px solid var(--border)',
      borderRadius: '10px',
      padding: '14px 16px',
      marginBottom: '12px',
      background: '#F8FAFF',
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        marginBottom: '10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
        <Pill size={16} color="var(--primary)" />
        Prescription
      </div>
      {p.pdf_url && (
        <a
          href={p.pdf_url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '13px',
            fontWeight: 600,
          }}
        >
          <Download size={14} /> PDF
        </a>
      )}
    </div>

    {p.diagnosis && (
      <p style={{ margin: '0 0 8px', fontSize: '13.5px' }}>
        <strong>Diagnosis:</strong> {p.diagnosis}
      </p>
    )}

    {p.medicines.length > 0 && (
      <ol style={{ margin: '0 0 8px 18px', padding: 0, fontSize: '13.5px' }}>
        {p.medicines.map((m) => (
          <li key={m.id} style={{ marginBottom: '6px' }}>
            <strong>
              {m.medicine_name}
              {m.strength ? ` ${m.strength}` : ''}
            </strong>
            <div style={{ color: 'var(--text-secondary)', fontSize: '12.5px' }}>
              {[
                m.dosage,
                m.timing,
                m.duration_days ? `${m.duration_days} days` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              {m.instructions ? ` — ${m.instructions}` : ''}
            </div>
          </li>
        ))}
      </ol>
    )}

    {p.advice && (
      <p style={{ margin: '0 0 6px', fontSize: '13px', whiteSpace: 'pre-wrap' }}>
        <strong>Advice:</strong> {p.advice}
      </p>
    )}

    {p.follow_up_date && (
      <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
        Follow-up on {p.follow_up_date}
      </p>
    )}
  </div>
);

/** Upload a report against this specific visit; disabled once the doctor closes it. */
const ReportUploader: React.FC<{ appointmentId: string }> = ({ appointmentId }) => {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: (file: File) =>
      patientApi.uploadVisitReport(appointmentId, title.trim(), file),
    onSuccess: () => {
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      setUploadError(null);
      qc.invalidateQueries({ queryKey: ['patient-visits'] });
      qc.invalidateQueries({ queryKey: ['patient-reports'] });
    },
    onError: (err) => {
      setUploadError(
        err instanceof ApiException ? err.message : 'Could not upload the report. Please try again.',
      );
    },
  });

  const handleUpload = () => {
    const file = fileRef.current?.files?.[0];
    if (!title.trim()) {
      setUploadError('Please enter a title for this report.');
      return;
    }
    if (!file) {
      setUploadError('Please choose a file to upload.');
      return;
    }
    upload.mutate(file);
  };

  return (
    <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px dashed var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
        <Upload size={14} color="var(--primary)" />
        Upload a report for this visit
      </div>
      <div className="form-field">
        <input
          type="text"
          className="form-input"
          placeholder="e.g. Blood Test — CBC"
          value={title}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        style={{ marginBottom: '12px' }}
        onClick={(e) => e.stopPropagation()}
      />
      <div>
        <button
          className="btn-primary"
          onClick={(e) => { e.stopPropagation(); handleUpload(); }}
          disabled={upload.isPending}
        >
          {upload.isPending ? (
            <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2.5px' }} />
          ) : (
            <span>Upload report</span>
          )}
        </button>
      </div>
      {uploadError && <div className="error-text" style={{ marginTop: '10px' }}>{uploadError}</div>}
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
        JPG, PNG, WebP or PDF · up to 5 MB.
      </div>
    </div>
  );
};
