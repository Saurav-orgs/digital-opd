import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '../api/endpoints';
import { downloadFile } from '../lib/shareFile';
import { useOrderWatch } from '../lib/checkout';
import { daysLeft, inr, shortDate as date } from '../lib/money';
import { Empty, Loading, Spinner } from '../components/ui';
import { RenewPlanCard } from '../components/RenewPlanCard';
import { useToast } from '../components/Toast';
import type { Invoice, Subscription } from '../api/types';

/**
 * The doctor's own billing: the plan they are on, and every invoice the
 * platform has raised for them.
 *
 * Invoices and plan history are two different lists on purpose. A plan the
 * super admin granted — a trial, or money taken offline — is a real plan with
 * a real expiry but no invoice, because nothing was charged through us; if it
 * were folded into one table the doctor would be left looking for a download
 * that cannot exist. So the plans are listed as plans, and the invoices as
 * invoices, and each says plainly what it is.
 */
export default function BillingPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [downloading, setDownloading] = useState<string | null>(null);

  const billingQ = useQuery({ queryKey: ['billing', 'me'], queryFn: billingApi.mine });
  const invoicesQ = useQuery({ queryKey: ['billing', 'me', 'invoices'], queryFn: billingApi.myInvoices });

  // Cashfree appends ?order_id= when it sends the doctor back here.
  const orderId = params.get('order_id');
  const { status: order, timedOut } = useOrderWatch(orderId, billingApi.myOrder, () => {
    // The plan, the invoice list and the renewal window have all just changed.
    qc.invalidateQueries({ queryKey: ['billing'] });
  });

  async function download(inv: Invoice) {
    setDownloading(inv.id);
    try {
      downloadFile(await billingApi.myInvoicePdf(inv.id, `${inv.invoiceNo}.pdf`));
    } catch (err) {
      toast.error(err, 'Could not download the invoice.');
    } finally {
      setDownloading(null);
    }
  }

  if (billingQ.isLoading) return <Loading />;

  const data = billingQ.data;
  const current = data?.current ?? null;
  const upcoming = data?.upcoming ?? [];
  const left = daysLeft(current?.endsAt ?? null);
  const invoices = invoicesQ.data ?? [];
  // Everything except the cycle running now and the ones queued behind it.
  const queuedIds = new Set(upcoming.map((u) => u.id));
  const past = (data?.history ?? []).filter(
    (h: Subscription) => h.id !== current?.id && !queuedIds.has(h.id),
  );

  return (
    <div>
      <div className="page-head">
        <h2>Billing</h2>
      </div>

      {orderId && (
        <div
          className={`renew-result ${
            order?.status === 'active'
              ? 'is-good'
              : order && order.status !== 'pending'
                ? 'is-bad'
                : 'is-waiting'
          }`}
          role="status"
        >
          <span>
            {order?.status === 'active' ? (
              <>
                Payment received. Your <strong>{order.planName}</strong> plan now runs until{' '}
                <strong>{date(order.endsAt)}</strong>. The invoice is in the list below and on its
                way to your email.
              </>
            ) : order && order.status !== 'pending' ? (
              <>
                That payment did not go through, and nothing was charged. You can try again below.
              </>
            ) : timedOut ? (
              <>
                The bank has not confirmed this payment yet. Nothing is lost — reload this page in a
                few minutes, and get in touch if it still says this.
              </>
            ) : (
              <>Checking the payment with your bank…</>
            )}
          </span>
          <button
            className="btn btn-sm btn-ghost"
            style={{ marginLeft: 'auto' }}
            onClick={() => setParams({}, { replace: true })}
          >
            Dismiss
          </button>
        </div>
      )}

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
            {upcoming.length === 0 && left !== null && left <= 30 && (
              <p className="muted" style={{ fontSize: 13 }}>
                Renew before it ends to keep your booking page taking appointments.
              </p>
            )}
            {upcoming.map((u) => (
              <p key={u.id} className="my-plan-renew">
                Then <strong>{u.planName}</strong> from {date(u.startsAt)} until{' '}
                {date(u.endsAt)} — already paid for.
              </p>
            ))}
          </>
        ) : (
          <p className="muted">
            No active plan. Your booking page is not taking appointments — choose a plan below to
            start again.
          </p>
        )}
      </div>

      <RenewPlanCard />

      <div className="card">
        <div className="card-title">Invoices</div>
        {invoicesQ.isLoading ? (
          <Spinner />
        ) : invoices.length === 0 ? (
          <Empty>
            No invoices yet. One is raised, and emailed to you, each time a payment goes through.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Plan</th>
                  <th>Period</th>
                  <th>Amount</th>
                  <th aria-label="Download" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <div className="cell-strong">{inv.invoiceNo}</div>
                      <div className="cell-sub">{date(inv.issuedAt)}</div>
                    </td>
                    <td>
                      {inv.planName}
                      <div className="cell-sub">{inv.months} month cycle</div>
                    </td>
                    <td>
                      {date(inv.periodStart)} – {date(inv.periodEnd)}
                    </td>
                    <td>
                      <div className="cell-strong">{inr(inv.totalAmount)}</div>
                      <div className="cell-sub">
                        {inr(inv.baseAmount)} + {inr(inv.gstAmount)} GST
                      </div>
                    </td>
                    <td className="cell-actions">
                      <button
                        className="btn btn-ghost"
                        onClick={() => void download(inv)}
                        disabled={downloading === inv.id}
                      >
                        {downloading === inv.id ? 'Preparing…' : 'Download'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {past.length > 0 && (
        <div className="card">
          <div className="card-title">Past plans</div>
          <ul className="my-plan-history">
            {past.map((h) => (
              <li key={h.id}>
                <span>
                  {h.planName}
                  <span className="muted">
                    {' · '}
                    {date(h.startsAt)} – {date(h.endsAt)}
                  </span>
                </span>
                <span className="muted">
                  {h.granted ? 'Granted' : inr(h.totalAmount)}
                  {h.status !== 'active' && h.status !== 'expired' ? ` · ${h.status}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
