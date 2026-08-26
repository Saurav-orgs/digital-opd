import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Stethoscope, FileText, Bell, Upload, Pill, Download } from 'lucide-react';
import { patientApi } from '../../patientApi';
import { useDoctorCtx } from '../../context/DoctorContext';
import {
  ApiException,
  type PatientVisit,
  type PatientReport,
  type IssuedPrescription,
} from '../../types';
import { StateView } from '../../components/StateView';
import { PatientSwitcher, RequirePatient } from '../../components/PatientSwitcher';
import { usePatientAuth } from '../../auth/PatientAuthContext';

export const MyVisits: React.FC = () => (
  <RequirePatient>
    <MyVisitsForPatient />
  </RequirePatient>
);

const MyVisitsForPatient: React.FC = () => {
  const { doctor } = useDoctorCtx();
  const { selected } = usePatientAuth();
  const queryClient = useQueryClient();
  const profileId = selected!.id;

  const { data: visits, isLoading, error, refetch } = useQuery({
    queryKey: ['patient-visits', profileId, doctor?.id],
    queryFn: () => patientApi.myVisits(profileId, doctor?.id),
  });

  /**
   * Cancelling is the fix for booking under the wrong patient — there is no
   * merge, so an unwanted booking is withdrawn rather than reassigned.
   */
  const cancel = useMutation({
    mutationFn: (id: string) => patientApi.cancelVisit(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['patient-visits'] });
    },
    onError: (err) =>
      alert(err instanceof ApiException ? err.message : 'Could not cancel this booking.'),
  });

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>
        My Visits
      </h2>
      <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: '14px' }}>
        {selected!.name}'s consultation history — doctor's notes and prescriptions from
        each visit. You can upload reports to a visit until the doctor marks it done.
      </p>

      <PatientSwitcher />

      {isLoading ? (
        <StateView loading />
      ) : error ? (
        <StateView
          error={error instanceof Error ? error.message : 'Could not load your visits.'}
          onRetry={() => refetch()}
        />
      ) : !visits?.length ? (
        <StateView empty={`No visits yet for ${selected!.name}. Once an OPD appointment is booked, it will show up here.`} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {visits.map((v) => (
            <VisitCard
              key={v.id}
              visit={v}
              onCancel={() => cancel.mutate(v.id)}
              cancelling={cancel.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const VisitCard: React.FC<{
  visit: PatientVisit;
  onCancel: () => void;
  cancelling: boolean;
}> = ({ visit: v, onCancel, cancelling }) => {
  const [open, setOpen] = useState(false);
  // Only an untouched booking may be withdrawn; once the doctor has engaged
  // with the visit it is a clinical record. The server enforces this too.
  const cancellable =
    v.status === 'confirmed' && v.consultation_status === 'pending';
  // The card expands to reveal details and/or the report-upload box.
  const expandable =
    !!v.doctor_notes ||
    !!v.next_visit_note ||
    !!v.e_prescription ||
    v.prescriptions.length > 0 ||
    v.reports.length > 0 ||
    v.accepts_reports ||
    cancellable;

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
            background:
              v.status === 'rejected' || v.status === 'cancelled'
                ? '#FEE2E2'
                : v.consultation_status === 'done'
                  ? '#DCFCE7'
                  : '#EFF6FF',
            color:
              v.status === 'rejected' || v.status === 'cancelled'
                ? '#B91C1C'
                : v.consultation_status === 'done'
                  ? '#166534'
                  : '#1D4ED8',
          }}
        >
          {v.status === 'rejected'
            ? 'Rejected'
            : v.status === 'cancelled'
              ? 'Cancelled'
              : v.consultation_status.replace('_', ' ')}
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
                  <ReportRow key={r.id} report={r} editable={v.accepts_reports} />
                ))}
              </div>
            </div>
          )}
          {v.accepts_reports && <ReportUploader appointmentId={v.id} />}

          {cancellable && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: '1px solid var(--border)',
              }}
            >
              <button
                type="button"
                className="btn-outlined"
                disabled={cancelling}
                onClick={() => {
                  if (
                    confirm(
                      `Cancel the appointment on ${v.appointment_date} at ${v.start_time?.slice(0, 5)}?\n\nThe slot will be released and any reports you uploaded for this visit will be removed.`,
                    )
                  ) {
                    onCancel();
                  }
                }}
                style={{ color: 'var(--error)', borderColor: '#FCA5A5' }}
              >
                {cancelling ? 'Cancelling…' : 'Cancel this appointment'}
              </button>
              <p
                style={{
                  margin: '8px 0 0',
                  fontSize: 12.5,
                  color: 'var(--text-secondary)',
                }}
              >
                Booked under the wrong patient? Cancel here and book again for the
                right one.
              </p>
            </div>
          )}
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

/**
 * One uploaded report. While the visit is still open the patient may rename it,
 * swap the file, or remove it; once the doctor marks the visit done it becomes a
 * plain read-only link (the server enforces the same cutoff).
 */
const ReportRow: React.FC<{ report: PatientReport; editable: boolean }> = ({
  report: r,
  editable,
}) => {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [title, setTitle] = useState(r.title);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['patient-visits'] });
    qc.invalidateQueries({ queryKey: ['patient-reports'] });
  };
  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiException ? err.message : fallback);

  const save = useMutation({
    mutationFn: () =>
      patientApi.updateVisitReport(
        r.id,
        title.trim() === r.title ? undefined : title.trim(),
        fileRef.current?.files?.[0],
      ),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      if (fileRef.current) fileRef.current.value = '';
      refresh();
    },
    onError: (err) => fail(err, 'Could not update the report. Please try again.'),
  });

  const remove = useMutation({
    mutationFn: () => patientApi.deleteVisitReport(r.id),
    onSuccess: () => { setConfirmingDelete(false); setError(null); refresh(); },
    onError: (err) => fail(err, 'Could not delete the report. Please try again.'),
  });

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (editing) {
    return (
      <div
        onClick={stop}
        style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '12px' }}
      >
        <div className="form-field">
          <input
            type="text"
            className="form-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Report title"
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          style={{ marginBottom: 10, fontSize: 13 }}
        />
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          Choose a file only if you want to replace the current one.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn-primary"
            disabled={save.isPending || !title.trim()}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            className="btn-secondary"
            disabled={save.isPending}
            onClick={() => { setEditing(false); setTitle(r.title); setError(null); }}
          >
            Cancel
          </button>
        </div>
        {error && <div className="error-text" style={{ marginTop: 10 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div
      onClick={stop}
      style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '13px' }}
    >
      <a href={r.url ?? undefined} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
        📄 {r.title}
      </a>

      {editable && !confirmingDelete && (
        <>
          <button className="link-btn" onClick={() => setEditing(true)}>Edit</button>
          <button className="link-btn link-btn-danger" onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
        </>
      )}

      {editable && confirmingDelete && (
        <>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>Delete this?</span>
          <button
            className="link-btn link-btn-danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? 'Deleting…' : 'Yes'}
          </button>
          <button className="link-btn" onClick={() => setConfirmingDelete(false)}>No</button>
        </>
      )}

      {error && <span className="error-text" style={{ fontSize: 12 }}>{error}</span>}
    </div>
  );
};

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
