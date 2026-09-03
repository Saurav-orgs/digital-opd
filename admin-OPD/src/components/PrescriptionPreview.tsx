import { useEffect, useState, type ReactNode } from 'react';
import { consultationApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { useToast } from './Toast';
import { Loading, Modal } from './ui';

/**
 * Send a PDF to the printer without navigating away from the consultation.
 *
 * The blob goes into an offscreen frame and that frame is printed, so the
 * doctor gets the browser's own print dialog on the real document — the page
 * behind it keeps its state, which a `window.open` of the PDF would cost.
 *
 * Falls back to opening the file in a tab when the frame refuses to print
 * (some browsers will not drive their PDF viewer from script). Either way the
 * doctor ends up in front of the document rather than an error.
 */
export async function printPdfBlob(blob: Blob): Promise<'printed' | 'opened'> {
  const url = URL.createObjectURL(blob);

  const openInstead = () => {
    window.open(url, '_blank', 'noopener');
    return 'opened' as const;
  };

  return new Promise<'printed' | 'opened'>((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    // Not `display: none` — a hidden frame has no layout in some browsers and
    // its PDF viewer never loads, so printing it silently does nothing.
    Object.assign(frame.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      border: '0',
    });

    // Revoking on the next tick would pull the document out from under a
    // print dialog that is still open, so the cleanup waits the dialog out.
    const cleanup = () =>
      window.setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 60_000);

    frame.onload = () => {
      // The viewer needs a beat after load before it will answer `print()`.
      window.setTimeout(() => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
          resolve('printed');
        } catch {
          resolve(openInstead());
        }
        cleanup();
      }, 300);
    };
    frame.onerror = () => {
      resolve(openInstead());
      cleanup();
    };

    frame.src = url;
    document.body.appendChild(frame);
  });
}

/** Prints the visit's issued prescription. */
export function PrintPrescriptionButton({ appointmentId }: { appointmentId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const onPrint = async () => {
    setBusy(true);
    try {
      const { blob } = await consultationApi.prescriptionPdf(appointmentId);
      const outcome = await printPdfBlob(blob);
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
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

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
    // Loading once per open is the point — a preview that re-fetched itself
    // while being read would replace the page under the doctor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let body: ReactNode;
  if (error) {
    body = <div className="empty">{error}</div>;
  } else if (!url) {
    body = <Loading label="Rendering the prescription…" />;
  } else {
    body = (
      <iframe
        src={url}
        title="Prescription preview"
        style={{
          width: '100%',
          height: '68vh',
          border: 'var(--hairline)',
          borderRadius: 8,
          background: '#fff',
        }}
      />
    );
  }

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
              onClick={() => blob && printPdfBlob(blob)}
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
