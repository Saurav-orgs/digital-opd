import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doctorsApi, ivfTemplatesApi, templatesApi } from '../api/endpoints';
import type {
  IvfCaseSheetData,
  IvfCaseSheetTemplate,
  PrescriptionTemplate,
} from '../api/types';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog, Empty, FloatingCta, Loading, Modal, SearchField } from '../components/ui';
import { TemplateEditor } from '../components/TemplateEditor';
import { formatDuration } from '../lib/duration';
import { isIvfDoctor } from '../lib/ivfCaseSheet';
import { IvfSheetForm } from '../components/IvfSheetForm';

/**
 * The doctor's saved templates — everything here is something they wrote.
 *
 * There is no Pre-added tab any more: the eight shipped templates were removed
 * (migration `20261006000001`), so the page is one list rather than two halves.
 *
 * An IVF & Fertility doctor writes visits on the IVF case sheet rather than
 * the structured editor, so for them this page lists their saved case sheets
 * instead — the ones "Save as template" on the case sheet puts here.
 */
export default function TemplatesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<PrescriptionTemplate | null | undefined>(undefined);
  const [confirming, setConfirming] = useState<PrescriptionTemplate | null>(null);

  const canWrite = can('appointments', 'update');
  const canCreate = can('appointments', 'create');

  // Which kind of template this doctor keeps. One request, on this page only.
  const meQ = useQuery({ queryKey: ['doctor-me'], queryFn: () => doctorsApi.me() });
  const ivf = isIvfDoctor(meQ.data?.specialization);

  const templatesQ = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list(),
    enabled: meQ.isSuccess && !ivf,
  });
  const categoriesQ = useQuery({
    queryKey: ['template-categories'],
    queryFn: () => templatesApi.categories(),
  });

  const all = useMemo(() => templatesQ.data ?? [], [templatesQ.data]);
  /*
   * Filtering is client-side although the endpoint accepts `q` and `category`.
   * A clinic has tens of templates, not thousands — the whole list arrives in
   * one request — so a round trip per keystroke would only add latency to a
   * filter the browser can do instantly.
   */
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((t) => !category || t.category === category)
      .filter(
        (t) =>
          !q ||
          t.name.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.medicines.some((m) => m.medicine_name.toLowerCase().includes(q)),
      );
  }, [all, category, search]);

  const remove = useMutation({
    mutationFn: (t: PrescriptionTemplate) => templatesApi.remove(t.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template deleted');
      setConfirming(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e : 'Could not delete the template.'),
  });

  if (meQ.isLoading) return <Loading />;
  // An IVF doctor's templates are case sheets, not medicine rows.
  if (ivf) return <IvfTemplatesPanel canWrite={canWrite} canCreate={canCreate} />;
  if (templatesQ.isLoading) return <Loading />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My templates</h1>
          <p className="muted">
            Saved prescriptions you can apply to a visit and then adjust.
          </p>
        </div>
        {canCreate && (
          <FloatingCta>
            <button className="btn btn-primary" onClick={() => setEditing(null)}>
              + Create template
            </button>
          </FloatingCta>
        )}
      </div>

      <div className="list-panel">
        <div className="list-panel-head">
          <div className="dash-toolbar">
            <div className="dash-toolbar-filters">
              <select
                className="select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {(categoriesQ.data ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder="Search by name, category or medicine…"
                label="Search templates"
              />
            </div>
          </div>
        </div>

        {shown.length === 0 ? (
          <Empty>
            {search || category
              ? 'No templates match that.'
              : 'You have not saved a template yet. Write a prescription, then use “Save as template”.'}
          </Empty>
        ) : (
          <div className="tpl-grid">
            {shown.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                canWrite={canWrite}
                onEdit={() => setEditing(t)}
                onDelete={() => setConfirming(t)}
              />
            ))}
          </div>
        )}
      </div>

      {editing !== undefined && (
        <TemplateEditor
          template={editing}
          categories={categoriesQ.data ?? []}
          onClose={() => setEditing(undefined)}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title="Delete this template?"
          message={
            <>
              <b>{confirming.name}</b> will be removed from My templates. Prescriptions
              you already wrote from it are unaffected.
            </>
          }
          confirmLabel="Delete"
          destructive
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}

/**
 * An IVF doctor's saved prescriptions.
 *
 * These are prescriptions the doctor wrote, kept as the format they follow for
 * IVF visits. They can be created here from a blank form, opened and edited,
 * or saved straight off a visit with "Save as template" — and used on a visit
 * through "Use saved".
 */
function IvfTemplatesPanel({
  canWrite,
  canCreate,
}: {
  canWrite: boolean;
  canCreate: boolean;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  /** undefined = closed, null = a new one, otherwise the one being edited. */
  const [editing, setEditing] = useState<IvfCaseSheetTemplate | null | undefined>(undefined);
  const [confirming, setConfirming] = useState<IvfCaseSheetTemplate | null>(null);

  const listQ = useQuery({ queryKey: ['ivf-templates'], queryFn: () => ivfTemplatesApi.list() });

  const remove = useMutation({
    mutationFn: (t: IvfCaseSheetTemplate) => ivfTemplatesApi.remove(t.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ivf-templates'] });
      setConfirming(null);
      toast.success('Template deleted');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e : 'Could not delete the template.'),
  });

  if (listQ.isLoading) return <Loading />;

  const q = search.trim().toLowerCase();
  const shown = (listQ.data ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My templates</h1>
          <p className="muted">
            Your saved IVF prescriptions. Apply one to a visit with “Use saved”.
          </p>
        </div>
        {canCreate && (
          <FloatingCta>
            <button className="btn btn-primary" onClick={() => setEditing(null)}>
              + Create template
            </button>
          </FloatingCta>
        )}
      </div>

      <div className="list-panel">
        <div className="list-panel-head">
          <div className="dash-toolbar">
            <div className="dash-toolbar-filters">
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder="Search templates…"
                label="Search templates"
              />
            </div>
          </div>
        </div>

        {shown.length === 0 ? (
          <Empty>
            {q
              ? 'No templates match that.'
              : 'No templates yet. Create one here, or save a prescription from a visit.'}
          </Empty>
        ) : (
          <ul className="ivf-template-list">
            {shown.map((t) => (
              <li key={t.id}>
                <span>{t.name}</span>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-sm" onClick={() => setEditing(t)}>
                    {canWrite ? 'Edit' : 'View'}
                  </button>
                  {canWrite && (
                    <button className="btn btn-sm btn-danger" onClick={() => setConfirming(t)}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing !== undefined && (
        <IvfTemplateEditor
          template={editing}
          readOnly={!canWrite}
          onClose={() => setEditing(undefined)}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title="Delete this template?"
          message={
            <>
              <b>{confirming.name}</b> will be removed from My templates. Prescriptions
              you already wrote from it are unaffected.
            </>
          }
          confirmLabel="Delete"
          destructive
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}

/**
 * Create, read or change one saved IVF prescription — the same form the doctor
 * fills on a visit (`IvfSheetForm`), with a name over it. `template === null`
 * is a new one.
 */
function IvfTemplateEditor({
  template,
  readOnly,
  onClose,
}: {
  template: IvfCaseSheetTemplate | null;
  readOnly: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(template?.name ?? '');
  const [data, setData] = useState<IvfCaseSheetData>(template?.data ?? {});

  const save = useMutation({
    mutationFn: () =>
      template
        ? ivfTemplatesApi.update(template.id, { name: name.trim(), data })
        : ivfTemplatesApi.create({ name: name.trim(), data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ivf-templates'] });
      toast.success(template ? 'Template saved' : 'Template created');
      onClose();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e : 'Could not save the template.'),
  });

  return (
    <Modal
      title={template ? (readOnly ? template.name : 'Edit template') : 'New template'}
      onClose={onClose}
      large
      persistent
      footer={
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-sm" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button
              className="btn btn-sm btn-primary"
              disabled={name.trim().length < 2 || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save template'}
            </button>
          )}
        </div>
      }
    >
      <div className="ivf-sheet" style={{ padding: 4 }}>
        <label className="ivf-field ivf-field-wide">
          <span>Template name</span>
          <input
            className="input"
            value={name}
            disabled={readOnly}
            placeholder="e.g. Primary infertility — standard workup"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <IvfSheetForm value={data} onChange={setData} readOnly={readOnly} />
      </div>
    </Modal>
  );
}

function TemplateCard({
  template: t,
  canWrite,
  onEdit,
  onDelete,
}: {
  template: PrescriptionTemplate;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const adviceOnly = t.medicines.length === 0;

  return (
    <article className={`tpl-card ${adviceOnly ? 'advice-only' : ''}`}>
      <div className="tpl-card-head">
        <span className="tpl-cat">{t.category}</span>
      </div>

      <h3 className="tpl-name">{t.name}</h3>

      {adviceOnly ? (
        /*
          An advice-only template leads with its advice at full weight. Rendering
          it as a name over an empty medicine box, with the advice in the grey
          footnote a medicine card uses, would read as a broken record rather
          than as the kind of template it is.
        */
        <p className="tpl-advice-lead">{t.advice}</p>
      ) : (
        <>
          <ul className="tpl-meds">
            {t.medicines.map((m, i) => (
              <li key={i}>
                <span className="tpl-med-name">
                  {m.medicine_name}
                  {m.strength ? ` ${m.strength}` : ''}
                </span>
                <span className="tpl-med-dose">
                  {[m.dosage, m.duration_text || formatDuration(m.duration_days)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
          {t.advice && <p className="tpl-advice">{t.advice}</p>}
        </>
      )}

      <div className="tpl-card-foot">
        <span className="tpl-meta">
          {t.follow_up_days ? `Follow-up in ${formatDuration(t.follow_up_days)}` : 'No follow-up'}
          {t.usage_count > 0 && ` · used ${t.usage_count}×`}
        </span>
        {canWrite && (
          <div className="tpl-card-actions">
            <button className="btn btn-sm" onClick={onEdit}>
              Edit
            </button>
            <button className="btn btn-sm btn-danger" onClick={onDelete}>
              Delete
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
