import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { templatesApi } from '../api/endpoints';
import type { PrescriptionTemplate } from '../api/types';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog, Empty, FloatingCta, Loading, SearchField } from '../components/ui';
import { TemplateEditor } from '../components/TemplateEditor';
import { formatDuration } from '../lib/duration';

type Tab = 'builtin' | 'mine';

/**
 * The doctor's saved prescriptions.
 *
 * Two tabs, because the two halves answer different questions: Pre-added is
 * "what did this come with", My templates is "what have I written". An edited
 * built-in stays on the Pre-added tab — it is still one of the eight, and
 * moving it the moment the advice is tweaked would lose the doctor the row
 * they were looking for.
 */
export default function TemplatesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>('builtin');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<PrescriptionTemplate | null | undefined>(undefined);
  const [confirming, setConfirming] = useState<PrescriptionTemplate | null>(null);

  const canWrite = can('appointments', 'update');
  const canCreate = can('appointments', 'create');

  const templatesQ = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list(),
  });
  const categoriesQ = useQuery({
    queryKey: ['template-categories'],
    queryFn: () => templatesApi.categories(),
  });

  const all = useMemo(() => templatesQ.data ?? [], [templatesQ.data]);
  const counts = useMemo(
    () => ({
      builtin: all.filter((t) => t.is_builtin).length,
      mine: all.filter((t) => !t.is_builtin).length,
    }),
    [all],
  );

  /*
   * Filtering is client-side although the endpoint accepts `q` and `category`.
   * A clinic has tens of templates, not thousands — the whole list arrives in
   * one request — so a round trip per keystroke would only add latency to a
   * filter the browser can do instantly.
   */
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((t) => (tab === 'builtin' ? t.is_builtin : !t.is_builtin))
      .filter((t) => !category || t.category === category)
      .filter(
        (t) =>
          !q ||
          t.name.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.medicines.some((m) => m.medicine_name.toLowerCase().includes(q)),
      );
  }, [all, tab, category, search]);

  const remove = useMutation({
    mutationFn: (t: PrescriptionTemplate) => templatesApi.remove(t.id),
    onSuccess: (_r, t) => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      toast.success(
        t.overrides_builtin ? 'Template reverted' : 'Template deleted',
        t.overrides_builtin ? 'The built-in version is back.' : undefined,
      );
      setConfirming(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e : 'Could not delete the template.'),
  });

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
            <div className="seg">
              <button
                className={tab === 'builtin' ? 'selected' : ''}
                onClick={() => setTab('builtin')}
              >
                Pre-added <span className="seg-n">{counts.builtin}</span>
              </button>
              <button
                className={tab === 'mine' ? 'selected' : ''}
                onClick={() => setTab('mine')}
              >
                My templates <span className="seg-n">{counts.mine}</span>
              </button>
            </div>

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
              : tab === 'builtin'
                ? 'No pre-added templates are installed.'
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
          title={confirming.overrides_builtin ? 'Revert this template?' : 'Delete this template?'}
          message={
            confirming.overrides_builtin ? (
              <>
                Your version of <b>{confirming.name}</b> will be removed and the built-in
                one restored. Prescriptions you already wrote from it are unaffected.
              </>
            ) : (
              <>
                <b>{confirming.name}</b> will be removed from My templates. Prescriptions
                you already wrote from it are unaffected.
              </>
            )
          }
          confirmLabel={confirming.overrides_builtin ? 'Revert' : 'Delete'}
          destructive={!confirming.overrides_builtin}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
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
        {t.overrides_builtin && (
          <span className="tpl-badge" title="Your clinic's version of a built-in">
            Edited
          </span>
        )}
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
            {/* A shipped built-in is not the doctor's to remove; their edit of
                one is, and removing it is how the original comes back. */}
            {(!t.is_builtin || t.overrides_builtin) && (
              <button className="btn btn-sm btn-danger" onClick={onDelete}>
                {t.overrides_builtin ? 'Revert' : 'Delete'}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
