import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { billingApi } from '../api/endpoints';
import { useCashfreeCheckout } from '../lib/checkout';
import { inr, longDate as date } from '../lib/money';
import { Spinner } from './ui';
import type { Plan } from '../api/types';

/**
 * Buying the next cycle, from inside the app.
 *
 * It appears in the last week of a plan and not before: a renewal button
 * following a doctor around for eleven months of a yearly plan is noise, and
 * the moment it stops being noise is the moment the clinic is about to stop
 * taking bookings.
 *
 * Paying early costs nothing — the server stacks the new cycle onto the end of
 * the running one — and the card says so, because the fear of losing the days
 * already paid for is exactly what makes people wait until the last day.
 *
 * Pick a plan, pay. Nothing else is asked: the receipt, the invoice and the
 * confirmation all go to the address this doctor signs in with, so the phone
 * number the card used to collect for Cashfree bought nothing and is now
 * filled in by the server from the clinic record.
 */
export function RenewPlanCard() {
  const [chosen, setChosen] = useState<string | null>(null);
  const { open, busy, error } = useCashfreeCheckout();

  const renewalQ = useQuery({ queryKey: ['billing', 'me', 'renewal'], queryFn: billingApi.renewal });

  if (renewalQ.isLoading) {
    return (
      <div className="card">
        <div className="card-title">Renew</div>
        <Spinner />
      </div>
    );
  }

  const renewal = renewalQ.data;
  if (!renewal) return null;

  // Outside the window there is nothing to do here but say when there will be.
  if (!renewal.canRenew) {
    return (
      <div className="card">
        <div className="card-title">Renew</div>
        <p className="muted">
          Your plan runs until <strong>{date(renewal.currentEndsAt)}</strong>. You can renew it from{' '}
          <strong>{date(renewal.renewableFrom)}</strong> — we will remind you here.
        </p>
      </div>
    );
  }

  const plans = renewal.plans ?? [];
  const plan = plans.find((p) => p.code === chosen) ?? null;

  // Cashfree brings the doctor back to /billing?order_id=…, which the Billing
  // screen then polls.
  const pay = () => plan && open(() => billingApi.renew({ plan: plan.code }));

  return (
    <div className="card">
      <div className="card-title">{renewal.currentEndsAt ? 'Renew your plan' : 'Choose a plan'}</div>
      <p className="muted" style={{ marginTop: 0 }}>
        {renewal.startsAfter ? (
          <>
            Your plan ends on <strong>{date(renewal.currentEndsAt)}</strong>. Pay now and the new
            cycle starts the day it ends — none of the days you have already paid for are lost.
          </>
        ) : (
          <>Pick a plan to start taking appointments again. It begins as soon as the payment lands.</>
        )}
      </p>

      <div className="renew-plans">
        {plans.map((p: Plan) => (
          <button
            key={p.id}
            type="button"
            className={`renew-plan ${chosen === p.code ? 'is-chosen' : ''}`}
            onClick={() => setChosen(p.code)}
            aria-pressed={chosen === p.code}
          >
            <span className="renew-plan-name">
              {p.name}
              {p.isRecommended && <span className="renew-plan-tag">Popular</span>}
            </span>
            <span className="renew-plan-price">{inr(p.price.total)}</span>
            <span className="renew-plan-sub">
              {p.months} month{p.months === 1 ? '' : 's'} · incl. {inr(p.price.gst)} GST
            </span>
          </button>
        ))}
      </div>

      <p className="muted" style={{ fontSize: 13 }}>
        The receipt and the tax invoice are emailed to you, and the invoice also
        stays on this screen.
      </p>

      {error && <p style={{ color: 'var(--danger, red)', fontSize: 13 }}>{error}</p>}

      <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={!plan || busy} onClick={() => void pay()}>
          {busy
            ? 'Opening payment…'
            : plan
              ? `Pay ${inr(plan.price.total)}`
              : 'Choose a plan'}
        </button>
      </div>
    </div>
  );
}
