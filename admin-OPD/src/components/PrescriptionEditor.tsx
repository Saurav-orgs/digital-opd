import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { consultationApi, medicinesApi } from '../api/endpoints';
import type { PrescriptionMedicine } from '../api/types';
import { useToast } from './Toast';
import { Field } from './ui';

const blankRow = (): PrescriptionMedicine => ({
  medicine_name: '',
  strength: '',
  dosage: '',
  timing: '',
  duration_days: null,
  instructions: '',
  source: 'doctor',
});

/**
 * The doctor's review step. An AI draft lands here and nothing reaches the
 * patient until they press Issue — AI-suggested rows are marked so they get
 * looked at rather than skimmed.
 */
export function PrescriptionEditor({
  appointmentId,
  canEdit,
}: {
  appointmentId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const prescriptionQ = useQuery({
    queryKey: ['prescription', appointmentId],
    queryFn: () => consultationApi.prescription(appointmentId),
    // A background draft can land at any time while this is open.
    refetchInterval: (q) => (q.state.data?.status === 'draft' ? 5000 : false),
  });

  const [form, setForm] = useState({ diagnosis: '', advice: '', follow_up_date: '' });
  const [rows, setRows] = useState<PrescriptionMedicine[]>([]);
  const [dirty, setDirty] = useState(false);

  // Adopt server state unless the doctor has unsaved edits — otherwise the
  // poll would wipe what they are typing.
  useEffect(() => {
    const data = prescriptionQ.data;
    if (!data || dirty) return;
    setForm({
      diagnosis: data.diagnosis ?? '',
      advice: data.advice ?? '',
      follow_up_date: data.follow_up_date ?? '',
    });
    setRows(data.medicines.length ? data.medicines : []);
  }, [prescriptionQ.data, dirty]);

  const body = () => ({
    diagnosis: form.diagnosis || undefined,
    advice: form.advice || undefined,
    follow_up_date: form.follow_up_date || undefined,
    medicines: rows
      .filter((r) => r.medicine_name.trim())
      .map((r) => ({
        id: r.id,
        medicine_name: r.medicine_name.trim(),
        strength: r.strength || undefined,
        form: r.form || undefined,
        dosage: r.dosage || undefined,
        timing: r.timing || undefined,
        duration_days: r.duration_days ?? undefined,
        instructions: r.instructions || undefined,
      })),
  });

  const save = useMutation({
    mutationFn: () => consultationApi.savePrescription(appointmentId, body()),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['prescription', appointmentId] });
      toast.success('Draft saved');
    },
    onError: (e) => toast.error(e),
  });

  const issue = useMutation({
    // Save first so the doctor never issues a version they can't see.
    mutationFn: async () => {
      await consultationApi.savePrescription(appointmentId, body());
      return consultationApi.issuePrescription(appointmentId);
    },
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['prescription', appointmentId] });
      qc.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      toast.success('Prescription issued', 'The patient has been notified.');
    },
    onError: (e) => toast.error(e),
  });

  const patchRow = (i: number, patch: Partial<PrescriptionMedicine>) => {
    setDirty(true);
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const data = prescriptionQ.data;
  const issued = data?.status === 'issued';

  if (prescriptionQ.isLoading) {
    return <span className="muted">Loading prescription…</span>;
  }

  if (issued) {
    return (
      <div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="badge badge-available">Issued</span>
          {data?.pdf_url && (
            <a className="btn btn-sm" href={data.pdf_url} target="_blank" rel="noreferrer">
              Download PDF
            </a>
          )}
        </div>
        {data?.diagnosis && (
          <p style={{ marginTop: 10 }}>
            <strong>Diagnosis:</strong> {data.diagnosis}
          </p>
        )}
        <ol style={{ margin: '10px 0 0 18px' }}>
          {data?.medicines.map((m) => (
            <li key={m.id} style={{ marginBottom: 4 }}>
              <strong>
                {m.medicine_name}
                {m.strength ? ` ${m.strength}` : ''}
              </strong>
              <span className="muted" style={{ fontSize: 13 }}>
                {' '}
                · {m.dosage}
                {m.timing ? ` · ${m.timing}` : ''}
                {m.duration_days ? ` · ${m.duration_days} days` : ''}
              </span>
            </li>
          ))}
        </ol>
        {data?.advice && (
          <p className="muted" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>
            {data.advice}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="grid cols-2">
        <Field label="Diagnosis">
          <input
            className="input"
            disabled={!canEdit}
            value={form.diagnosis}
            onChange={(e) => {
              setDirty(true);
              setForm({ ...form, diagnosis: e.target.value });
            }}
          />
        </Field>
        <Field label="Follow-up date">
          <input
            className="input"
            type="date"
            disabled={!canEdit}
            value={form.follow_up_date}
            onChange={(e) => {
              setDirty(true);
              setForm({ ...form, follow_up_date: e.target.value });
            }}
          />
        </Field>
      </div>

      <div className="card-title" style={{ margin: '6px 0 8px' }}>
        Medicines
      </div>
      {rows.length === 0 && (
        <span className="muted" style={{ fontSize: 13 }}>
          No medicines yet.
        </span>
      )}

      <div className="stack" style={{ gap: 10 }}>
        {rows.map((row, i) => (
          <MedicineRow
            key={row.id ?? `new-${i}`}
            row={row}
            canEdit={canEdit}
            onChange={(patch) => patchRow(i, patch)}
            onRemove={() => {
              setDirty(true);
              setRows((prev) => prev.filter((_, idx) => idx !== i));
            }}
          />
        ))}
      </div>

      {canEdit && (
        <button
          className="btn btn-sm"
          style={{ marginTop: 10 }}
          onClick={() => {
            setDirty(true);
            setRows((prev) => [...prev, blankRow()]);
          }}
        >
          + Add medicine
        </button>
      )}

      <Field label="Advice">
        <textarea
          className="input"
          rows={2}
          disabled={!canEdit}
          value={form.advice}
          onChange={(e) => {
            setDirty(true);
            setForm({ ...form, advice: e.target.value });
          }}
        />
      </Field>

      {canEdit && (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            className="btn btn-sm"
            disabled={save.isPending || !dirty}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save draft'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={issue.isPending}
            onClick={() => issue.mutate()}
          >
            {issue.isPending ? 'Issuing…' : 'Issue prescription'}
          </button>
        </div>
      )}
    </div>
  );
}

function MedicineRow({
  row,
  canEdit,
  onChange,
  onRemove,
}: {
  row: PrescriptionMedicine;
  canEdit: boolean;
  onChange: (patch: Partial<PrescriptionMedicine>) => void;
  onRemove: () => void;
}) {
  const [query, setQuery] = useState('');
  const suggestionsQ = useQuery({
    queryKey: ['medicines', query],
    queryFn: () => medicinesApi.search(query),
    enabled: query.length >= 2,
  });

  const fromAi = row.source === 'ai';

  return (
    <div
      className="card"
      style={{
        padding: 12,
        background: fromAi ? '#f4f8ff' : undefined,
        borderLeft: fromAi ? '3px solid var(--primary)' : undefined,
      }}
    >
      {fromAi && (
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
          Suggested from the recording — please verify
        </div>
      )}
      <div className="grid cols-2">
        <Field label="Medicine">
          <input
            className="input"
            list={`meds-${row.id ?? row.medicine_name}`}
            disabled={!canEdit}
            value={row.medicine_name}
            onChange={(e) => {
              onChange({ medicine_name: e.target.value });
              setQuery(e.target.value);
            }}
          />
          <datalist id={`meds-${row.id ?? row.medicine_name}`}>
            {suggestionsQ.data?.map((m) => (
              <option key={m.id} value={m.name} />
            ))}
          </datalist>
        </Field>
        <Field label="Strength">
          <input
            className="input"
            disabled={!canEdit}
            value={row.strength ?? ''}
            onChange={(e) => onChange({ strength: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid cols-2">
        <Field label="Dosage (e.g. 1-0-1)">
          <input
            className="input"
            disabled={!canEdit}
            placeholder="1-0-1"
            value={row.dosage ?? ''}
            onChange={(e) => onChange({ dosage: e.target.value })}
          />
        </Field>
        <Field label="Timing">
          <select
            className="select"
            disabled={!canEdit}
            value={row.timing ?? ''}
            onChange={(e) => onChange({ timing: e.target.value })}
          >
            <option value="">—</option>
            <option value="before food">Before food</option>
            <option value="after food">After food</option>
          </select>
        </Field>
      </div>
      <div className="grid cols-2">
        <Field label="Duration (days)">
          <input
            className="input"
            type="number"
            min={1}
            disabled={!canEdit}
            value={row.duration_days ?? ''}
            onChange={(e) =>
              onChange({
                duration_days: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </Field>
        <Field label="Instructions">
          <input
            className="input"
            disabled={!canEdit}
            value={row.instructions ?? ''}
            onChange={(e) => onChange({ instructions: e.target.value })}
          />
        </Field>
      </div>
      {canEdit && (
        <button className="btn btn-sm btn-danger" onClick={onRemove}>
          Remove
        </button>
      )}
    </div>
  );
}
