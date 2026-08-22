import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { consultationApi } from '../api/endpoints';
import { useToast } from './Toast';

type Tool = 'pen' | 'eraser';

// Backing resolution: 2× the A4 body (515 × 507 pt) so exports stay crisp.
const CANVAS_W = 1030;
const CANVAS_H = 1014;
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
}: {
  appointmentId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const undoStack = useRef<ImageData[]>([]);

  const [tool, setTool] = useState<Tool>('pen');
  const [dirty, setDirty] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const prescriptionQ = useQuery({
    queryKey: ['prescription', appointmentId],
    queryFn: () => consultationApi.prescription(appointmentId),
  });
  const issued = prescriptionQ.data?.status === 'issued';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctxRef.current = ctx;

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
  }, [isFullscreen]);

  const pushUndo = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    undoStack.current.push(ctx.getImageData(0, 0, CANVAS_W, CANVAS_H));
    if (undoStack.current.length > 20) undoStack.current.shift();
  };

  const undo = () => {
    const ctx = ctxRef.current;
    if (!ctx || undoStack.current.length === 0) return;
    const prev = undoStack.current.pop()!;
    ctx.putImageData(prev, 0, 0);
  };

  const clear = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    pushUndo();
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    setDirty(false);
  };

  const toCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
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
    setDirty(true);
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
  };

  const issue = useMutation({
    mutationFn: async () => {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('No canvas');
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/png'),
      );
      const file = new File([blob], 'handwriting.png', { type: 'image/png' });
      await consultationApi.saveHandwriting(appointmentId, file);
      await consultationApi.issuePrescription(appointmentId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription', appointmentId] });
      qc.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      toast.success('Prescription issued');
      setIsFullscreen(false);
    },
    onError: (e) => toast.error(e),
  });

  if (issued && prescriptionQ.data) {
    const p = prescriptionQ.data;
    return (
      <div>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <span className="badge badge-available">Issued</span>
          {p.pdf_url && (
            <a className="btn btn-sm" href={p.pdf_url} target="_blank" rel="noreferrer">
              Download PDF
            </a>
          )}
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

  const canvasContent = (
    <div
      style={{
        width: '100%',
        height: isFullscreen ? 'calc(100vh - 120px)' : 'auto',
        aspectRatio: isFullscreen ? undefined : `${CANVAS_W} / 1200`,
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
        height={CANVAS_H}
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
            {canEdit && (
              <button
                className="btn btn-primary btn-sm"
                disabled={issue.isPending || !dirty}
                onClick={() => issue.mutate()}
              >
                {issue.isPending ? 'Issuing…' : 'Issue prescription'}
              </button>
            )}
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
        <button className="btn btn-sm" onClick={() => setIsFullscreen(true)}>
          ⛶ Fullscreen Whiteboard
        </button>
      </div>

      {canvasContent}

      <p className="muted" style={{ fontSize: 11.5, margin: '6px 0 0' }}>
        Write with a stylus or mouse. Click <strong>Fullscreen Whiteboard</strong> for a large distraction-free writing space.
      </p>

      {canEdit && (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={issue.isPending || !dirty}
            onClick={() => issue.mutate()}
          >
            {issue.isPending ? 'Issuing…' : 'Issue prescription'}
          </button>
        </div>
      )}
    </div>
  );
}
