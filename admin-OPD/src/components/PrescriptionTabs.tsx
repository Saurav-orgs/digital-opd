import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi, consultationApi } from '../api/endpoints';
import type { PrescriptionImage } from '../api/types';
import { useToast } from './Toast';
import { ConsultationRecorder } from './ConsultationRecorder';
import { PrescriptionEditor } from './PrescriptionEditor';
import { HandwritingCanvas } from './HandwritingCanvas';
import { CameraCapture, cameraAvailable } from './CameraCapture';
import { KeyboardIcon, MicIcon, PenIcon, UploadIcon } from './icons';
import type { DraftFlushRef } from '../lib/draftFlush';

type Mode = 'voice' | 'upload' | 'type' | 'handwrite';

const MODES: Mode[] = ['voice', 'upload', 'type', 'handwrite'];
const MODE_KEY = 'opd_admin_rx_mode:';

/**
 * The tab the doctor last wrote in, per visit.
 *
 * A doctor who typed half a prescription, went back to the list and returned
 * used to land on Record with the microphone — and the fields they had filled
 * were on a tab away. The choice is kept per appointment and per browser, so
 * the visit reopens on the tab it was being written in. Storage can be
 * absent or throw (Safari private mode); a mode that cannot be remembered
 * still applies for the session.
 */
function readMode(appointmentId: string): Mode | null {
  try {
    const v = localStorage.getItem(MODE_KEY + appointmentId);
    return MODES.includes(v as Mode) ? (v as Mode) : null;
  } catch {
    return null;
  }
}

function writeMode(appointmentId: string, mode: Mode) {
  try {
    localStorage.setItem(MODE_KEY + appointmentId, mode);
  } catch {
    // Nothing to do — the tab still switches.
  }
}

/**
 * The four ways a doctor/clinic can handle prescriptions for an appointment,
 * listed in the order they are actually reached for:
 *   🎙 Voice     — dictate/record; system drafts; doctor reviews
 *   📷 Upload    — upload physical prescription photos/scans
 *   ⌨️ Type      — fill the structured prescription editor directly
 *   ✍️ Handwrite — e-pen on tablet/stylus/touchscreen
 */
export function PrescriptionTabs({
  appointmentId,
  canEdit,
  disabled,
  flushRef,
  onRecorderBusy,
}: {
  appointmentId: string;
  canEdit: boolean;
  disabled?: boolean;
  /** The recorder's own busy state (mic open, audio uploading), for the page's CTA. */
  onRecorderBusy?: (busy: boolean) => void;
  /*
   * Handed down to whichever mode is showing so the Preview step can make the
   * server hold the current draft before it renders. Upload mode registers
   * nothing — a photo is already on the server the moment it is picked.
   */
  flushRef?: DraftFlushRef;
}) {
  const [mode, setModeState] = useState<Mode>(() => readMode(appointmentId) ?? 'voice');
  const setMode = (m: Mode) => {
    setModeState(m);
    writeMode(appointmentId, m);
  };
  const [cameraOpen, setCameraOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: appointment } = useQuery({
    queryKey: ['appointment', appointmentId],
    queryFn: () => appointmentsApi.get(appointmentId),
    enabled: !!appointmentId,
  });

  const prescriptions: PrescriptionImage[] = appointment?.prescriptions ?? [];

  /*
   * Has dictation produced anything yet?
   *
   * Read from the prescription rather than the recording session, because the
   * session is transient — it is gone on a reload, and the draft it produced
   * is not. A visit reopened tomorrow still shows the fields it filled in.
   */
  const { data: draft } = useQuery({
    queryKey: ['prescription', appointmentId],
    queryFn: () => consultationApi.prescription(appointmentId),
    enabled: !!appointmentId,
  });
  const hasDraft =
    !!draft?.diagnosis?.trim() ||
    !!draft?.previous_history?.trim() ||
    !!draft?.advice?.trim() ||
    (draft?.medicines?.length ?? 0) > 0;

  /*
   * No remembered tab — another browser, or storage that was cleared — so
   * the prescription itself says where it was written: a handwritten page
   * opens the pad, a typed draft opens the editor, a dictated one opens
   * Record with its fields, an upload opens the gallery. Decided once, from
   * the first data that arrives, so it never switches tabs under the doctor.
   */
  const inferredRef = useRef(readMode(appointmentId) !== null);
  useEffect(() => {
    if (inferredRef.current || !draft || !appointment) return;
    inferredRef.current = true;
    if (draft.handwriting_image_url) setModeState('handwrite');
    else if (hasDraft) setModeState(draft.consultation_session_id ? 'voice' : 'type');
    else if (prescriptions.length > 0) setModeState('upload');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, appointment]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['appointment', appointmentId] });
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const addRx = useMutation({
    mutationFn: (files: File[]) => appointmentsApi.addPrescriptions(appointmentId, files),
    onSuccess: (_data, files) => {
      invalidate();
      setCameraOpen(false);
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
      {/* Four equal tiles in the design's own order — record first, because
          dictating is what a doctor reaches for while the patient is still in
          the chair, and upload last because it is the fallback. */}
      <div className="rx-tabs">
        <TabBtn
          label="Record"
          icon={<MicIcon size={18} />}
          active={mode === 'voice'}
          onClick={() => setMode('voice')}
        />
        <TabBtn
          label="Type"
          icon={<KeyboardIcon size={18} />}
          active={mode === 'type'}
          onClick={() => setMode('type')}
        />
        <TabBtn
          label="Handwrite"
          icon={<PenIcon size={18} />}
          active={mode === 'handwrite'}
          onClick={() => setMode('handwrite')}
        />
        <TabBtn
          label={prescriptions.length > 0 ? `Upload (${prescriptions.length})` : 'Upload'}
          icon={<UploadIcon size={18} />}
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
          <HandwritingCanvas appointmentId={appointmentId} canEdit={canEdit} flushRef={flushRef} />
        </>
      )}

      {mode === 'voice' && (
        <>
          <div className="rx-panel-title">Record prescription</div>
          <div className="rx-panel-sub">Dictate the diagnosis and medicines</div>
          {canEdit && (
            <ConsultationRecorder
              appointmentId={appointmentId}
              disabled={disabled}
              onBusyChange={onRecorderBusy}
              flushRef={flushRef}
            />
          )}

          {/*
            The fields appear once dictation has something to put in them.
            Before that this panel is the microphone and nothing else — an
            empty diagnosis box under a "tap to record" button invites the
            doctor to type in the tab that exists for not typing.

            Once a draft is there it stays there, so correcting it never means
            switching tabs to find what the recording produced.
          */}
          {hasDraft && (
            <>
              <div className="rx-panel-divider" />
              <PrescriptionEditor
                appointmentId={appointmentId}
                canEdit={canEdit}
                flushRef={flushRef}
              />
            </>
          )}
        </>
      )}

      {mode === 'type' && (
        <>
          <PrescriptionEditor appointmentId={appointmentId} canEdit={canEdit} flushRef={flushRef} />
        </>
      )}

      {mode === 'upload' && (
        <div className="stack" style={{ gap: 14 }}>
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
            Photograph the prescription, or upload a scan you already have.
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
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {/* Taking the photo here is the common case in a clinic — the
                    paper is on the desk. Choosing a file is for a scan that
                    already exists, so it is the quieter of the two. */}
                {cameraAvailable() && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={addRx.isPending}
                    onClick={() => setCameraOpen(true)}
                  >
                    📷 Take photo
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={addRx.isPending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {addRx.isPending ? 'Uploading…' : 'Choose files'}
                </button>
              </div>
            </div>
          )}

          {cameraOpen && (
            <CameraCapture
              busy={addRx.isPending}
              onCapture={(file) => addRx.mutate([file])}
              onClose={() => setCameraOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TabBtn({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rx-tab ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="rx-tab-icon" aria-hidden>
        {icon}
      </span>
      <span className="rx-tab-label">{label}</span>
    </button>
  );
}
