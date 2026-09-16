import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { openPdf } from '../lib/pdfRaster';

/**
 * How the pages are sized to the box they are drawn in.
 *
 *   width — each page is as wide as the box and the box scrolls; the reading
 *           view, where the text should be as large as the screen allows.
 *   page  — the first page is shrunk until the *whole* of it is visible, so
 *           the box never scrolls; the glance view, where the doctor checks
 *           the document is right before issuing it. Small on a phone, which
 *           is what the maximise button is for.
 */
export type PdfFit = 'width' | 'page';

/**
 * A PDF drawn page by page onto canvases.
 *
 * An `<iframe>` of a PDF works on a desktop, where the browser has a viewer
 * to put in it. On Android Chrome there is no such viewer: the frame shows a
 * grey box with an "Open" button that goes nowhere, and a doctor on a phone
 * cannot see the prescription they are about to issue. Rendering it here
 * makes the preview the same picture on every device.
 *
 * Pages are drawn at the container's width (or, in `page` fit, at whichever
 * of width and height binds first), sharpened by the device pixel ratio so
 * text stays crisp on a phone screen.
 */
export function PdfPages({
  blob,
  height,
  fit = 'width',
  onPageCount,
}: {
  blob: Blob;
  height: string;
  fit?: PdfFit;
  /** How many pages the document has — the caller says so when only one fits. */
  onPageCount?: (n: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setError(null);

    (async () => {
      doc = await openPdf(blob);
      if (cancelled) return;
      onPageCount?.(doc.numPages);
      host.replaceChildren();
      const PAD = 8;
      const width = (host.clientWidth || 600) - PAD * 2;
      const boxHeight = (host.clientHeight || 600) - PAD * 2;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);

      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale =
          fit === 'page'
            ? Math.min(width / base.width, boxHeight / base.height)
            : width / base.width;
        const viewport = page.getViewport({ scale: scale * dpr });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = fit === 'page' ? `${Math.floor(base.width * scale)}px` : '100%';
        canvas.style.maxWidth = '100%';
        canvas.style.display = 'block';
        canvas.style.margin = fit === 'page' ? '0 auto' : '0';
        canvas.style.background = '#fff';
        canvas.style.borderRadius = '6px';
        canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,0.12)';
        host.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Could not draw the PDF.');
    });

    return () => {
      cancelled = true;
      void doc?.destroy();
    };
    // `onPageCount` is informational; a new callback identity is not a reason
    // to redraw the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, fit]);

  if (error) return <div className="empty">{error}</div>;
  return (
    <div
      ref={hostRef}
      style={{
        height,
        // Page fit promises "nothing to scroll"; width fit is the reader.
        overflowY: fit === 'page' ? 'hidden' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 8,
        boxSizing: 'border-box',
        border: 'var(--hairline)',
        borderRadius: 8,
        background: 'var(--page, #eef0f2)',
      }}
    />
  );
}
