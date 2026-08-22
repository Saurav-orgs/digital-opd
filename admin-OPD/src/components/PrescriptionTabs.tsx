import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi } from '../api/endpoints';
import type { PrescriptionImage } from '../api/types';
import { useToast } from './Toast';
import { ConsultationRecorder } from './ConsultationRecorder';
import { PrescriptionEditor } from './PrescriptionEditor';
import { HandwritingCanvas } from './HandwritingCanvas';

type Mode = 'handwrite' | 'voice' | 'type' | 'upload';

/**
 * The four ways a doctor/clinic can handle prescriptions for an appointment:
 *   ✍️ Handwrite — e-pen on tablet/stylus/touchscreen
 *   🎙 Voice     — dictate/record; system drafts; doctor reviews
 *   ⌨️ Type      — fill the structured prescription editor directly
 *   📷 Upload Rx — upload physical prescription photos/scans
 */
export function PrescriptionTabs({
  appointmentId,
  canEdit,
  disabled,
}: {
  appointmentId: string;
  canEdit: boolean;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<Mode>('voice');
  const qc = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: appointment } = useQuery({
    queryKey: ['appointment', appointmentId],
    queryFn: () => appointmentsApi.get(appointmentId),
    enabled: !!appointmentId,
  });

  const prescriptions: PrescriptionImage[] = appointment?.prescriptions ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['appointment', appointmentId] });
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const addRx = useMutation({
    mutationFn: (files: File[]) => appointmentsApi.addPrescriptions(appointmentId, files),
    onSuccess: (_data, files) => {
      invalidate();
      toast.success(`Prescription${files.length > 1 ? 's' : ''} uploaded`);
    },
    onError: (e) => toast.error(e),
  });

  const deleteRx = useMutation({
    mutationFn: (rxId: string) => appointmentsApi.deletePrescription(appointmentId, rxId),
    onSuccess: () => {
      invalidate();
      toast.success('Prescription deleted');
    },
    onError: (e) => toast.error(e),
  });

  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <TabBtn label="✍️ Handwrite" active={mode === 'handwrite'} onClick={() => setMode('handwrite')} />
        <TabBtn label="🎙 Voice" active={mode === 'voice'} onClick={() => setMode('voice')} />
        <TabBtn label="⌨️ Type" active={mode === 'type'} onClick={() => setMode('type')} />
        <TabBtn
          label={prescriptions.length > 0 ? `📷 Upload Rx (${prescriptions.length})` : '📷 Upload Rx'}
          active={mode === 'upload'}
          onClick={() => setMode('upload')}
        />
      </div>

      {mode === 'handwrite' && (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 10 }}>
            Write the prescription by hand — on a tablet use your stylus. It prints on
            your letterhead exactly like your paper pad.
          </p>
          <HandwritingCanvas appointmentId={appointmentId} canEdit={canEdit} />
        </>
      )}

      {mode === 'voice' && (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 10 }}>
            Record the consultation and the system drafts a prescription. Nothing is
            sent to the patient until you issue it.
          </p>
          {canEdit && <ConsultationRecorder appointmentId={appointmentId} disabled={disabled} />}
          <div style={{ marginTop: 16 }}>
            <PrescriptionEditor appointmentId={appointmentId} canEdit={canEdit} />
          </div>
        </>
      )}

      {mode === 'type' && (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 10 }}>
            Fill in the diagnosis, medicines, and advice, then issue when ready.
          </p>
          <PrescriptionEditor appointmentId={appointmentId} canEdit={canEdit} />
        </>
      )}

      {mode === 'upload' && (
        <div className="stack" style={{ gap: 14 }}>
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
            Upload photos or scanned copies of the physical prescription.
          </p>

          {prescriptions.length === 0 ? (
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                background: 'var(--page)',
                borderRadius: 'var(--radius-control)',
                border: '1px dashed var(--border)',
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 6 }}>📄</div>
              <div style={{ fontWeight: 500, fontSize: 13 }}>No prescription images uploaded yet</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                Upload photos of hand-written pads or previous prescriptions
              </div>
            </div>
          ) : (
            <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
              {prescriptions.map((p) => (
                <div
                  key={p.id}
                  style={{
                    position: 'relative',
                    borderRadius: 8,
                    overflow: 'hidden',
                    border: 'var(--hairline)',
                    background: '#fff',
                  }}
                >
                  <a href={p.url} target="_blank" rel="noreferrer" title="Click to view full image">
                    <img
                      src={p.url}
                      alt="Prescription"
                      style={{
                        width: 110,
                        height: 110,
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  </a>
                  {canEdit && (
                    <button
                      type="button"
                      title="Delete prescription image"
                      disabled={deleteRx.isPending}
                      onClick={() => deleteRx.mutate(p.id)}
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: 'rgba(226, 75, 74, 0.9)',
                        color: '#fff',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        lineHeight: 1,
                        fontSize: 13,
                        fontWeight: 'bold',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) addRx.mutate(files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={addRx.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                {addRx.isPending ? 'Uploading…' : '+ Upload prescription images'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`btn btn-sm ${active ? 'btn-primary' : ''}`}
      onClick={onClick}
      style={{ fontWeight: active ? 600 : 400 }}
    >
      {label}
    </button>
  );
}
