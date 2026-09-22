import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { ConfirmDialog, Empty, Field, Loading, Modal } from '../components/ui';
import { useToast } from '../components/Toast';
import type { Subscription, SubscriptionStatus } from '../api/types';

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

/** Days from today until `iso`; negative once it has passed. */
const daysLeft = (iso: string | null) =>
  iso === null ? null : Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

/**
 * The status badge reuses the app's record-state colours, so a subscription
 * reads the same way an appointment does: teal for settled, grey for spent,
 * amber for waiting, red for wrong.
 */
const STATUS_CLASS: Record<SubscriptionStatus, string> = {
  active: 'badge-done',
  pending: 'badge-on_hold',
  failed: 'badge-rejected',
  expired: 'badge-booked',
  cancelled: 'badge-rejected',
};

const FILTERS: { key: string; label: string; params: Record<string, unknown> }[] = [
  { key: 'active', label: 'Active', params: { active_only: true } },
  { key: 'pending', label: 'Awaiting payment', params: { status: 'pending' } },
  { key: 'ended', label: 'Ended', params: { status: 'expired' } },
  { key: 'all', label: 'All', params: {} },
];

/**
 * Who is on which plan — super admin only.
 *
 * The list is subscriptions rather than doctors because that is what actually
 * exists: an account that paid but has not set its practice up yet has no
 * doctor row, and it is exactly the account somebody will come asking about.
 */
export default function SubscriptionsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState('active');
  const [granting, setGranting] = useState(false);
  const [cancelling, setCancelling] = useState<Subscription | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [grant, setGrant] = useState({ user_id: '', plan_id: '', months: '', note: '' });
  const [error, setError] = useState<string | null>(null);

  const params = FILTERS.find((f) => f.key === filter)?.params ?? {};
  const listQ = useQuery({
    queryKey: ['billing', 'subscriptions', filter],
    queryFn: () => billingApi.subscriptions({ ...params, limit: 100 }),
  });
  const summaryQ = useQuery({
    queryKey: ['billing', 'summary'],
    queryFn: billingApi.summary,
  });
  const plansQ = useQuery({ queryKey: ['billing', 'plans'], queryFn: billingApi.plans });
  // Only fetched once the dialog opens: nobody needs the account list to read
  // the table, and it is the one query here that grows with the platform.
  const accountsQ = useQuery({
    queryKey: ['billing', 'accounts'],
    queryFn: billingApi.accounts,
    enabled: granting,
  });

  const grantMut = useMutation({
    mutationFn: () =>
      billingApi.grant({
        user_id: grant.user_id.trim(),
        plan_id: grant.plan_id,
        ...(grant.months ? { months: Number(grant.months) } : {}),
        ...(grant.note.trim() ? { note: grant.note.trim() } : {}),
      }),
    onSuccess: (s) => {
      toast.success(
        `${s.planName} granted`,
        `${s.account.email} can sign in until ${date(s.endsAt)}. No payment was taken.`,
      );
      qc.invalidateQueries({ queryKey: ['billing'] });
      closeGrant();
    },
    onError: (e: unknown) =>
      setError(e instanceof ApiError ? e.message : 'Could not grant the plan.'),
  });

  const cancelMut = useMutation({
    mutationFn: (s: Subscription) => billingApi.cancel(s.id, cancelReason.trim() || undefined),
    onSuccess: (s) => {
      toast.success(
        'Subscription cancelled',
        `${s.account.email} is locked out from now. No refund was made through this system.`,
      );
      qc.invalidateQueries({ queryKey: ['billing'] });
      setCancelling(null);
      setCancelReason('');
    },
    onError: (e: unknown) => {
      toast.error(e, 'Could not cancel the subscription.');
      setCancelling(null);
    },
  });

  function closeGrant() {
    setGranting(false);
    setGrant({ user_id: '', plan_id: '', months: '', note: '' });
    setError(null);
  }

  if (listQ.isLoading) return <Loading />;

  const rows = listQ.data?.items ?? [];
  const s = summaryQ.data;
  const plans = plansQ.data ?? [];

  return (
    <div>
      <div className="page-head">
        <h2>Subscriptions</h2>
        <button className="btn btn-primary" onClick={() => setGranting(true)}>
          Grant a plan
        </button>
      </div>

      {s && (
        <div className="stat-row">
          <div className="card stat-tile">
            <span className="stat-num">{s.active}</span>
            <span className="stat-label">Active</span>
          </div>
          <div className="card stat-tile">
            <span className="stat-num">{s.pending}</span>
            <span className="stat-label">Awaiting payment</span>
          </div>
          <div className="card stat-tile">
            <span className="stat-num">{s.expiringSoon}</span>
            <span className="stat-label">Renewing in 30 days</span>
          </div>
          <div className="card stat-tile">
            <span className="stat-num">{inr(s.collected)}</span>
            <span className="stat-label">Collected, running plans</span>
          </div>
        </div>
      )}

      <div className="row filter-row">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`filter-btn ${filter === f.key ? 'active-filter' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty>Nothing here yet.</Empty>
      ) : (
        <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Plan</th>
                  <th>Paid</th>
                  <th>Runs until</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const left = daysLeft(r.endsAt);
                  return (
                    <tr key={r.id}>
                      <td>
                        <div className="cell-strong">{r.doctor?.name ?? r.account.name}</div>
                        <div className="cell-sub">{r.account.email}</div>
                        {!r.doctor && (
                          <div className="cell-sub cell-warn">Practice not set up yet</div>
                        )}
                      </td>
                      <td>
                        {r.planName}
                        <div className="cell-sub">{r.months} month cycle</div>
                      </td>
                      <td>
                        {r.granted ? (
                          <>
                            <span className="badge badge-on_hold">Granted</span>
                            {r.grantNote && <div className="cell-sub">{r.grantNote}</div>}
                          </>
                        ) : (
                          <>
                            {inr(r.totalAmount)}
                            <div className="cell-sub">incl. {inr(r.gstAmount)} GST</div>
                          </>
                        )}
                      </td>
                      <td>
                        {date(r.endsAt)}
                        {r.status === 'active' && left !== null && left >= 0 && (
                          <div className={`cell-sub ${left <= 30 ? 'cell-warn' : ''}`}>
                            {left === 0 ? 'today' : `${left} day${left === 1 ? '' : 's'} left`}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${STATUS_CLASS[r.status]}`}>{r.status}</span>
                      </td>
                      <td className="cell-actions">
                        {(r.status === 'active' || r.status === 'pending') && (
                          <button
                            className="btn btn-danger-ghost btn-sm"
                            onClick={() => setCancelling(r)}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      )}

      {granting && (
        <Modal title="Grant a plan" onClose={closeGrant} persistent>
          <div className="form-rows">
            <p className="muted" style={{ marginTop: 0 }}>
              Gives an account a plan with no payment — a trial, a complimentary stretch, or
              money taken offline. It is recorded in the payment log with your name on it.
            </p>

            <Field label="Account">
              <select
                className="input"
                value={grant.user_id}
                onChange={(e) => {
                  setGrant((g) => ({ ...g, user_id: e.target.value }));
                  setError(null);
                }}
              >
                <option value="">
                  {accountsQ.isLoading ? 'Loading accounts…' : 'Select a doctor'}
                </option>
                {(accountsQ.data ?? []).map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.doctorName ?? a.name} — {a.email}
                    {a.currentPlan ? ` · on ${a.currentPlan} until ${date(a.endsAt)}` : ' · no plan'}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Plan">
              <select
                className="input"
                value={grant.plan_id}
                onChange={(e) => setGrant((g) => ({ ...g, plan_id: e.target.value }))}
              >
                <option value="">Select a plan</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {inr(p.monthly)}/month, {p.months} month cycle
                    {p.isActive ? '' : ' (retired)'}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Months">
              <input
                className="input"
                type="number"
                min={1}
                max={60}
                placeholder="Leave blank for the plan's own cycle"
                value={grant.months}
                onChange={(e) => setGrant((g) => ({ ...g, months: e.target.value }))}
              />
              <span className="muted hint">
                If the account already has a plan, this is added to the end of it.
              </span>
            </Field>

            <Field label="Note">
              <input
                className="input"
                placeholder="Free trial agreed on the call."
                value={grant.note}
                onChange={(e) => setGrant((g) => ({ ...g, note: e.target.value }))}
              />
            </Field>

            {error && <p className="err">{error}</p>}

            <div className="modal-actions">
              <button className="btn" onClick={closeGrant}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!grant.user_id.trim() || !grant.plan_id || grantMut.isPending}
                onClick={() => grantMut.mutate()}
              >
                {grantMut.isPending ? 'Granting…' : 'Grant plan'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {cancelling && (
        <ConfirmDialog
          title="Cancel this subscription?"
          message={
            <>
              <p>
                <strong>{cancelling.doctor?.name ?? cancelling.account.name}</strong> (
                {cancelling.account.email}) is locked out of myDigitalOPD immediately — their
                booking page stops taking appointments.
              </p>
              <p className="muted">
                No refund is made through this system. Their records are kept.
              </p>
              <input
                className="input"
                placeholder="Reason (optional, shown in the payment log)"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </>
          }
          confirmLabel="Cancel subscription"
          cancelLabel="Keep it"
          destructive
          busy={cancelMut.isPending}
          onConfirm={() => cancelMut.mutate(cancelling)}
          onCancel={() => {
            setCancelling(null);
            setCancelReason('');
          }}
        />
      )}
    </div>
  );
}
