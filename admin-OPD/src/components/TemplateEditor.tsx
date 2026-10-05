import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { medicinesApi, templatesApi } from '../api/endpoints';
import type { PrescriptionTemplate, TemplateMedicine } from '../api/types';
import { ApiError } from '../api/client';
import { useToast } from './Toast';
import { Field, Modal } from './ui';
import { MedicineHead, MedicineRow, type MedicineRowValue } from './MedicineRow';
import { buildMedicineIndex, emptyIndex, type MedicineIndex } from '../lib/medicineCheck';

/**
 * The follow-up intervals the design offers.
 *
 * A fixed set rather than a free number: a template is a starting point the
 * doctor adjusts per patient, so a specific figure here would be precision the
 * form cannot express and nobody asked for. The server validates the same four.
 */
const FOLLOW_UPS: { days: number | null; label: string }[] = [
  { days: null, label: 'None' },
  { days: 3, label: '3 days' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
];

const NEW_CATEGORY = '\u0000new';

type Row = MedicineRowValue & { key: number };

/**
 * Create or edit a template.
 *
 * Editing a built-in is allowed and does not change the shared row — the
 * server writes this clinic's own overriding copy. That is why the saved
 * template's id can differ from the one passed in, and why the caller must
 * take the response rather than assume it patched what it sent.
 */
export function TemplateEditor({
  template,
  categories,
  prefill,
  onClose,
}: {
  /** The template being edited, or null to create one. */
  template: PrescriptionTemplate | null;
  categories: string[];
  /** Starting values, when opened from "Save as template" in a consultation. */
  prefill?: { name?: string; medicines?: TemplateMedicine[]; advice?: string };
  onClose: (saved?: PrescriptionTemplate) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const nextKey = useRef(0);

  const seed = (list: TemplateMedicine[] | undefined): Row[] =>
    (list ?? []).map((m) => ({ ...m, key: nextKey.current++ }));

  const [name, setName] = useState(template?.name ?? prefill?.name ?? '');
  const [category, setCategory] = useState(template?.category ?? '');
  // Free text only while "+ New category…" is chosen, so the select keeps its
  // own value and the typed one cannot be silently lost by switching back.
  const [newCategory, setNewCategory] = useState('');
  const [advice, setAdvice] = useState(template?.advice ?? prefill?.advice ?? '');
  const [followUp, setFollowUp] = useState<number | null>(template?.follow_up_days ?? null);
  const [rows, setRows] = useState<Row[]>(() =>
    seed(template?.medicines ?? prefill?.medicines),
  );

  const catalogQ = useQuery({
    queryKey: ['medicine-catalog'],
    queryFn: () => medicinesApi.catalog(),
    staleTime: 5 * 60 * 1000,
  });
  const medicineIndex: MedicineIndex = useMemo(
    () => (catalogQ.data ? buildMedicineIndex(catalogQ.data.map((m) => m.name)) : emptyIndex),
    [catalogQ.data],
  );

  const effectiveCategory = category === NEW_CATEGORY ? newCategory.trim() : category.trim();
  const filledRows = rows.filter((r) => r.medicine_name?.trim());
  /**
   * Medicines are optional. A template is valid with at least one medicine
   * **or** some advice — an advice-led template ("no intercourse with your
   * partner", "follicular scan on day 6") often carries no drug at all, and
   * demanding one would rule out the templates this feature exists for.
   */
  const valid = !!name.trim() && !!effectiveCategory && (filledRows.length > 0 || !!advice.trim());

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        category: effectiveCategory,
        advice: advice.trim() || undefined,
        follow_up_days: followUp ?? undefined,
        medicines: filledRows.map((r) => ({
          medicine_name: r.medicine_name.trim(),
          strength: r.strength?.trim() || undefined,
          form: r.form?.trim() || undefined,
          dosage: r.dosage?.trim() || '',
          duration_days: r.duration_days ?? undefined,
          duration_text: r.duration_text?.trim() || undefined,
          instructions: r.instructions?.trim() || undefined,
        })),
      };
      return template ? templatesApi.update(template.id, body) : templatesApi.create(body);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.invalidateQueries({ queryKey: ['template-categories'] });
      toast.success(
        template ? 'Template updated' : 'Template saved',
        // Editing a built-in is a copy, not a change to the shared one, and
        // saying so here is the only place the doctor learns it.
        template && template.is_builtin && !template.overrides_builtin
          ? 'Your version replaces the built-in for this clinic only.'
          : undefined,
      );
      onClose(saved);
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e : 'Could not save the template.'),
  });

  const patch = (key: number, next: Partial<MedicineRowValue>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));

  return (
    <Modal
      title={template ? 'Edit template' : 'New template'}
      onClose={() => onClose()}
      large
      persistent
      footer={
        <div className="modal-actions">
          <button className="btn" onClick={() => onClose()} disabled={save.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save template'}
          </button>
        </div>
      }
    >
      <div className="tpl-form">
        <div className="form-row-2">
          <Field label="Name">
            <input
              className="input"
              placeholder="e.g. Viral fever — adult"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Category">
            <select
              className="select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Choose a category…</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value={NEW_CATEGORY}>+ New category…</option>
            </select>
          </Field>
        </div>

        {category === NEW_CATEGORY && (
          <Field label="New category">
            <input
              className="input"
              placeholder="e.g. Paediatrics"
              autoFocus
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            />
          </Field>
        )}

        <div className="tpl-section">
          <div className="tpl-section-head">
            <span className="tpl-section-title">Medicines</span>
            <span className="muted tpl-section-hint">Optional</span>
          </div>

          {rows.length === 0 ? (
            /*
              Opens with no row at all, unlike the prototype's one blank row.
              A blank row on an advice-only template is a field the doctor has
              to work out is optional; an empty list with an Add button says it.
            */
            <p className="muted tpl-empty-note">
              No medicines yet. A template can be advice alone.
            </p>
          ) : (
            <>
              <MedicineHead />
              {rows.map((r) => (
                <MedicineRow
                  key={r.key}
                  row={r}
                  listId={`tpl-med-${r.key}`}
                  medicineIndex={medicineIndex}
                  canEdit
                  freeDuration
                  onChange={(next) => patch(r.key, next)}
                  onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                />
              ))}
            </>
          )}

          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                { key: nextKey.current++, medicine_name: '', dosage: '' },
              ])
            }
          >
            + Add medicine
          </button>
        </div>

        <Field label="Advice">
          <textarea
            className="input"
            rows={3}
            placeholder="Diet, rest, what to watch for, when to come back…"
            value={advice}
            onChange={(e) => setAdvice(e.target.value)}
          />
        </Field>

        <div className="tpl-section">
          <div className="tpl-section-head">
            <span className="tpl-section-title">Follow-up</span>
          </div>
          <div className="tpl-chips">
            {FOLLOW_UPS.map((f) => (
              <button
                key={f.label}
                type="button"
                className={`tpl-chip ${followUp === f.days ? 'selected' : ''}`}
                aria-pressed={followUp === f.days}
                onClick={() => setFollowUp(f.days)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
