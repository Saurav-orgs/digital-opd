import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { consultationApi, doctorsApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import type { DraftFlushRef } from '../lib/draftFlush';
import { bodyHeightPt } from '../lib/letterhead';
import { Loading } from './ui';
import { PrintPrescriptionButton } from './PrescriptionPreview';

/** How long the pad waits after the pen lifts before saving. */
const AUTOSAVE_DELAY_MS = 2000;

type Tool = 'pen' | 'eraser';

// Backing resolution: 2× the A4 body so exports stay crisp. The width is the
// page's content width; the height is whatever the doctor's header leaves
// (`bodyHeightPt`), so the drawing fills the sheet instead of being scaled
// down with air at the sides under a tall header.
const CANVAS_W = 1030;
const SCALE = CANVAS_W / 515; // canvas px per PDF pt
const PEN_PT = 2.6;
const ERASER_PT = 26;
const INK = '#16324F';

/**
 * A pen-on-paper drawing surface for prescriptions in the browser. Captures
 * pointer strokes (pressure-sensitive on a stylus), with pen/eraser, undo and
 * clear. Exports a transparent PNG that the server composites onto the doctor's
 * letterhead — the same endpoint the tablet app uses.
 */
export function HandwritingCanvas({
  appointmentId,
  canEdit,
  flushRef,
}: {
  appointmentId: string;
  canEdit: boolean;
  /** Lets the Preview step upload the strokes before it renders. */
  flushRef?: DraftFlushRef;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const undoStack = useRef<ImageData[]>([]);

  const [tool, setTool] = useState<Tool>('pen');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const qc = useQueryClient();
  const { isDoctor } = useAuth();

  /*
   * The pad's height comes from the doctor's header: the PDF sizes the header
   * to the image and the body gets what is left. Fixed once, before the
   * canvas mounts — changing a canvas's height wipes it, so the pad waits for
   * the doctor's profile (cached from the shell, so rarely a visible wait)
   * rather than resize under a drawing. A staff account, or a profile that
   * fails to load, gets the body under the standard header.
   */
  const meQ = useQuery({ queryKey: ['doctor-me'], queryFn: doctorsApi.me, enabled: isDoctor });
  const canvasHRef = useRef<number | null>(null);
  if (canvasHRef.current == null && (!isDoctor || !meQ.isPending)) {
    const me = meQ.data;
    const ratio = me?.letterhead_header_url ? me.letterhead_header_ratio : null;
    canvasHRef.current = Math.round(bodyHeightPt(ratio) * SCALE);
  }
  const canvasH = canvasHRef.current;

  /*
   * What is on the pad, kept outside the canvas element.
   *
   * The element itself is not stable: going fullscreen renders it in a
   * different place in the tree, and React mounts a fresh, blank one there.
   * Every stroke ends by copying the pixels here, and every mount starts by
   * copying them back — so the drawing survives the toggle, and the saved
   * page fetched from the server has somewhere to land before the canvas
   * exists.
   */
  const snapshotRef = useRef<ImageData | null>(null);
  // Strokes since the last upload. Only a pad that has changed is uploaded;
  // pushing an untouched pad would replace the saved page with what happened
  // to be on screen, which after a failed load is nothing.
  const dirtyRef = useRef(false);
  const loadedRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const uploadChainRef = useRef<Promise<void> | null>(null);

  const prescriptionQ = useQuery({
    queryKey: ['prescription', appointmentId],
    queryFn: () => consultationApi.prescription(appointmentId),
  });
  const issued = prescriptionQ.data?.status === 'issued';

  const snapshot = () => {
    const ctx = ctxRef.current;
    if (ctx && canvasH) snapshotRef.current = ctx.getImageData(0, 0, CANVAS_W, canvasH);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctxRef.current = ctx;
    if (snapshotRef.current) ctx.putImageData(snapshotRef.current, 0, 0);

    // Prevent touch gestures/scrolling on mobile & tablet while interacting with the canvas
    const preventTouchScroll = (e: TouchEvent) => {
      if (e.cancelable) {
        e.preventDefault();
      }
    };

    canvas.addEventListener('touchstart', preventTouchScroll, { passive: false });
    canvas.addEventListener('touchmove', preventTouchScroll, { passive: false });
    canvas.addEventListener('touchend', preventTouchScroll, { passive: false });
    canvas.addEventListener('touchcancel', preventTouchScroll, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', preventTouchScroll);
      canvas.removeEventListener('touchmove', preventTouchScroll);
      canvas.removeEventListener('touchend', preventTouchScroll);
      canvas.removeEventListener('touchcancel', preventTouchScroll);
    };
    // `canvasH`: the pad is not in the tree until its height is known.
  }, [isFullscreen, canvasH]);

  /*
   * Pick up where the doctor left off. The saved page comes through the API
   * as a PNG and is drawn onto the pad once, underneath anything already
   * written on it — a doctor who started writing before it arrived keeps
   * their strokes on top.
   */
  const savedUrl = issued ? null : prescriptionQ.data?.handwriting_image_url;
  useEffect(() => {
    if (!savedUrl || loadedRef.current) return;
    loadedRef.current = true;
    let cancelled = false;
    let done = false;
    (async () => {
      const blob = await consultationApi.handwritingImage(appointmentId);
      if (!blob || cancelled) return;
      const bitmap = await createImageBitmap(blob);
      if (cancelled) return;
      const ctx = ctxRef.current;
      if (!ctx) return;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.drawImage(bitmap, 0, 0, CANVAS_W, canvasH ?? CANVAS_W);
      ctx.restore();
      snapshot();
      done = true;
    })().catch(() => {
      // Nothing to draw back; the pad stays as it is, and only new strokes
      // will ever be uploaded over the saved page.
      loadedRef.current = false;
    });
    return () => {
      // A load that never landed (the effect re-ran, or the pad unmounted
      // mid-fetch) has not happened; the next run is free to try again.
      if (!done) {
        cancelled = true;
        loadedRef.current = false;
      }
    };
  }, [savedUrl, appointmentId]);

  const pushUndo = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    undoStack.current.push(ctx.getImageData(0, 0, CANVAS_W, canvasH ?? CANVAS_W));
    if (undoStack.current.length > 20) undoStack.current.shift();
  };

  const undo = () => {
    const ctx = ctxRef.current;
    if (!ctx || undoStack.current.length === 0) return;
    const prev = undoStack.current.pop()!;
    ctx.putImageData(prev, 0, 0);
    changed();
  };

  const clear = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    pushUndo();
    ctx.clearRect(0, 0, CANVAS_W, canvasH ?? CANVAS_W);
    // A cleared pad is a change like any other — the saved page goes too.
    changed();
  };

  const toCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((e.clientY - rect.top) / rect.height) * (canvasH ?? CANVAS_W);
    return { x, y };
  };

  const strokeWidth = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tool === 'eraser') return ERASER_PT * SCALE;
    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    return PEN_PT * SCALE * (0.6 + pressure * 0.9);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canEdit) return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    pushUndo();
    drawing.current = true;
    last.current = toCanvasCoords(e);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    e.preventDefault();
    const ctx = ctxRef.current;
    if (!ctx) return;

    const pt = toCanvasCoords(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(pt.x, pt.y);

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = strokeWidth(e);
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = strokeWidth(e);
      ctx.strokeStyle = INK;
    }
    ctx.stroke();
    last.current = pt;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch (_) {}
    changed();
  };

  /** Push what is on the pad to the server — the step before issue or preview. */
  const uploadStrokes = async () => {
    // The pad may already be gone — a save that was pending when the doctor
    // switched tabs runs after unmount — so the snapshot stands in for it.
    let canvas: HTMLCanvasElement | null = canvasRef.current;
    if (!canvas && snapshotRef.current) {
      canvas = document.createElement('canvas');
      canvas.width = snapshotRef.current.width;
      canvas.height = snapshotRef.current.height;
      canvas.getContext('2d')?.putImageData(snapshotRef.current, 0, 0);
    }
    if (!canvas) throw new Error('No canvas');
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/png'),
    );
    const file = new File([blob], 'handwriting.png', { type: 'image/png' });
    const saved = await consultationApi.saveHandwriting(appointmentId, file);
    // The page now has a handwriting URL; the Preview step's "anything to
    // preview?" check reads it from here.
    qc.setQueryData(['prescription', appointmentId], saved);
    // What was just uploaded is what is on the server, so the next mount
    // must not fetch and draw it a second time on top of itself.
    loadedRef.current = true;
  };

  /**
   * One upload, queued behind any already running. Uploads are full
   * replacements, so two in flight could land out of order; chaining keeps
   * the last one the doctor's latest page.
   */
  const saveNow = (): Promise<void> => {
    const run = async () => {
      if (!canEdit || !dirtyRef.current) return;
      dirtyRef.current = false;
      setSaveState('saving');
      try {
        await uploadStrokes();
        setSaveState('saved');
      } catch (e) {
        dirtyRef.current = true;
        setSaveState('error');
        throw e;
      }
    };
    const prev = uploadChainRef.current ?? Promise.resolve();
    const next = prev.then(run, run);
    uploadChainRef.current = next;
    return next;
  };

  const cancelPendingAutosave = () => {
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  };

  /*
   * A stroke has ended (or undo/clear ran). Remember the pixels, and save a
   * moment after the pen stays up — a doctor writing a line lifts the pen
   * between words, and uploading on every lift would be one request a word.
   */
  const changed = () => {
    snapshot();
    dirtyRef.current = true;
    setSaveState('idle');
    if (!canEdit) return;
    cancelPendingAutosave();
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      saveNow().catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);
  };

  // Leaving the tab with a save still pending: send it now rather than lose it.
  useEffect(
    () => () => {
      if (autosaveTimerRef.current != null) {
        cancelPendingAutosave();
        saveNow().catch(() => undefined);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Same reasoning as the editor: the Preview step is on the page now, so it
  // needs a way to push the strokes up before it asks for the PDF. Only a pad
  // that changed is pushed — see `dirtyRef`.
  useEffect(() => {
    if (flushRef)
      flushRef.current = async () => {
        cancelPendingAutosave();
        await saveNow();
      };
  });

  if (issued && prescriptionQ.data) {
    const p = prescriptionQ.data;
    return (
      <div>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <span className="badge badge-available">Issued</span>
          <div className="row" style={{ gap: 8 }}>
            <PrintPrescriptionButton appointmentId={appointmentId} />
            {p.pdf_url && (
              <a className="btn btn-sm" href={p.pdf_url} target="_blank" rel="noreferrer">
                Download PDF
              </a>
            )}
          </div>
        </div>
        {p.mode === 'handwritten' && p.handwriting_image_url && (
          <img
            src={p.handwriting_image_url}
            alt="Handwritten prescription"
            style={{ width: '100%', background: '#fff', borderRadius: 8, border: 'var(--hairline)' }}
          />
        )}
      </div>
    );
  }

  if (canvasH == null) return <Loading label="Preparing your pad…" />;

  const canvasContent = (
    <div
      style={{
        width: '100%',
        height: isFullscreen ? 'calc(100vh - 120px)' : 'auto',
        aspectRatio: isFullscreen ? undefined : `${CANVAS_W} / ${canvasH}`,
        background: '#fff',
        border: 'var(--hairline)',
        borderRadius: 8,
        overflow: 'hidden',
        touchAction: 'none',
        overscrollBehavior: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        boxShadow: isFullscreen ? 'none' : '0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={canvasH ?? CANVAS_W}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: canEdit ? 'crosshair' : 'default',
          touchAction: 'none',
          overscrollBehavior: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </div>
  );

  if (isFullscreen) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--bg, #f8f9fa)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          padding: '12px 18px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <strong style={{ fontSize: 16 }}>✍️ Fullscreen Whiteboard</strong>
            <button className={`btn btn-sm ${tool === 'pen' ? 'btn-primary' : ''}`} onClick={() => setTool('pen')}>
              ✒️ Pen
            </button>
            <button className={`btn btn-sm ${tool === 'eraser' ? 'btn-primary' : ''}`} onClick={() => setTool('eraser')}>
              Eraser
            </button>
            <button className="btn btn-sm" onClick={undo} disabled={!canEdit}>Undo</button>
            <button className="btn btn-sm" onClick={clear} disabled={!canEdit}>Clear</button>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setIsFullscreen(false)}>Exit Fullscreen</button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>{canvasContent}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${tool === 'pen' ? 'btn-primary' : ''}`} onClick={() => setTool('pen')}>
            ✒️ Pen
          </button>
          <button className={`btn btn-sm ${tool === 'eraser' ? 'btn-primary' : ''}`} onClick={() => setTool('eraser')}>
            Eraser
          </button>
          <button className="btn btn-sm" onClick={undo} disabled={!canEdit}>Undo</button>
          <button className="btn btn-sm" onClick={clear} disabled={!canEdit}>Clear</button>
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <span
            className="muted"
            style={{ fontSize: 12, color: saveState === 'error' ? 'var(--state-error)' : undefined }}
            aria-live="polite"
          >
            {saveState === 'saving'
              ? 'Saving…'
              : saveState === 'saved'
                ? 'Saved'
                : saveState === 'error'
                  ? "Couldn't save"
                  : ''}
          </span>
          <button className="btn btn-sm" onClick={() => setIsFullscreen(true)}>
            ⛶ Fullscreen Whiteboard
          </button>
        </div>
      </div>

      {canvasContent}

      <p className="muted" style={{ fontSize: 11.5, margin: '6px 0 0' }}>
        Write with a stylus or mouse. Click <strong>Fullscreen Whiteboard</strong> for a large distraction-free writing space.
      </p>

      {/*
        Preview and Issue used to sit here and in the fullscreen bar. Both
        belong to the page now — the consultation ends on its Preview step, and
        issuing from inside the pad let a prescription reach a patient without
        the doctor ever seeing the letterhead it renders on. The pad's strokes
        still reach the server before that step, through `flushRef`.
      */}
    </div>
  );
}
