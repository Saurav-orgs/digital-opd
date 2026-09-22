import { useQuery } from '@tanstack/react-query';
import { billingApi } from '../api/endpoints';
import { Spinner } from './ui';

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

const daysLeft = (iso: string | null) =>
  iso === null ? null : Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

/**
 * "My plan" on the doctor's own profile: what they are on, when it renews,
 * and what they have paid.
 *
 * An account that predates plans has nothing to show — it is not gated and
 * has no subscription — so the card renders nothing rather than an empty
 * box asking a question the doctor cannot act on.
 */
export function MyPlanCard() {
  const billingQ = useQuery({ queryKey: ['billing', 'me'], queryFn: billingApi.mine });

  if (billingQ.isLoading) {
    return (
      <div className="card">
        <div className="card-title">My plan</div>
        <Spinner />
      </div>
    );
  }
  const data = billingQ.data;
  if (!data || (!data.current && data.history.length === 0)) return null;

  const current = data.current;
  const left = daysLeft(current?.endsAt ?? null);
  // Everything except the plan they are on now — the receipts.
  const past = data.history.filter((h) => h.id !== current?.id);

  return (
    <div className="card">
      <div className="card-title">My plan</div>

      {current ? (
        <>
          <div className="my-plan-head">
            <div>
              <strong className="my-plan-name">{current.planName}</strong>
              <div className="muted">
                {current.granted
                  ? 'Given by myDigitalOPD — nothing was charged.'
                  : `${inr(current.totalAmount)} paid, incl. ${inr(current.gstAmount)} GST`}
              </div>
            </div>
            <span className="badge badge-done">Active</span>
          </div>
          <p className={`my-plan-renew ${left !== null && left <= 30 ? 'is-soon' : ''}`}>
            Runs until <strong>{date(current.endsAt)}</strong>
            {left !== null && left >= 0 && ` · ${left} day${left === 1 ? '' : 's'} left`}
          </p>
          {left !== null && left <= 30 && (
            <p className="muted" style={{ fontSize: 13 }}>
              To renew, pick a plan again on the myDigitalOPD site and sign in with this email
              and password.
            </p>
          )}
        </>
      ) : (
        <p className="muted">No active plan. Your booking page is not taking appointments.</p>
      )}

      {past.length > 0 && (
        <>
          <div className="my-plan-sub">Previous payments</div>
          <ul className="my-plan-history">
            {past.map((h) => (
              <li key={h.id}>
                <span>
                  {h.planName}
                  <span className="muted"> · {date(h.paidAt ?? h.startsAt)}</span>
                </span>
                <span className="muted">
                  {h.granted ? 'Granted' : inr(h.totalAmount)}
                  {h.status !== 'active' && h.status !== 'expired' ? ` · ${h.status}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
