import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Modal } from './ui';
import { rasterizePdfPage } from '../lib/pdfRaster';
import { CONTENT_W_PT, MIN_RATIO } from '../lib/letterhead';

/**
 * Widest a cropped strip is sent at. A 600-dpi scan of an A4 pad is
 * ~5000 px across and as a PNG strip would blow past the 6 MB upload cap;
 * 3000 px still prints a 507 pt header at ~430 dpi.
 */
const MAX_CROP_W = 3000;

/** How the printer's PDF is drawn before cropping: 3 px/pt → 1785 px wide. */
const PDF_PX_PER_PT = 3;

/** Roughly what a header takes on a typical pad; where the bottom handle starts. */
const DEFAULT_HEADER_FRACTION = 0.25;

/** Points to centimetres, for the "prints this tall" hint. */
const PT_PER_CM = 28.35;

/**
 * Cuts the header strip out of a doctor's whole pad.
 *
 * Doctors have a scan, a phone photo or the printer's PDF of the entire
 * pad — asking them to open an image editor and cut out the top is the step
 * where header uploads stall. So the whole page is accepted here and cropped
 * in the browser: two handles, the top and bottom of the strip, dragged over
 * the page, with a live "prints as" view beside them. The bottom handle
 * cannot go below `width / MIN_RATIO`, the tallest header the PDF draws, so
 * the strip always passes the upload's shape check.
 *
 * The crop is done on a canvas at the page's own resolution (capped at
 * `MAX_CROP_W`) and handed back as a PNG `File`; the caller uploads it
 * exactly as it would an already-cropped strip.
 */
export function HeaderCropper({
  source,
  onCrop,
  onCancel,
}: {
  /** An image in any browser-readable format, or a PDF (page 1 is used). */
  source: File;
  onCrop: (strip: File) => void;
  onCancel: () => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The strip's edges as fractions of the page's height.
  const [top, setTop] = useState(0);
  const [bottom, setBottom] = useState(DEFAULT_HEADER_FRACTION);
  const [cropping, setCropping] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'top' | 'bottom' | null>(null);

  // Decode the source: a PDF is drawn first, an image is loaded as is.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        let src: string;
        if (source.type === 'application/pdf' || /\.pdf$/i.test(source.name)) {
          src = await rasterizePdfPage(source, 1, PDF_PX_PER_PT);
        } else {
          objectUrl = URL.createObjectURL(source);
          src = objectUrl;
        }
        const el = new Image();
        await new Promise<void>((resolve, reject) => {
          el.onload = () => resolve();
          el.onerror = () => reject(new Error('decode'));
          el.src = src;
        });
        if (cancelled) return;
        // Tallest strip the PDF will take, as a fraction of this page.
        const maxFrac = el.naturalWidth / MIN_RATIO / el.naturalHeight;
        setBottom(Math.min(DEFAULT_HEADER_FRACTION, maxFrac));
        setImg(el);
      } catch {
        if (!cancelled)
          setProblem(
            'Your browser cannot open this file. Save it as a PNG, JPG or PDF and try again.',
          );
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  const maxFrac = img ? img.naturalWidth / MIN_RATIO / img.naturalHeight : 1;
  // Never so thin that the doctor loses the handles on top of each other.
  const minFrac = Math.min(0.02, maxFrac / 2);

  // Where a pointer is, as a fraction of the page's height.
  const fractionAt = (clientY: number): number => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return 0;
    return Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  };

  const startDrag = (edge: 'top' | 'bottom') => (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = edge;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const edge = dragRef.current;
    if (!edge) return;
    const f = fractionAt(e.clientY);
    if (edge === 'top') {
      // The top may not push the bottom past the page, nor make the strip
      // taller than the PDF's cap; the bottom follows if it has to.
      const t = Math.min(f, 1 - minFrac);
      setTop(t);
      setBottom((b) => Math.min(Math.max(b, t + minFrac), t + maxFrac, 1));
    } else {
      setBottom(Math.max(top + minFrac, Math.min(f, top + maxFrac, 1)));
    }
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  // The strip's shape and the height it will print at.
  const stripRatio = img ? img.naturalWidth / ((bottom - top) * img.naturalHeight) : MIN_RATIO;
  const printCm = CONTENT_W_PT / stripRatio / PT_PER_CM;

  const crop = async () => {
    if (!img) return;
    setCropping(true);
    try {
      const sy = Math.round(top * img.naturalHeight);
      const sh = Math.max(1, Math.round((bottom - top) * img.naturalHeight));
      const scale = Math.min(1, MAX_CROP_W / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.max(1, Math.round(sh * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      // A JPEG or a PDF page has no alpha, but a PNG might: the pad's
      // background must print white, not whatever the viewer shows behind.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, sy, img.naturalWidth, sh, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (!blob) throw new Error('encode');
      const base = source.name.replace(/\.[^.]*$/, '') || 'letterhead';
      onCrop(new File([blob], `${base}-header.png`, { type: 'image/png' }));
    } catch {
      setProblem('The header could not be cut out. Please try another file.');
      setCropping(false);
    }
  };

  return (
    <Modal
      title="Mark your header"
      onClose={onCancel}
      large
      persistent
      footer={
        <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {img ? `Prints about ${printCm.toFixed(1)} cm tall` : ''}
          </span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={onCancel} disabled={cropping}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={crop} disabled={!img || cropping}>
              {cropping ? 'Cutting…' : 'Use this header'}
            </button>
          </div>
        </div>
      }
    >
      <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        Drag the bars to the top and bottom of your header. Everything between
        them prints at the top of each prescription; the sheet starts below.
      </p>

      {problem ? (
        <p className="form-notice">{problem}</p>
      ) : !img ? (
        <div className="muted" style={{ padding: '32px 0', textAlign: 'center' }}>
          Opening your file…
        </div>
      ) : (
        <>
          <div
            ref={stageRef}
            className="lh-crop-stage"
            // A full page would run off a phone screen; cap it at 55vh tall
            // by narrowing it, so the whole page stays under the doctor's
            // thumb while they drag.
            style={{ width: `min(100%, calc(55vh * ${img.naturalWidth / img.naturalHeight}))` }}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <img src={img.src} alt="" draggable={false} />
            <div className="lh-crop-shade" style={{ top: 0, height: `${top * 100}%` }} />
            <div className="lh-crop-shade" style={{ top: `${bottom * 100}%`, bottom: 0 }} />
            <div
              className="lh-crop-handle"
              style={{ top: `${top * 100}%` }}
              onPointerDown={startDrag('top')}
              role="slider"
              aria-label="Top of header"
              aria-valuenow={Math.round(top * 100)}
            >
              <span>Top</span>
            </div>
            <div
              className="lh-crop-handle"
              style={{ top: `${bottom * 100}%` }}
              onPointerDown={startDrag('bottom')}
              role="slider"
              aria-label="Bottom of header"
              aria-valuenow={Math.round(bottom * 100)}
            >
              <span>Bottom</span>
            </div>
          </div>

          {/* What will print: the strip at the shape it takes on the page. */}
          <div className="muted" style={{ fontSize: 12, margin: '14px 0 6px' }}>
            Prints as
          </div>
          <div className="lh-crop-result" style={{ aspectRatio: `${stripRatio}` }}>
            <img
              src={img.src}
              alt=""
              draggable={false}
              style={{ transform: `translateY(-${top * 100}%)` }}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
