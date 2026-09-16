import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { consultationApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { useToast } from './Toast';
import { printBlob } from '../lib/printBlob';
import { PdfPages, type PdfFit } from './PdfPages';
import { ConfirmDialog, Loading, Modal } from './ui';
import {
  CheckCircleIcon,
  CloseIcon,
  DownloadIcon,
  MaximizeIcon,
  PdfIcon,
  PrinterIcon,
  ShareIcon,
  TrashIcon,
} from './icons';

/**
 * Prints the visit's issued prescription.
 *
 * Printed without the letterhead: doctors print onto their own pad, which
 * already carries the header, so the copy that goes to paper leaves that
 * space blank. The file the patient gets (issue, share, download) keeps it.
 */
export function PrintPrescriptionButton({ appointmentId }: { appointmentId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const onPrint = async () => {
    setBusy(true);
    try {
      const blob = await consultationApi.prescriptionPrintCopy(appointmentId);
      const outcome = await printBlob(blob);
      if (outcome === 'opened') {
        toast.success(
          'Prescription opened in a new tab',
          'This browser would not open the print dialog itself — print it from there.',
        );
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Could not print the prescription.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="btn btn-sm" onClick={onPrint} disabled={busy}>
      {busy ? 'Preparing…' : '🖨 Print'}
    </button>
  );
}

/**
 * The draft as the page it is about to become.
 *
 * Issuing is visible to the patient the moment it happens, so the last check
 * before it should be against the real document — the letterhead, the way the
 * medicines column breaks, whether the advice fits — and not against the
 * editor's fields, which look nothing like it.
 *
 * `load` is passed in rather than fixed here because each mode has its own
 * "make sure the server has the current draft" step first: the editor saves
 * its fields, the handwriting pad uploads its strokes.
 */
/** How a visit ended. All three finish it; only one of them issues. */
type FinishKind = 'share' | 'print' | 'issue';

const FINISH_MESSAGE: Record<FinishKind, (name: string) => string> = {
  share: (name) => `Prescription shared with ${name}.`,
  print: () => 'Prescription sent to the printer.',
  issue: (name) =>
    `Prescription issued to ${name}. It is now in their myDigitalOPD account.`,
};

/**
 * Fetch the draft as a PDF once and hand back the rendered document plus the
 * blob behind it.
 *
 * Pulled out of the modal so the same render can be shown inline as a step of
 * the consultation, not only in a dialog. `reloadKey` is the one way to make it
 * fetch again: a preview that re-fetched on its own would replace the page
 * under the doctor mid-read, which is why the original loaded exactly once.
 */
function usePreviewDocument(load: () => Promise<Blob>, reloadKey: unknown) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setBlob(null);
    setError(null);

    load()
      .then((b) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(b);
        setBlob(b);
        setUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not render the prescription preview.',
        );
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  return { url, blob, error };
}

/**
 * The document itself: the letterhead page, or why it could not be rendered.
 *
 * Drawn with pdf.js rather than framed — a framed PDF is blank on Android
 * Chrome, which has no viewer to put in the frame (see `PdfPages`).
 */
function PreviewFrame({
  blob,
  error,
  height,
  fit,
  onPageCount,
}: {
  blob: Blob | null;
  error: string | null;
  height: string;
  fit?: PdfFit;
  onPageCount?: (n: number) => void;
}) {
  if (error) return <div className="empty">{error}</div>;
  if (!blob) return <Loading label="Rendering the prescription…" />;
  return <PdfPages blob={blob} height={height} fit={fit} onPageCount={onPageCount} />;
}

/**
 * The document over everything else, as large as the screen allows.
 *
 * The inline preview fits the whole page into its box so the step never
 * scrolls, which on a phone makes the text small. This is the other half of
 * that bargain: one tap opens the same document at full width, scrolling,
 * for the doctor who wants to read a dosage rather than check a layout.
 */
function MaximisedPreview({
  blob,
  name,
  onClose,
}: {
  blob: Blob;
  name: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="pdf-max-backdrop" role="dialog" aria-modal="true" aria-label="Prescription preview">
      <div className="pdf-max">
        <div className="pdf-bar">
          <PdfIcon size={16} />
          <span className="pdf-bar-name">{name}</span>
          <button className="pdf-bar-icon" onClick={onClose} aria-label="Close" title="Close">
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="pdf-max-body">
          <PdfPages blob={blob} height="100%" fit="width" />
        </div>
      </div>
    </div>
  );
}

/**
 * The preview as a step of the consultation rather than a dialog over it, and
 * the place the visit now ends.
 *
 * Three ways out, and all three finish the consultation: share it, print it,
 * or issue it to the patient's account. That is the client's decision and it
 * matches the room — once the patient has the prescription in some form, the
 * visit is over, so there is no separate "Complete" button any more.
 *
 * Only **Issue** actually issues. Share and print hand over a copy of the
 * draft; issuing is what freezes the document and makes it visible in the
 * patient's account, so it stays a deliberate, separate press.
 *
 * Nothing here is one-way. A doctor who spots a wrong dosage after printing
 * can go back, fix it and finish again — `onFinished` is safe to call twice.
 */
export function PrescriptionPreviewPanel({
  appointmentId,
  patientName,
  canIssue,
  alreadyIssued,
  load,
  reloadKey,
  onEdit,
  onFinished,
  onBackToList,
  onDeleted,
}: {
  appointmentId: string;
  patientName: string;
  /** False for a viewer who may look but not act. */
  canIssue: boolean;
  /** The prescription is frozen: it can be shared and printed, not re-issued. */
  alreadyIssued?: boolean;
  load: () => Promise<Blob>;
  /** Change this to re-render the document — e.g. on returning to this step. */
  reloadKey?: unknown;
  /** Sends the doctor back to the prescription step. */
  onEdit?: () => void;
  /** Called once the visit has been shared, printed or issued. */
  onFinished?: () => void;
  /** Leaves for the appointment list from the success panel. */
  onBackToList?: () => void;
  /**
   * Called once the prescription has been deleted server-side. The caller
   * decides where to go — usually back to a blank editor. Omitted when the
   * document cannot be deleted from here.
   */
  onDeleted?: () => void;
}) {
  const { url, blob, error } = usePreviewDocument(load, reloadKey);
  const toast = useToast();
  const qc = useQueryClient();
  const [finishedBy, setFinishedBy] = useState<FinishKind | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [maximised, setMaximised] = useState(false);
  const [pageCount, setPageCount] = useState(1);

  const finish = (kind: FinishKind) => {
    setFinishedBy(kind);
    onFinished?.();
  };

  const issue = useMutation({
    mutationFn: () => consultationApi.issuePrescription(appointmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription', appointmentId] });
      qc.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      finish('issue');
    },
    onError: (e) => toast.error(e),
  });

  const remove = useMutation({
    mutationFn: () => consultationApi.removePrescription(appointmentId),
    onSuccess: async () => {
      // Wait for the refetch: the editor the caller sends us back to must
      // open on the fresh blank draft, not the cached one just deleted.
      await qc.invalidateQueries({ queryKey: ['prescription', appointmentId] });
      qc.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      setConfirmDelete(false);
      toast.success(
        'Prescription deleted',
        alreadyIssued
          ? 'The patient no longer has it. Write a new one if the visit needs it.'
          : 'Write a new one if the visit needs it.',
      );
      onDeleted?.();
    },
    onError: (err: unknown) => {
      setConfirmDelete(false);
      toast.error(
        err instanceof ApiError ? err.message : 'Could not delete the prescription.',
      );
    },
  });

  const download = () => {
    if (!blob) return;
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = 'prescription.pdf';
    a.click();
    URL.revokeObjectURL(href);
  };

  const share = async () => {
    if (!blob) return;
    const file = new File([blob], 'prescription.pdf', { type: 'application/pdf' });
    // Not every browser can share a file; the ones that cannot get the
    // download instead, which is the same document by another route.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Prescription' });
      } catch {
        return; // the doctor dismissed the sheet — nothing happened, so nothing closes
      }
      finish('share');
      return;
    }
    toast.success('Sharing is not available here — downloading instead.');
    download();
    finish('share');
  };

  const [printing, setPrinting] = useState(false);

  // Not the blob on screen: the print copy is rendered again without the
  // letterhead, because it goes onto the doctor's own pre-printed pad. The
  // preview, and everything that reaches the patient as a file, keep it.
  const print = async () => {
    if (!blob) return;
    setPrinting(true);
    try {
      const printCopy = await consultationApi.prescriptionPrintCopy(appointmentId);
      await printBlob(printCopy);
      finish('print');
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : 'Could not prepare the print copy.',
      );
    } finally {
      setPrinting(false);
    }
  };

  if (finishedBy) {
    return (
      <div className="success-panel">
        <div className="success-icon" aria-hidden>
          <CheckCircleIcon size={30} />
        </div>
        <div className="success-title">Appointment finished</div>
        <div className="success-sub">{FINISH_MESSAGE[finishedBy](patientName)}</div>
        <div className="success-ctas">
          {onBackToList && (
            <button className="success-cta primary" onClick={onBackToList}>
              Back to appointments
            </button>
          )}
          <button className="success-cta secondary" onClick={() => setFinishedBy(null)}>
            Back to preview
          </button>
        </div>
      </div>
    );
  }

  const fileName = `Prescription_${patientName.replace(/\s+/g, '_')}.pdf`;
  const canDelete = canIssue && !!onDeleted;

  return (
    <div>
      {/* The document, in a viewer rather than bare — the design frames it as
          the file it is about to become. The whole page fits the box (no
          scrolling, at the client's request); the maximise button is the
          way to read it at size. Delete sits top-right of the document, where
          a file's own controls live, rather than as a button under the page. */}
      <div className="pdf-viewer">
        <div className="pdf-bar">
          <PdfIcon size={16} />
          <span className="pdf-bar-name">{fileName}</span>
          {onEdit && (
            <button className="pdf-bar-edit" onClick={onEdit}>
              Edit
            </button>
          )}
          <button
            className="pdf-bar-icon"
            disabled={!blob}
            onClick={() => setMaximised(true)}
            aria-label="Open full view"
            title="Open full view"
          >
            <MaximizeIcon size={15} />
          </button>
          {canDelete && (
            <button
              className="pdf-bar-icon danger"
              disabled={remove.isPending}
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete prescription"
              title="Delete prescription"
            >
              <TrashIcon size={15} />
            </button>
          )}
        </div>
        <div className="pdf-scroll pdf-fit-page">
          <PreviewFrame
            blob={blob}
            error={error}
            height="var(--pdf-fit-height)"
            fit="page"
            onPageCount={setPageCount}
          />
          {pageCount > 1 && (
            <div className="pdf-more-pages">
              Page 1 of {pageCount} — open the full view to read the rest.
            </div>
          )}
        </div>
      </div>

      {maximised && blob && (
        <MaximisedPreview blob={blob} name={fileName} onClose={() => setMaximised(false)} />
      )}

      {canIssue && (
        <>
          {alreadyIssued ? (
            <div className="issued-note">
              <CheckCircleIcon size={17} />
              Already issued — the patient has this in their account.
            </div>
          ) : (
            <button
              className="issue-btn"
              disabled={!url || issue.isPending}
              onClick={() => issue.mutate()}
            >
              <CheckCircleIcon size={19} />
              {issue.isPending ? 'Issuing…' : 'Issue to patient'}
            </button>
          )}

          <div className="preview-actions">
            <button className="prev-action-btn" disabled={!blob} onClick={share}>
              <ShareIcon size={18} />
              <span className="prev-action-label">Share</span>
            </button>
            <button className="prev-action-btn" disabled={!blob || printing} onClick={print}>
              <PrinterIcon size={18} />
              <span className="prev-action-label">{printing ? 'Preparing…' : 'Print'}</span>
            </button>
            <button className="prev-action-btn" disabled={!blob} onClick={download}>
              <DownloadIcon size={18} />
              <span className="prev-action-label">Download</span>
            </button>
          </div>

          {!alreadyIssued && (
            <p className="muted preview-note">
              Sharing, printing or issuing marks this visit complete. Only
              <strong> Issue to patient</strong> puts it in their myDigitalOPD
              account. Print leaves the header blank for your own pad.
            </p>
          )}
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this prescription?"
          destructive
          busy={remove.isPending}
          confirmLabel="Delete"
          message={
            alreadyIssued ? (
              <>
                The patient can already see this prescription. Deleting it
                removes their copy, the PDF and the notification they were
                sent, along with every medicine and note on it.
                <br />
                <br />
                This cannot be undone. To correct it instead, use Withdraw in
                the editor — that keeps the medicines as a draft.
              </>
            ) : (
              <>
                Every medicine, the diagnosis, advice and any handwriting on
                this draft will be removed. Nothing has been sent to the
                patient, so they are not affected.
                <br />
                <br />
                This cannot be undone.
              </>
            )
          }
          onConfirm={() => remove.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

export function PrescriptionPreviewModal({
  load,
  onClose,
  onIssue,
  issuing,
}: {
  load: () => Promise<Blob>;
  onClose: () => void;
  /** Omitted when the viewer cannot issue — then this is a look, not a step. */
  onIssue?: () => void;
  issuing?: boolean;
}) {
  const { url, blob, error } = usePreviewDocument(load, 'once');
  const body: ReactNode = <PreviewFrame blob={blob} error={error} height="68vh" />;

  return (
    <Modal
      title="Preview prescription"
      onClose={onClose}
      large
      footer={
        <div
          className="row"
          style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
        >
          <span className="muted" style={{ fontSize: 12.5 }}>
            This is exactly what the patient receives. Nothing has been sent yet.
          </span>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-sm"
              disabled={!blob}
              onClick={() => blob && printBlob(blob)}
            >
              🖨 Print
            </button>
            <button className="btn btn-sm" onClick={onClose}>
              Close
            </button>
            {onIssue && (
              <button
                className="btn btn-primary btn-sm"
                disabled={issuing || !url}
                onClick={onIssue}
              >
                {issuing ? 'Issuing…' : 'Issue prescription'}
              </button>
            )}
          </div>
        </div>
      }
    >
      {body}
    </Modal>
  );
}
