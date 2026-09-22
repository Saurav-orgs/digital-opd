import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '../api/endpoints';
import { Empty, Loading, Modal } from '../components/ui';
import type { PaymentEvent, PaymentEventSource } from '../api/types';

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** What each source means, in the words somebody debugging would use. */
const SOURCE_LABEL: Record<PaymentEventSource, string> = {
  webhook: 'Webhook',
  poll: 'Status check',
  admin: 'Admin action',
  system: 'System',
};

const SOURCE_CLASS: Record<PaymentEventSource, string> = {
  webhook: 'badge-confirmed',
  poll: 'badge-booked',
  admin: 'badge-on_hold',
  system: 'badge-booked',
};

const FILTERS: { key: string; label: string; params: Record<string, unknown> }[] = [
  { key: 'all', label: 'Everything', params: {} },
  { key: 'webhook', label: 'Webhooks', params: { source: 'webhook' } },
  { key: 'poll', label: 'Status checks', params: { source: 'poll' } },
  { key: 'admin', label: 'Admin actions', params: { source: 'admin' } },
];

/**
 * The payment audit trail — super admin only.
 *
 * It shows every webhook Cashfree sent, including ones whose signature did
 * not match and ones for an order we do not know: those are dropped on the
 * floor by the API on purpose, and this is the only place they surface. When
 * a doctor says "I paid and cannot sign in", this screen is the answer —
 * either the event is here, or it never arrived and the dashboard's webhook
 * URL is wrong.
 */
export default function PaymentLogPage() {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [inspecting, setInspecting] = useState<PaymentEvent | null>(null);

  const params = FILTERS.find((f) => f.key === filter)?.params ?? {};
  const logQ = useQuery({
    queryKey: ['billing', 'events', filter, page],
    queryFn: () => billingApi.events({ ...params, page, limit: 50 }),
  });

  if (logQ.isLoading) return <Loading />;

  const data = logQ.data;
  const rows = data?.items ?? [];

  return (
    <div>
      <div className="page-head">
        <h2>Payment activity</h2>
      </div>
      <p className="muted page-sub">
        Every payment event this server has seen — webhooks from Cashfree, our own status
        checks, and plans granted or cancelled by hand. An unsigned webhook is recorded here
        and deliberately not acted on.
      </p>

      <div className="row filter-row">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`filter-btn ${filter === f.key ? 'active-filter' : ''}`}
            onClick={() => {
              setFilter(f.key);
              setPage(1);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty>
          No payment events yet. They appear here as soon as a doctor starts a checkout.
        </Empty>
      ) : (
        <>
          <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Source</th>
                    <th>Event</th>
                    <th>Doctor</th>
                    <th>Amount</th>
                    <th>Result</th>
                    <th aria-label="Details" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className={e.signatureValid === false ? 'row-warn' : ''}>
                      <td className="cell-nowrap">{when(e.at)}</td>
                      <td>
                        <span className={`badge ${SOURCE_CLASS[e.source]}`}>
                          {SOURCE_LABEL[e.source]}
                        </span>
                      </td>
                      <td>
                        <div className="cell-strong">{e.eventType}</div>
                        {e.message && <div className="cell-sub">{e.message}</div>}
                      </td>
                      <td>
                        {e.doctor?.name ?? e.user?.email ?? '—'}
                        {e.plan && <div className="cell-sub">{e.plan}</div>}
                      </td>
                      <td className="cell-nowrap">{e.amount === null ? '—' : inr(e.amount)}</td>
                      <td>
                        {e.signatureValid === false ? (
                          <span className="badge badge-rejected">Bad signature</span>
                        ) : e.applied ? (
                          <span className="badge badge-done">Applied</span>
                        ) : (
                          <span className="badge badge-booked">No change</span>
                        )}
                      </td>
                      <td className="cell-actions">
                        <button className="btn btn-sm" onClick={() => setInspecting(e)}>
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </div>

          {data && data.pages > 1 && (
            <div className="pager">
              <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span className="muted">
                Page {data.page} of {data.pages} · {data.total} events
              </span>
              <button
                className="btn"
                disabled={page >= data.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {inspecting && (
        <Modal title={inspecting.eventType} onClose={() => setInspecting(null)} large>
          <dl className="detail-list">
            <div>
              <dt>When</dt>
              <dd>{new Date(inspecting.at).toLocaleString('en-IN')}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{SOURCE_LABEL[inspecting.source]}</dd>
            </div>
            <div>
              <dt>Order</dt>
              <dd>
                <code>{inspecting.orderId ?? '—'}</code>
              </dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>
                <code>{inspecting.paymentId ?? '—'}</code>
              </dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>{inspecting.user?.email ?? '—'}</dd>
            </div>
            <div>
              <dt>Subscription status</dt>
              <dd>{inspecting.status ?? '—'}</dd>
            </div>
            {inspecting.message && (
              <div>
                <dt>What happened</dt>
                <dd>{inspecting.message}</dd>
              </div>
            )}
          </dl>

          {inspecting.payload ? (
            <>
              <div className="card-title" style={{ marginTop: 18 }}>
                Raw payload
              </div>
              <pre className="payload-box">{JSON.stringify(inspecting.payload, null, 2)}</pre>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 18 }}>
              No payload — this event came from inside the server, not from Cashfree.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
