import { hasInlinePdfViewer, rasterizePdf } from './pdfRaster';

/**
 * Send a file to the printer without navigating away from the consultation.
 *
 * The blob goes into an offscreen frame and that frame is printed, so the
 * doctor gets the browser's own print dialog on the real document — the page
 * behind it keeps its state, which a `window.open` of the file would cost.
 *
 * PDFs are loaded as-is and the viewer prints them. Images are wrapped in a
 * one-line document first: a bare image loaded into a frame prints at its
 * pixel size, which for a phone photo of a report is several pages wide.
 *
 * Falls back to opening the file in a tab when the frame refuses to print
 * (some browsers will not drive their PDF viewer from script). Either way the
 * doctor ends up in front of the document rather than an error.
 */
export async function printBlob(blob: Blob): Promise<'printed' | 'opened'> {
  const fileUrl = URL.createObjectURL(blob);
  const isImage = blob.type.startsWith('image/');

  /*
   * A PDF can only be printed from a frame where the browser has a viewer to
   * load it into. Android Chrome has none — the frame holds a placeholder,
   * and printing it prints that. So where there is no viewer the pages are
   * drawn with pdf.js and printed as images, one per sheet. Desktop browsers
   * keep the viewer path: it prints vectors, which is sharper.
   */
  let pageImages: string[] | null = null;
  if (!isImage && !hasInlinePdfViewer()) {
    try {
      pageImages = await rasterizePdf(blob, 3);
    } catch {
      // Fall through to the viewer path; it may still work.
    }
  }

  const openInstead = () => {
    window.open(fileUrl, '_blank', 'noopener');
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
        URL.revokeObjectURL(fileUrl);
      }, 60_000);

    const print = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve('printed');
      } catch {
        resolve(openInstead());
      }
      cleanup();
    };

    frame.onerror = () => {
      resolve(openInstead());
      cleanup();
    };

    if (isImage || pageImages) {
      const sources = pageImages ?? [fileUrl];
      const imgs = sources.map((src) => `<img src="${src}" alt="">`).join('');
      frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;padding:0}
        img{display:block;max-width:100%;max-height:100vh;margin:0 auto;page-break-after:always}
        img:last-child{page-break-after:auto}
        @page{margin:${pageImages ? '0' : '10mm'}}
      </style></head><body>${imgs}</body></html>`;
      // Wait for the images themselves, not just the wrapper document.
      frame.onload = () => {
        const all = Array.from(frame.contentDocument?.querySelectorAll('img') ?? []);
        let pending = all.filter((img) => !img.complete).length;
        if (pending === 0) return print();
        for (const img of all) {
          if (img.complete) continue;
          img.onload = () => {
            if (--pending === 0) print();
          };
          img.onerror = () => {
            resolve(openInstead());
            cleanup();
          };
        }
      };
    } else {
      frame.onload = () => {
        // The viewer needs a beat after load before it will answer `print()`.
        window.setTimeout(print, 300);
      };
      frame.src = fileUrl;
    }

    document.body.appendChild(frame);
  });
}
