import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { ConfirmDialog, Field, Loading, Modal } from '../components/ui';
import { useToast } from '../components/Toast';
import type { Plan, PlanInput } from '../api/types';

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** "every month" / "every 3 months" / "once a year". */
const cycle = (months: number) =>
  months === 1 ? 'every month' : months === 12 ? 'once a year' : `every ${months} months`;

interface Draft {
  code: string;
  name: string;
  tagline: string;
  monthly_amount: string;
  months: string;
  is_active: boolean;
  is_recommended: boolean;
  sort_order: string;
}

const emptyDraft: Draft = {
  code: '',
  name: '',
  tagline: '',
  monthly_amount: '',
  months: '1',
  is_active: true,
  is_recommended: false,
  sort_order: '0',
};

const toDraft = (p: Plan): Draft => ({
  code: p.code,
  name: p.name,
  tagline: p.tagline ?? '',
  monthly_amount: String(p.monthly),
  months: String(p.months),
  is_active: p.isActive,
  is_recommended: p.isRecommended,
  sort_order: String(p.sortOrder),
});

/**
 * The price list — super admin only.
 *
 * These prices are what the landing page shows and what a checkout charges,
 * so the screen is deliberately blunt about consequences: editing an amount
 * changes what the *next* doctor pays and nothing about a cycle already paid
 * for, and a plan somebody is on cannot be deleted, only retired.
 */
export default function PlansPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Plan | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [retiring, setRetiring] = useState<Plan | null>(null);

  const plansQ = useQuery({ queryKey: ['billing', 'plans'], queryFn: billingApi.plans });

  const done = (message: string, body?: string) => {
    toast.success(message, body);
    qc.invalidateQueries({ queryKey: ['billing'] });
    close();
  };
  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : 'Could not save. Please try again.');

  const save = useMutation({
    mutationFn: () => {
      const body: PlanInput = {
        name: draft.name.trim(),
        tagline: draft.tagline.trim(),
        monthly_amount: Number(draft.monthly_amount),
        months: Number(draft.months),
        is_active: draft.is_active,
        is_recommended: draft.is_recommended,
        sort_order: Number(draft.sort_order || 0),
      };
      return editing
        ? billingApi.updatePlan(editing.id, body)
        : billingApi.createPlan({ ...body, code: draft.code.trim().toLowerCase() });
    },
    onSuccess: (p) =>
      done(
        editing ? `${p.name} updated` : `${p.name} created`,
        editing
          ? 'New sign-ups pay the new price. Plans already paid for keep theirs.'
          : `Doctors can buy it at /signup?plan=${p.code}`,
      ),
    onError: fail,
  });

  const retire = useMutation({
    mutationFn: (p: Plan) => billingApi.removePlan(p.id),
    onSuccess: (p) => {
      toast.success(`${p.name} retired`, 'It is off the pricing page. Existing plans keep running.');
      qc.invalidateQueries({ queryKey: ['billing'] });
      setRetiring(null);
    },
    onError: (e: unknown) => {
      toast.error(e, 'Could not retire the plan. Please try again.');
      setRetiring(null);
    },
  });

  function close() {
    setEditing(null);
    setCreating(false);
    setDraft(emptyDraft);
    setError(null);
  }

  const openCreate = () => {
    setDraft(emptyDraft);
    setEditing(null);
    setError(null);
    setCreating(true);
  };
  const openEdit = (p: Plan) => {
    setDraft(toDraft(p));
    setEditing(p);
    setError(null);
  };

  if (plansQ.isLoading) return <Loading />;

  const plans = plansQ.data ?? [];
  const amount = Number(draft.monthly_amount);
  const months = Number(draft.months);
  const valid =
    draft.name.trim().length >= 2 &&
    amount > 0 &&
    months >= 1 &&
    (editing !== null || /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(draft.code.trim().toLowerCase()));
  // Shown live in the dialog so nobody has to work out the GST by hand.
  const preview = amount > 0 && months >= 1 ? Math.round(amount * months * 1.18 * 100) / 100 : 0;

  return (
    <div>
      <div className="page-head">
        <h2>Plans</h2>
        <button className="btn btn-primary" onClick={openCreate}>
          New plan
        </button>
      </div>
      <p className="muted page-sub">
        What doctors see on the pricing page and pay at checkout. Editing a price changes what
        the next doctor pays — a cycle already paid for keeps the price it was sold at.
      </p>

      <div className="plan-grid">
        {plans.map((p) => (
          <div key={p.id} className={`card plan-card ${p.isActive ? '' : 'is-retired'}`}>
            <div className="plan-card-head">
              <div>
                <h3>{p.name}</h3>
                <code className="plan-code">{p.code}</code>
              </div>
              <div className="plan-flags">
                {p.isRecommended && <span className="badge badge-confirmed">Most popular</span>}
                {!p.isActive && <span className="badge badge-booked">Retired</span>}
              </div>
            </div>

            {p.tagline && <p className="muted plan-card-tagline">{p.tagline}</p>}

            <div className="plan-card-price">
              <strong>{inr(p.monthly)}</strong>
              <span className="muted">/ month</span>
            </div>
            <dl className="plan-card-facts">
              <div>
                <dt>Billed</dt>
                <dd>
                  {inr(p.price.base)} + GST {cycle(p.months)}
                </dd>
              </div>
              <div>
                <dt>Charged</dt>
                <dd>{inr(p.price.total)}</dd>
              </div>
              <div>
                <dt>On this plan</dt>
                <dd>{p.activeCount ?? 0} doctor{(p.activeCount ?? 0) === 1 ? '' : 's'}</dd>
              </div>
            </dl>

            <div className="plan-card-actions">
              <button className="btn" onClick={() => openEdit(p)}>
                Edit
              </button>
              {p.isActive && (
                <button className="btn btn-danger-ghost" onClick={() => setRetiring(p)}>
                  Retire
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {(creating || editing) && (
        <Modal title={editing ? `Edit ${editing.name}` : 'New plan'} onClose={close}>
          <div className="form-rows">
            {!editing && (
              <Field label="Code">
                <input
                  className="input"
                  placeholder="half-yearly"
                  value={draft.code}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, code: e.target.value }));
                    setError(null);
                  }}
                />
                <span className="muted hint">
                  Lower-case, hyphens allowed. It appears in the sign-up link and cannot be
                  changed later.
                </span>
              </Field>
            )}

            <Field label="Name">
              <input
                className="input"
                placeholder="Half-yearly"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </Field>

            <Field label="Tagline">
              <input
                className="input"
                placeholder="Six months at a better rate."
                value={draft.tagline}
                onChange={(e) => setDraft((d) => ({ ...d, tagline: e.target.value }))}
              />
            </Field>

            <div className="form-row-2">
              <Field label="Rupees per month">
                <input
                  className="input"
                  type="number"
                  min={1}
                  step="1"
                  placeholder="1899"
                  value={draft.monthly_amount}
                  onChange={(e) => setDraft((d) => ({ ...d, monthly_amount: e.target.value }))}
                />
              </Field>
              <Field label="Cycle (months)">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={60}
                  value={draft.months}
                  disabled={!!editing && (editing.activeCount ?? 0) > 0}
                  onChange={(e) => setDraft((d) => ({ ...d, months: e.target.value }))}
                />
              </Field>
            </div>

            {preview > 0 && (
              <p className="plan-preview">
                A doctor pays <strong>{inr(preview)}</strong> {cycle(months)} — {inr(amount * months)}{' '}
                plus 18% GST.
              </p>
            )}

            <Field label="Order on the pricing page">
              <input
                className="input"
                type="number"
                min={0}
                value={draft.sort_order}
                onChange={(e) => setDraft((d) => ({ ...d, sort_order: e.target.value }))}
              />
            </Field>

            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) => setDraft((d) => ({ ...d, is_active: e.target.checked }))}
              />
              <span>
                On sale
                <span className="muted hint">Unticked, it disappears from the pricing page.</span>
              </span>
            </label>

            <label className="check-row">
              <input
                type="checkbox"
                checked={draft.is_recommended}
                onChange={(e) => setDraft((d) => ({ ...d, is_recommended: e.target.checked }))}
              />
              <span>
                Highlight as "Most popular"
                <span className="muted hint">Only one plan carries the badge.</span>
              </span>
            </label>

            {error && <p className="err">{error}</p>}

            <div className="modal-actions">
              <button className="btn" onClick={close}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!valid || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create plan'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {retiring && (
        <ConfirmDialog
          title={`Retire ${retiring.name}?`}
          message={
            (retiring.activeCount ?? 0) > 0
              ? `It comes off the pricing page so nobody new can buy it. The ${retiring.activeCount} doctor(s) already on it keep it until their cycle ends.`
              : 'It comes off the pricing page. Nobody is on this plan, so nothing else changes.'
          }
          confirmLabel="Retire plan"
          destructive
          busy={retire.isPending}
          onConfirm={() => retire.mutate(retiring)}
          onCancel={() => setRetiring(null)}
        />
      )}
    </div>
  );
}
