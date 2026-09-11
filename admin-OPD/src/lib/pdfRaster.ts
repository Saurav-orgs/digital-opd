import type { PDFDocumentProxy } from 'pdfjs-dist';

/*
 * pdf.js is a third of the app's size and only the preview and print paths
 * need it, so it is fetched the first time a document is drawn rather than
 * with the app. The worker is a separate file, pointed at explicitly so Vite
 * bundles it alongside rather than leaving pdf.js to fetch it from a path
 * that does not exist in the build.
 */
let loader: Promise<typeof import('pdfjs-dist')> | null = null;
export function loadPdfjs() {
  loader ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    return pdfjs;
  });
  return loader;
}

export async function openPdf(blob: Blob): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

/**
 * Every page of a PDF as a PNG data URL, drawn `pixelsPerPoint` pixels per
 * PDF point (A4 is 595 × 842 pt, so 3 gives a page 1785 px wide — enough for
 * a printer to produce crisp 10pt text).
 */
export async function rasterizePdf(blob: Blob, pixelsPerPoint: number): Promise<string[]> {
  const doc = await openPdf(blob);
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: pixelsPerPoint });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      // Print intent: the page is going to a printer, so annotations are
      // drawn as printed — and pdf.js paces display rendering with
      // requestAnimationFrame, which a backgrounded tab never fires.
      await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
      pages.push(canvas.toDataURL('image/png'));
    }
    return pages;
  } finally {
    void doc.destroy();
  }
}

/**
 * Can this browser show a PDF inside a frame?
 *
 * `navigator.pdfViewerEnabled` is the browser's own answer; Android Chrome
 * says no, desktop browsers say yes. A browser too old to answer is treated
 * as a no — drawing the pages ourselves works everywhere, so it is the safe
 * side to fall on.
 */
export function hasInlinePdfViewer(): boolean {
  return (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled === true;
}
