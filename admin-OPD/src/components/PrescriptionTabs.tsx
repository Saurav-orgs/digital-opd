import { useState } from 'react';
import { ConsultationRecorder } from './ConsultationRecorder';
import { PrescriptionEditor } from './PrescriptionEditor';
import { HandwritingCanvas } from './HandwritingCanvas';

type Mode = 'handwrite' | 'voice' | 'type';

/**
 * The three ways a doctor can produce the same prescription, as tabs:
 *   ✍️ Handwrite — e-pen on the tablet app (native stylus; see the note here)
 *   🎙 Voice     — dictate; the system drafts; the doctor reviews
 *   ⌨️ Type      — fill the structured editor directly
 *
 * Voice and Type both edit the same structured draft, so switching between them
 * keeps whatever is already there. Handwriting is a separate, image-based mode
 * and lives in the Flutter tablet app for now.
 */
export function PrescriptionTabs({
  appointmentId,
  canEdit,
  disabled,
}: {
  appointmentId: string;
  canEdit: boolean;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<Mode>('voice');

  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <TabBtn label="✍️ Handwrite" active={mode === 'handwrite'} onClick={() => setMode('handwrite')} />
        <TabBtn label="🎙 Voice" active={mode === 'voice'} onClick={() => setMode('voice')} />
        <TabBtn label="⌨️ Type" active={mode === 'type'} onClick={() => setMode('type')} />
      </div>

      {mode === 'handwrite' && (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 10 }}>
            Write the prescription by hand — on a tablet use your stylus. It prints on
            your letterhead exactly like your paper pad.
          </p>
          <HandwritingCanvas appointmentId={appointmentId} canEdit={canEdit} />
        </>
      )}

      {mode === 'voice' && (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 10 }}>
            Record the consultation and the system drafts a prescription. Nothing is
            sent to the patient until you issue it.
          </p>
          {canEdit && <ConsultationRecorder appointmentId={appointmentId} disabled={disabled} />}
          <div style={{ marginTop: 16 }}>
            <PrescriptionEditor appointmentId={appointmentId} canEdit={canEdit} />
          </div>
        </>
      )}

      {mode === 'type' && (
        <>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 10 }}>
            Fill in the diagnosis, medicines and advice, then issue when ready.
          </p>
          <PrescriptionEditor appointmentId={appointmentId} canEdit={canEdit} />
        </>
      )}
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`btn btn-sm ${active ? 'btn-primary' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}
