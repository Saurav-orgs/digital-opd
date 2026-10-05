import type { ReactNode } from 'react';
import { Modal } from './ui';
import { AiDisclaimer } from './AiDisclaimer';

/**
 * A report's own file, opened in place.
 *
 * It used to be a "View" link that opened a new browser tab. That takes the
 * doctor out of the consultation they are mid-way through, and on a phone it
 * is a separate app window they have to find their way back from. The file
 * opens over the visit instead, and closing it puts them back exactly where
 * they were.
 */
export function ReportViewerModal({
  title,
  url,
  onClose,
}: {
  title: string;
  url: string;
  onClose: () => void;
}) {
  // A scan is usually a photo; a lab result is usually a PDF. The extension is
  // all we have — the API returns a presigned URL, not a content type.
  const isImage = /\.(png|jpe?g|webp|gif|heic|avif)(\?|$)/i.test(url);

  return (
    <Modal
      title={title}
      onClose={onClose}
      large
      footer={
        <div className="modal-actions">
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
        {isImage ? (
          <img src={url} alt={title} />
        ) : (
          <iframe src={url} title={title} />
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
