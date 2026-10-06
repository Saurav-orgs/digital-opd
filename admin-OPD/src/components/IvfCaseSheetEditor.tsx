import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ivfCaseSheetApi, ivfTemplatesApi } from '../api/endpoints';
import type { IvfCaseSheetData, IvfCaseSheetTemplate } from '../api/types';
import { IvfSheetForm } from './IvfSheetForm';
import { useToast } from './Toast';
import { ConfirmDialog, Modal } from './ui';

/**
 * The IVF prescription for one visit — the structured form an IVF & Fertility
 * doctor writes on, in place of the medicine-row editor.
 *
 * It is a prescription, not a document of its own: it is issued to the patient,
 * printed on the same letterhead and withdrawn the same way. It sits as a tab
 * beside Handwrite and Upload, so a visit has one prescription panel with three
 * ways to fill it rather than two competing cards.
 */
export function IvfCaseSheetEditor({
  appointmentId,
  canEdit,
  disabled,
  patientName,
  patientAge,
}: {
  appointmentId: string;
  canEdit: boolean;
  disabled: boolean;
  patientName?: string;
  patientAge?: number | null;
}) {
  const toast = useToast();
  const qc = useQueryClient();

  const sheetQ = useQuery({
    queryKey: ['ivf-case-sheet', appointmentId],
    queryFn: () => ivfCaseSheetApi.get(appointmentId),
  });

  const [data, setData] = useState<IvfCaseSheetData>({});
  const [dirty, setDirty] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [useSavedOpen, setUseSavedOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const seeded = useRef(false);

  const issued = sheetQ.data?.status === 'issued';
  const readOnly = !canEdit || disabled || issued;

  // Seed once from the server, prefilling the wife's name/age from the visit
  // while the form is still blank — the one thing the clinic already knows.
  useEffect(() => {
    if (seeded.current || !sheetQ.data) return;
    const loaded = sheetQ.data.data ?? {};
    const next: IvfCaseSheetData = { ...loaded };
    if (!next.wife?.name && (patientName || patientAge != null)) {
      next.wife = {
        ...next.wife,
        name: next.wife?.name || patientName || undefined,
        age: next.wife?.age || (patientAge != null ? String(patientAge) : undefined),
      };
    }
    setData(next);
    seeded.current = true;
  }, [sheetQ.data, patientName, patientAge]);

  const save = useMutation({
    mutationFn: () => ivfCaseSheetApi.save(appointmentId, data),
    onSuccess: (s) => {
      qc.setQueryData(['ivf-case-sheet', appointmentId], s);
      setDirty(false);
    },
  });

  /*
   * The visit itself changed, not just this sheet: issuing closes the
   * consultation out, the same way issuing a prescription does. Without this
   * the page went on showing the visit as pending, and the dashboard's count
   * with it, until something else happened to refetch.
   */
  const invalidateVisit = () => {
    qc.invalidateQueries({ queryKey: ['appointment', appointmentId] });
    qc.invalidateQueries({ queryKey: ['appointments'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const issue = useMutation({
    mutationFn: async () => {
      if (dirty) await ivfCaseSheetApi.save(appointmentId, data);
      return ivfCaseSheetApi.issue(appointmentId);
    },
    onSuccess: (s) => {
      qc.setQueryData(['ivf-case-sheet', appointmentId], s);
      invalidateVisit();
      setDirty(false);
      setPreviewOpen(false);
      toast.success('Prescription issued to the patient.');
    },
    onError: (e) => toast.error(e),
  });

  const withdraw = useMutation({
    mutationFn: () => ivfCaseSheetApi.withdraw(appointmentId),
    onSuccess: (s) => {
      qc.setQueryData(['ivf-case-sheet', appointmentId], s);
      // The visit stays done — withdrawing is "I issued the wrong thing", not
      // "this visit did not happen", and the prescription path works the same
      // way. The caches still refresh: what the visit carries has changed.
      invalidateVisit();
      setConfirmWithdraw(false);
      toast.success('Prescription withdrawn. The patient can no longer see it.');
    },
    onError: (e) => toast.error(e),
  });

  /** Fill this visit's prescription from one the doctor saved earlier. */
  const applySaved = useMutation({
    mutationFn: (id: string) => ivfTemplatesApi.apply(id, appointmentId),
    onSuccess: (s) => {
      qc.setQueryData(['ivf-case-sheet', appointmentId], s);
      setData(s.data ?? {});
      setDirty(false);
      setUseSavedOpen(false);
      toast.success('Saved prescription applied.');
    },
    onError: (e) => toast.error(e),
  });

  const flushThen = async (after: () => void) => {
    try {
      if (dirty) await save.mutateAsync();
      after();
    } catch (e) {
      toast.error(e);
    }
  };

  if (sheetQ.isLoading) {
    return <div className="muted" style={{ padding: 12 }}>Loading prescription…</div>;
  }

  return (
    <div className="ivf-sheet">
      <div className="ivf-head">
        <div className="muted" style={{ fontSize: 12.5 }}>
          {issued
            ? 'Issued — withdraw to make changes.'
            : 'History, investigations and plan. Saved as a draft until you issue it.'}
        </div>
        {issued && <span className="ivf-badge">Issued</span>}
      </div>

      <IvfSheetForm
        value={data}
        onChange={(next) => {
          setData(next);
          setDirty(true);
        }}
        readOnly={readOnly}
      />

      <div className="ivf-actions">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => setUseSavedOpen(true)} disabled={readOnly}>
            Use saved
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setSaveTemplateOpen(true)}
            disabled={disabled}
          >
            Save as template
          </button>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {!issued && (
            <button
              className="btn btn-sm"
              onClick={() => save.mutate()}
              disabled={readOnly || !dirty || save.isPending}
            >
              {save.isPending ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
            </button>
          )}
          <button
            className="btn btn-sm"
            onClick={() => flushThen(() => setPreviewOpen(true))}
            disabled={save.isPending}
          >
            Preview
          </button>
          {issued ? (
            <button
              className="btn btn-sm btn-danger"
              onClick={() => setConfirmWithdraw(true)}
              disabled={!canEdit}
            >
              Withdraw
            </button>
          ) : (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => issue.mutate()}
              disabled={readOnly || issue.isPending}
            >
              {issue.isPending ? 'Issuing…' : 'Issue to patient'}
            </button>
          )}
        </div>
      </div>

      {previewOpen && (
        <IvfPreviewModal
          load={() => ivfCaseSheetApi.preview(appointmentId)}
          loadPrintCopy={() => ivfCaseSheetApi.printCopy(appointmentId)}
          onClose={() => setPreviewOpen(false)}
          onIssue={!issued && canEdit && !disabled ? () => issue.mutate() : undefined}
          issuing={issue.isPending}
        />
      )}

      {useSavedOpen && (
        <UseSavedModal
          onClose={() => setUseSavedOpen(false)}
          onApply={(id) => applySaved.mutate(id)}
          applying={applySaved.isPending}
        />
      )}

      {saveTemplateOpen && (
        <SaveTemplateModal
          data={data}
          onClose={() => setSaveTemplateOpen(false)}
          onSaved={() => {
            setSaveTemplateOpen(false);
            toast.success('Saved', 'You will find it under My templates.');
          }}
        />
      )}

      {confirmWithdraw && (
        <ConfirmDialog
          title="Withdraw this prescription?"
          message="It goes back to a draft, the PDF is removed and the patient can no longer open it. You can edit and issue it again."
          confirmLabel="Withdraw"
          cancelLabel="Keep it"
          busy={withdraw.isPending}
          onCancel={() => setConfirmWithdraw(false)}
          onConfirm={() => withdraw.mutate()}
        />
      )}
    </div>
  );
}

// ── Preview modal ────────────────────────────────────────────
function IvfPreviewModal({
  load,
  loadPrintCopy,
  onClose,
  onIssue,
  issuing,
}: {
  load: () => Promise<Blob>;
  loadPrintCopy: () => Promise<Blob>;
  onClose: () => void;
  onIssue?: () => void;
  issuing?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let alive = true;
    load()
      .then((blob) => {
        if (!alive) return;
        const u = URL.createObjectURL(blob);
        revoked = u;
        setUrl(u);
      })
      .catch(() => alive && setError('The preview could not be rendered.'));
    return () => {
      alive = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [load]);

  const printCopy = async () => {
    try {
      const blob = await loadPrintCopy();
      const u = URL.createObjectURL(blob);
      const w = window.open(u);
      if (w) w.onload = () => w.print();
    } catch {
      setError('The print copy could not be rendered.');
    }
  };

  return (
    <Modal
      title="Preview prescription"
      onClose={onClose}
      large
      footer={
        <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            This is exactly what the patient receives. Nothing has been sent yet.
          </span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={printCopy}>
              Print on pad
            </button>
            <button className="btn btn-sm" onClick={onClose}>
              Close
            </button>
            {onIssue && (
              <button className="btn btn-primary btn-sm" disabled={issuing || !url} onClick={onIssue}>
                {issuing ? 'Issuing…' : 'Issue to patient'}
              </button>
            )}
          </div>
        </div>
      }
    >
      {error ? (
        <div className="muted" style={{ padding: 24 }}>{error}</div>
      ) : url ? (
        <iframe title="Prescription preview" src={url} style={{ width: '100%', height: '68vh', border: 0 }} />
      ) : (
        <div className="muted" style={{ padding: 24 }}>Rendering…</div>
      )}
    </Modal>
  );
}

// ── Use a saved prescription ─────────────────────────────────
function UseSavedModal({
  onClose,
  onApply,
  applying,
}: {
  onClose: () => void;
  onApply: (id: string) => void;
  applying: boolean;
}) {
  const listQ = useQuery({ queryKey: ['ivf-templates'], queryFn: () => ivfTemplatesApi.list() });

  return (
    <Modal title="Use a saved prescription" onClose={onClose}>
      {listQ.isLoading ? (
        <div className="muted" style={{ padding: 16 }}>Loading…</div>
      ) : (listQ.data ?? []).length === 0 ? (
        <div className="muted" style={{ padding: 16 }}>
          Nothing saved yet. Fill this prescription and use “Save as template”, or
          create one under My templates.
        </div>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12.5, padding: '8px 8px 0' }}>
            Applying replaces what is on this prescription now.
          </p>
          <ul className="ivf-template-list">
            {(listQ.data ?? []).map((t: IvfCaseSheetTemplate) => (
              <li key={t.id}>
                <span>{t.name}</span>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={applying}
                  onClick={() => onApply(t.id)}
                >
                  Use
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

// ── Save-as-template modal ───────────────────────────────────
function SaveTemplateModal({
  data,
  onClose,
  onSaved,
}: {
  data: IvfCaseSheetData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: () => ivfTemplatesApi.create({ name: name.trim(), data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ivf-templates'] });
      onSaved();
    },
    onError: (e) => toast.error(e),
  });

  return (
    <Modal
      title="Save as template"
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={name.trim().length < 2 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save template'}
          </button>
        </div>
      }
    >
      <label className="ivf-field ivf-field-wide" style={{ padding: 8 }}>
        <span>Template name</span>
        <input
          className="input"
          autoFocus
          value={name}
          placeholder="e.g. Primary infertility — standard workup"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <p className="muted" style={{ fontSize: 12.5, padding: '0 8px 8px' }}>
        Saves this prescription under <b>My templates</b>, as the format you follow
        for IVF visits.
      </p>
    </Modal>
  );
}
