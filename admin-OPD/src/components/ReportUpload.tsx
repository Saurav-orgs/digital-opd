import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { reportsApi } from '../api/endpoints';
import { useToast } from './Toast';
import { Field, Modal } from './ui';
import { CameraCapture, cameraAvailable } from './CameraCapture';

/** What the report endpoint accepts — images plus PDF. */
const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';

/** "CBC report (1).pdf" -> "CBC report (1)", as a first draft of the title. */
function titleFromFile(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 120);
}

/**
 * Add a report to the visit being viewed.
 *
 * The pathlab screen files reports against a patient; this files them against
 * the appointment, which is what puts them in front of the doctor for *this*
 * consultation and feeds the visit's combined summary. The title is asked for
 * rather than taken from the filename silently — it is what the doctor scans in
 * a list, and "scan_20260902_113244.pdf" tells them nothing.
 */
export function ReportUpload({
  appointmentId,
  onUploaded,
}: {
  appointmentId: string;
  onUploaded: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);

  const upload = useMutation({
    mutationFn: (file: File) =>
      reportsApi.uploadForAppointment(appointmentId, title.trim() || 'Report', file),
    onSuccess: () => {
      onUploaded();
      toast.success('Report added', 'Summarising it in the background…');
      close();
    },
    onError: (e) => toast.error(e),
  });

  const take = (file: File) => {
    setPicked(file);
    setTitle(titleFromFile(file.name));
    setCameraOpen(false);
  };

  const close = () => {
    setPicked(null);
    setTitle('');
    setCameraOpen(false);
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) take(file);
          e.target.value = '';
        }}
      />

      <div className="row" style={{ gap: 6 }}>
        {cameraAvailable() && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setCameraOpen(true)}
          >
            📷 Take Photo
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => fileRef.current?.click()}
        >
          Choose File
        </button>
      </div>

      {cameraOpen && (
        <CameraCapture onCapture={take} onClose={() => setCameraOpen(false)} />
      )}

      {picked && (
        <Modal title="Add a report" onClose={close}>
          <Field label="Title">
            <input
              className="input"
              value={title}
              autoFocus
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Blood Test — CBC"
            />
            <span className="hint">
              What the doctor sees in the list, and what the summary is filed
              under.
            </span>
          </Field>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {picked.name} · {(picked.size / 1024 / 1024).toFixed(1)} MB
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={close} disabled={upload.isPending}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={upload.isPending || !title.trim()}
              onClick={() => upload.mutate(picked)}
            >
              {upload.isPending ? 'Uploading…' : 'Add report'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
