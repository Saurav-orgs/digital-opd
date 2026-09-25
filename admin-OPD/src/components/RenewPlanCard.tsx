import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { load, type Cashfree } from '@cashfreepayments/cashfree-js';
import { billingApi, doctorsApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { Spinner } from './ui';
import type { Plan } from '../api/types';

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—';

const MOBILE_RE = /^[6-9]\d{9}$/;

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
 */
export function RenewPlanCard() {
  const [chosen, setChosen] = useState<string | null>(null);
  const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cashfree = useRef<Cashfree | null>(null);

  const renewalQ = useQuery({ queryKey: ['billing', 'me', 'renewal'], queryFn: billingApi.renewal });
  // Only to prefill the phone box, from the clinic number on the profile. A
  // doctor who has not set their practice up yet simply types it.
  const meQ = useQuery({ queryKey: ['doctors', 'me'], queryFn: doctorsApi.me, retry: false });

  useEffect(() => {
    const onFile = meQ.data?.clinic_phone;
    if (onFile && !mobile) {
      const digits = onFile.replace(/\D/g, '').slice(-10);
      if (MOBILE_RE.test(digits)) setMobile(digits);
    }
  }, [meQ.data, mobile]);

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
  const ready = !!plan && MOBILE_RE.test(mobile);

  async function pay() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const session = await billingApi.renew({ plan: plan.code, mobile });
      cashfree.current ??= await load({ mode: session.env });
      if (!cashfree.current) throw new Error('checkout unavailable');
      // '_self' navigates this tab to the gateway; Cashfree brings the doctor
      // back to /billing?order_id=…, which the Billing screen then polls.
      await cashfree.current.checkout({
        paymentSessionId: session.paymentSessionId,
        redirectTarget: '_self',
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the payment. Please try again.');
      setBusy(false);
    }
  }

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

      <div className="renew-pay">
        <label className="form-label" htmlFor="renew-mobile">
          Mobile for the payment receipt
        </label>
        <input
          id="renew-mobile"
          className="input"
          inputMode="numeric"
          placeholder="10-digit mobile number"
          value={mobile}
          onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
        />
      </div>

      {error && <p style={{ color: 'var(--danger, red)', fontSize: 13 }}>{error}</p>}

      <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" disabled={!ready || busy} onClick={() => void pay()}>
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
