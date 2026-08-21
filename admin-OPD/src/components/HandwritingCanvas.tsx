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
  }, [issued]);

  const posFromEvent = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const drawSegment = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    pressure: number,
  ) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = ERASER_PT * SCALE;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = INK;
      const p = pressure > 0 ? pressure : 0.5;
      ctx.lineWidth = PEN_PT * SCALE * (0.6 + p * 0.9);
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };

  const pushUndo = () => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    undoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.current.length > 30) undoStack.current.shift();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!canEdit) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    pushUndo();
    drawing.current = true;
    const p = posFromEvent(e);
    last.current = p;
    drawSegment(p, p, e.pressure);
    if (tool === 'pen') setDirty(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const p = posFromEvent(e);
    drawSegment(last.current, p, e.pressure);
    last.current = p;
  };

  const onPointerUp = () => {
    drawing.current = false;
    last.current = null;
  };

  const undo = () => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    const img = undoStack.current.pop();
    if (img) ctx.putImageData(img, 0, 0);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const clear = () => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    pushUndo();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setDirty(false);
  };

  const issue = useMutation({
    mutationFn: async () => {
      const canvas = canvasRef.current!;
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/png'),
      );
      if (!blob) throw new Error('Could not read the drawing.');
      await consultationApi.saveHandwriting(appointmentId, blob);
      return consultationApi.issuePrescription(appointmentId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prescription', appointmentId] });
      qc.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      toast.success('Prescription issued', 'The patient has been notified.');
    },
    onError: (e) => toast.error(e),
  });

  if (prescriptionQ.isLoading) {
    return <span className="muted">Loading…</span>;
  }

  if (issued) {
    const p = prescriptionQ.data!;
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

  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${tool === 'pen' ? 'btn-primary' : ''}`} onClick={() => setTool('pen')}>
          ✒️ Pen
        </button>
        <button className={`btn btn-sm ${tool === 'eraser' ? 'btn-primary' : ''}`} onClick={() => setTool('eraser')}>
          Eraser
        </button>
        <button className="btn btn-sm" onClick={undo} disabled={!canEdit}>Undo</button>
        <button className="btn btn-sm" onClick={clear} disabled={!canEdit}>Clear</button>
      </div>

      <div
        style={{
          width: '100%',
          aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
          background: '#fff',
          border: 'var(--hairline)',
          borderRadius: 8,
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{ width: '100%', height: '100%', display: 'block', cursor: canEdit ? 'crosshair' : 'default', touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>

      <p className="muted" style={{ fontSize: 11.5, margin: '6px 0 0' }}>
        Write with a stylus or mouse. This prints on your letterhead when issued.
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
