import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi, consultationApi } from '../api/endpoints';
import type { PrescriptionImage } from '../api/types';
import { useToast } from './Toast';
import { ConsultationRecorder } from './ConsultationRecorder';
import { PrescriptionEditor } from './PrescriptionEditor';
import { HandwritingCanvas } from './HandwritingCanvas';
import { CameraCapture, cameraAvailable } from './CameraCapture';
import { DocumentIcon, KeyboardIcon, MicIcon, PenIcon, UploadIcon } from './icons';
import { IvfCaseSheetEditor } from './IvfCaseSheetEditor';
import { IssuedActions } from './IssuedActions';
import type { DraftFlushRef } from '../lib/draftFlush';
import type { IssueModeRef } from '../lib/issueMode';
import type { IssueMode } from '../api/types';

export type Mode = 'voice' | 'upload' | 'type' | 'handwrite' | 'ivf';

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
 * The document a tab writes.
 *
 * Type and Record collapse to one: they are two ways of filling the same form,
 * and a doctor who dictates and then corrects a dosage by hand has not changed
 * what they are writing. `ivf` has no entry — the case-sheet is issued through
 * its own endpoint, and its tab never shows the page's Issue button.
 */
/** How a tab is named in a sentence — the word on the tab, as the doctor reads it. */
const TAB_LABEL: Record<Mode | 'ivf', string> = {
  type: 'the Type tab',
  voice: 'the Record tab',
  handwrite: 'the Handwrite tab',
  upload: 'the Upload tab',
  ivf: 'the IVF form',
};

const ISSUE_MODE: Partial<Record<Mode, IssueMode>> = {
  type: 'structured',
  voice: 'structured',
  handwrite: 'handwritten',
  upload: 'uploaded',
};

/**
 * What the Upload tab says once the prescription has gone out.
 *
 * Three cases, because the tab is reachable after issuing from any mode: the
 * scans that were sent, or none — a prescription typed or dictated elsewhere,
 * whose doctor then opened this tab looking for Withdraw.
 */
function issuedHint(scans: number): string {
  if (scans === 0) {
    return "This visit's prescription was issued without a scan. Withdraw it to attach one.";
  }
  if (scans === 1) {
    return 'This scan was sent to the patient. Withdraw the prescription to change or replace it.';
  }
  return 'These scans were sent to the patient. Withdraw the prescription to change or replace them.';
}

/**
 * The ways a doctor/clinic can handle prescriptions for an appointment,
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
  issueModeRef,
  onRecorderBusy,
  footer,
  patientChip,
  modes = MODES,
  issuedVia = null,
  patientName,
  patientAge,
}: {
  appointmentId: string;
  canEdit: boolean;
  disabled?: boolean;
  /**
   * Which ways of writing a prescription this doctor is offered.
   *
   * An IVF & Fertility doctor gets `['ivf', 'handwrite', 'upload']`: the IVF
   * form replaces the medicine-row editor and the recorder, and sits as a tab
   * beside the two that still make sense for them — a scan of a pad, or an
   * e-pen page. Everyone else gets the default four. `ivf` is never in the
   * default list.
   */
  modes?: Mode[];
  /**
   * Which document this visit was issued as, or null while it is still a draft.
   *
   * Each editor already freezes itself when the document *it* writes is issued
   * — `PrescriptionEditor` and `HandwritingCanvas` both swap to the issued
   * copy. What none of them can see is the other document: an IVF doctor's
   * case-sheet and their handwritten page are different tables, so issuing the
   * sheet left the Handwrite pad writable and a second prescription for the
   * same visit one click away.
   */
  issuedVia?: 'prescription' | 'ivf' | null;
  /** Prefill for the IVF form's patient fields. */
  patientName?: string;
  patientAge?: number | null;
  /**
   * Preview and Issue, pinned under whichever mode is showing.
   *
   * Here rather than inside `PrescriptionEditor` because a handwritten or
   * uploaded prescription is issued the same way, and that editor renders in
   * only two of the four modes.
   */
  footer?: ReactNode;
  /**
   * Who the prescription is for, between the mode tabs and the form — the
   * place the design puts it, and the only patient detail on screen while
   * the doctor is writing.
   */
  patientChip?: ReactNode;
  /** The recorder's own busy state (mic open, audio uploading), for the page's CTA. */
  onRecorderBusy?: (busy: boolean) => void;
  /*
   * Handed down to whichever mode is showing so the Preview step can make the
   * server hold the current draft before it renders. Upload mode registers
   * nothing — a photo is already on the server the moment it is picked.
   */
  flushRef?: DraftFlushRef;
  /**
   * Kept pointing at the tab showing, for the page's Preview and Issue.
   *
   * Only that tab's content is issued, so the buttons have to know which one
   * it is — and they are rendered by the page, which deliberately does not
   * re-render when the doctor switches tabs.
   */
  issueModeRef?: IssueModeRef;
}) {
  const [mode, setModeState] = useState<Mode>(() => {
    const remembered = readMode(appointmentId);
    // A doctor who last typed here, and whose card no longer offers Type,
    // must not be left on a tab that is not rendered.
    return remembered && modes.includes(remembered) ? remembered : modes[0];
  });
  /** Only switch to a tab this card actually shows. */
  const offers = (m: Mode) => modes.includes(m);
  /**
   * Has this visit's e-prescription gone to the patient?
   *
   * `PrescriptionEditor` and `HandwritingCanvas` each answer this for
   * themselves from the same query. Upload and Record have no editor of their
   * own to ask, so the tabs read it here.
   */
  const rxIssued = issuedVia === 'prescription';
  /**
   * The tabs that hold what the patient was actually handed.
   *
   * One visit can carry three drafts and the patient gets one of them, so the
   * issued prescription records which tab it came from. Every other tab is
   * showing working material that nobody has — it has to say so rather than
   * sit there looking issued, or looking writable.
   *
   * A prescription issued before this change has no `uploaded` mode to record,
   * so an old scan-only visit reads as structured and points at the typed tab.
   * It is one line of text on a finished visit, and the alternative is
   * guessing.
   */
  const issuedTabs = (): Mode[] => {
    const held: Mode[] =
      draft?.mode === 'handwritten'
        ? ['handwrite']
        : draft?.mode === 'uploaded'
          ? ['upload']
          : ['type', 'voice'];
    // Never point a doctor at a tab their card does not show: an IVF card has
    // no Type tab, and a structured prescription on one would otherwise send
    // them to a panel that is not rendered.
    const shown = held.filter(offers);
    return shown.length > 0 ? shown : held;
  };
  /**
   * A tab that is not the document this visit was issued as.
   *
   * Upload used to be excluded here, on the grounds that it attaches a photo
   * of a paper prescription rather than writing one. It is one of the three
   * now, like any other.
   */
  const frozen = (m: Mode) => {
    if (issuedVia === 'ivf') return m !== 'ivf';
    if (issuedVia === 'prescription') return m === 'ivf' || !issuedTabs().includes(m);
    return false;
  };
  /** Is `m` the tab showing, and not frozen behind an issued prescription? */
  const shows = (m: Mode) => mode === m && !frozen(m);
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
    const prefer = draft.handwriting_image_url
      ? 'handwrite'
      : hasDraft
        ? draft.consultation_session_id
          ? 'voice'
          : 'type'
        : prescriptions.length > 0
          ? 'upload'
          : null;
    if (prefer && offers(prefer)) setModeState(prefer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, appointment]);

  /*
   * Keep the page's buttons pointed at the tab showing.
   *
   * No dependency array, like the pad's `flushRef` registration: the ref has
   * to be right on every render, and writing one costs nothing. A ref rather
   * than a callback because the alternative is `setState` in an effect in the
   * page, which re-renders the whole visit each time a doctor glances at
   * another tab.
   */
  useEffect(() => {
    if (issueModeRef) issueModeRef.current = ISSUE_MODE[mode] ?? null;
  });

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
      {/*
        The card's own header: the title, with the four modes as a segmented
        control beside it. There was no header at all, and the modes were four
        large stacked tiles across the full width — which read as the page's
        primary navigation rather than as a choice of how to write this one
        prescription. Order is the design's: Type, Record, Handwrite, Upload.
      */}
      <div className="rx-head">
        <h3>Prescription</h3>
        <div className="rx-modes">
          {offers('ivf') && (
            <TabBtn
              label="IVF"
              icon={<DocumentIcon size={15} />}
              active={mode === 'ivf'}
              onClick={() => setMode('ivf')}
            />
          )}
          {offers('type') && (
            <TabBtn
              label="Type"
              icon={<KeyboardIcon size={15} />}
              active={mode === 'type'}
              onClick={() => setMode('type')}
            />
          )}
          {offers('voice') && (
            <TabBtn
              label="Record"
              icon={<MicIcon size={15} />}
              active={mode === 'voice'}
              onClick={() => setMode('voice')}
            />
          )}
          {offers('handwrite') && (
            <TabBtn
              label="Handwrite"
              icon={<PenIcon size={15} />}
              active={mode === 'handwrite'}
              onClick={() => setMode('handwrite')}
            />
          )}
          {offers('upload') && (
            <TabBtn
              label={prescriptions.length > 0 ? `Upload (${prescriptions.length})` : 'Upload'}
              icon={<UploadIcon size={15} />}
              active={mode === 'upload'}
              onClick={() => setMode('upload')}
            />
          )}
        </div>
      </div>

      {patientChip}

      {frozen(mode) && (
        <IssuedElsewhere
          where={issuedVia === 'ivf' ? 'ivf' : issuedTabs()[0]}
          onGo={() => setMode(issuedVia === 'ivf' ? 'ivf' : issuedTabs()[0])}
        />
      )}

      {shows('ivf') && (
        <IvfCaseSheetEditor
          appointmentId={appointmentId}
          canEdit={canEdit}
          disabled={!!disabled}
          patientName={patientName}
          patientAge={patientAge}
        />
      )}

      {shows('handwrite') && (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 10 }}>
            Write the prescription by hand — on a tablet use your stylus. It prints on
            your letterhead exactly like your paper pad.
          </p>
          <HandwritingCanvas appointmentId={appointmentId} canEdit={canEdit} flushRef={flushRef} />
        </>
      )}

      {shows('voice') && (
        <>
          {/*
            The microphone goes away once the prescription is issued.
            `PrescriptionEditor` below only renders when there is a draft, so a
            visit issued from the Upload tab — no diagnosis, no medicines, just
            a photo — left this tab showing a live "tap to record" and nothing
            else saying the visit was over. The doctor could dictate a whole
            prescription before the server refused to save it.
          */}
          {!rxIssued && (
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
            </>
          )}

          {/*
            The fields appear once dictation has something to put in them.
            Before that this panel is the microphone and nothing else — an
            empty diagnosis box under a "tap to record" button invites the
            doctor to type in the tab that exists for not typing.

            Once a draft is there it stays there, so correcting it never means
            switching tabs to find what the recording produced.
          */}
          {(hasDraft || rxIssued) && (
            <>
              {!rxIssued && <div className="rx-panel-divider" />}
              <PrescriptionEditor
                appointmentId={appointmentId}
                canEdit={canEdit}
                flushRef={flushRef}
                footerExtras={footer}
              />
            </>
          )}
        </>
      )}

      {shows('type') && (
        <>
          <PrescriptionEditor
            appointmentId={appointmentId}
            canEdit={canEdit}
            flushRef={flushRef}
            showTemplates
            footerExtras={footer}
          />
        </>
      )}

      {shows('upload') && (
        <div className="stack" style={{ gap: 14 }}>
          {/*
            An issued upload tab is the issued prescription, shown the same way
            Type shows it: the badge, the ways of handing it over, Withdraw.
            Before this the tab looked identical to a draft one — the scans
            still had their delete crosses and "Take photo" still sat under
            them — so the only clue the visit had gone out was the footer
            swapping its button for a line of text, and Withdraw was reachable
            only from a tab the doctor had never opened.
          */}
          {rxIssued ? (
            <>
              <IssuedActions
                appointmentId={appointmentId}
                canEdit={canEdit}
                pdfUrl={draft?.pdf_url}
              />
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                {issuedHint(prescriptions.length)}
              </p>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
              Photograph the prescription, or upload a scan you already have.
            </p>
          )}

          {/* Two conditions rather than one either/or: an issued visit with no
              scan — one issued from Type, whose doctor then opened this tab —
              gets neither the gallery nor a dashed box inviting an upload it
              will refuse. */}
          {prescriptions.length === 0 && !rxIssued && (
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
          )}
          {prescriptions.length > 0 && (
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
                  {canEdit && !rxIssued && (
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

          {canEdit && !rxIssued && (
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

      {/*
        Handwrite and Upload have no editor to carry the footer, so they get
        their own. In Type and Record it is handed to the editor instead, so
        Clear, Save as template and Draft saved sit on the same line as
        Preview and Issue — one row, as the design has it.

        Gone once the prescription is issued: `IssuedActions` is the row then,
        in every mode. Keeping this one as well left Upload with a Preview
        button and an "Issued to the patient" label underneath the badge that
        had just said so.
      */}
      {footer && !rxIssued && (shows('handwrite') || shows('upload')) && (
        <div className="vfoot">
          <div className="vfoot-grow" />
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * What a tab shows once this visit was issued from a different one.
 *
 * It names which, and offers to go there, because the doctor's next move is
 * always the same: withdraw, then write. The alternative is a tab that sits
 * there writable and lets them issue a second prescription for one visit; the
 * server refuses that, but a refusal met after writing a page is a worse way
 * to learn it.
 *
 * It used to appear only for an IVF doctor's case-sheet, because every other
 * tab was assumed to hold the same document. They do not: a visit holds a
 * typed draft, an e-pen page and photographs independently, and the patient
 * was handed exactly one of them.
 */
function IssuedElsewhere({
  where,
  onGo,
}: {
  /** The tab that holds it — `ivf` for the case-sheet, otherwise a mode. */
  where: Mode | 'ivf';
  onGo: () => void;
}) {
  const label = TAB_LABEL[where];
  return (
    <div className="rx-frozen">
      <div>
        <b>This visit's prescription has been issued.</b>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
          It was issued from {label}, and that is what the patient has. Withdraw
          it there to make any changes.
        </div>
      </div>
      <button type="button" className="btn btn-sm" onClick={onGo}>
        Open {label}
      </button>
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
