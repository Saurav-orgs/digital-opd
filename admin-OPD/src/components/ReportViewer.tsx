import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loading, Modal } from './ui';
import { AiDisclaimer } from './AiDisclaimer';
import { PdfPages } from './PdfPages';
import { reportsApi } from '../api/endpoints';

/**
 * A report's own file, opened in place.
 *
 * It used to be a "View" link that opened a new browser tab. That takes the
 * doctor out of the consultation they are mid-way through, and on a phone it
 * is a separate app window they have to find their way back from. The file
 * opens over the visit instead, and closing it puts them back exactly where
 * they were.
 *
 * A PDF is drawn page by page rather than framed. A framed PDF needs the
 * browser to have a viewer to put in the frame, and a phone generally does
 * not: page one rendered as a flat picture and pages two and three could not
 * be reached at all — a three-page lab report was a one-page lab report on a
 * phone. `PdfPages` was written for exactly this and the prescription preview
 * has used it for a while; this was the last place still framing a document.
 */
export function ReportViewerModal({
  id,
  title,
  url,
  onClose,
}: {
  /** The report, so the bytes can be fetched through the API. */
  id: string;
  title: string;
  /** The presigned URL — still the "open in a new tab" escape hatch. */
  url: string;
  onClose: () => void;
}) {
  const [pages, setPages] = useState<number | null>(null);

  // Through the API rather than the presigned URL: same origin, the session's
  // own auth, and no bucket CORS to configure for a `fetch` the browser makes.
  const fileQ = useQuery({
    queryKey: ['report-file', id],
    queryFn: () => reportsApi.file(id),
    staleTime: 5 * 60_000,
  });

  const blob = fileQ.data?.blob;
  const isImage = blob?.type.startsWith('image/');

  // Made once per blob and revoked when the dialog closes. Minting it inline
  // in the markup would hand the browser a fresh object URL on every render
  // and never give one back.
  const imageSrc = useMemo(
    () => (blob && blob.type.startsWith('image/') ? URL.createObjectURL(blob) : null),
    [blob],
  );
  useEffect(() => {
    if (!imageSrc) return;
    return () => URL.revokeObjectURL(imageSrc);
  }, [imageSrc]);

  return (
    <Modal
      title={title}
      onClose={onClose}
      large
      footer={
        <div className="modal-actions">
          {pages != null && pages > 1 && (
            <span className="muted" style={{ marginRight: 'auto', fontSize: 12.5 }}>
              {pages} pages · scroll to read
            </span>
          )}
          {/* A real link, not a scripted download: the artifact of opening it
              in a tab is exactly what the doctor wants when they have a second
              screen, and it is the fallback when the embed cannot render. */}
          <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer">
            Open in a new tab
          </a>
          <button className="btn btn-sm btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <div className="report-viewer">
        {fileQ.isLoading ? (
          <Loading label="Opening the report…" />
        ) : fileQ.isError || !fileQ.data ? (
          <div className="empty">
            Could not open this report. Try “Open in a new tab”.
          </div>
        ) : isImage && imageSrc ? (
          <img src={imageSrc} alt={title} />
        ) : (
          <PdfPages
            blob={blob!}
            height="100%"
            fit="width"
            onPageCount={setPages}
          />
        )}
      </div>
    </Modal>
  );
}

/**
 * A generated summary at full length.
 *
 * The card shows the first few lines and stops; a report summary runs to a
 * paragraph or more, and four of them stacked pushed the prescription off the
 * screen. The whole thing is one tap away and carries the disclaimer, which
 * the clamped version cannot show in full.
 */
export function SummaryModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      large
      footer={
        <div className="modal-actions">
          <button className="btn btn-sm btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      {children}
      <AiDisclaimer />
    </Modal>
  );
}
