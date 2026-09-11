import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { openPdf } from '../lib/pdfRaster';

/**
 * A PDF drawn page by page onto canvases.
 *
 * An `<iframe>` of a PDF works on a desktop, where the browser has a viewer
 * to put in it. On Android Chrome there is no such viewer: the frame shows a
 * grey box with an "Open" button that goes nowhere, and a doctor on a phone
 * cannot see the prescription they are about to issue. Rendering it here
 * makes the preview the same picture on every device.
 *
 * Pages are drawn at the container's width, sharpened by the device pixel
 * ratio so text stays crisp on a phone screen.
 */
export function PdfPages({ blob, height }: { blob: Blob; height: string }) {
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
      host.replaceChildren();
      const width = host.clientWidth || 600;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);

      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const viewport = page.getViewport({ scale: scale * dpr });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = '100%';
        canvas.style.display = 'block';
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
  }, [blob]);

  if (error) return <div className="empty">{error}</div>;
  return (
    <div
      ref={hostRef}
      style={{
        height,
        overflowY: 'auto',
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
