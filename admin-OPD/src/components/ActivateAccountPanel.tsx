import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { signupApi } from '../api/endpoints';
import { useCashfreeCheckout, useOrderWatch } from '../lib/checkout';
import { inr } from '../lib/money';
import { Spinner } from './ui';
import type { Plan } from '../api/types';

export { longDate } from '../lib/money';

/**
 * Watches the order Cashfree has just sent the payer back to `/login` with.
 *
 * Public route: there is no session yet, and there cannot be one until the
 * payment it is reporting on has landed.
 */
export function useSignupOrderWatch(orderId: string | null) {
  return useOrderWatch(orderId, signupApi.order);
}

/**
 * Activating an account from the sign-in screen.
 *
 * A doctor whose plan has run out — or who never had one — is refused at sign-in
 * and cannot reach the Billing screen, because the server refuses every
 * authenticated route without a live plan. Sending them to the pricing site to
 * start again was the wrong end of the problem: they are already at the one
 * screen that knows which account is stuck, and they have just proved they own
 * it. So the plans are shown here, and `POST /signup/resume` opens a checkout
 * against that same account with the password they typed a moment ago.
 *
 * The credentials are held only in the caller's state for the life of this
 * screen — the server re-checks them, and a page reload asks for them again.
 */
export function ActivateAccountPanel({
  email,
  password,
  message,
  onCancel,
}: {
  email: string;
  password: string;
  /** Why the account was refused — the server's own words, which say which case it is. */
  message: string;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const { open, busy, error } = useCashfreeCheckout();

  const plansQ = useQuery({ queryKey: ['signup', 'plans'], queryFn: signupApi.plans, retry: 1 });
  const plans = plansQ.data ?? [];
  // One plan on sale is a choice already made.
  const plan = plans.find((p) => p.code === chosen) ?? (plans.length === 1 ? plans[0] : null);

  // Cashfree brings the doctor back to /login?order_id=…, which this screen
  // then polls through useSignupOrderWatch above.
  const pay = () =>
    plan &&
    open(() => signupApi.resume({ email, password, plan: plan.code, origin: 'app' }));

  return (
    <div className="activate">
      <p className="err activate-lead">{message}</p>

      {plansQ.isLoading ? (
        <Spinner />
      ) : plansQ.isError || plans.length === 0 ? (
        <p className="muted activate-note">
          No plans are on sale right now. Please contact the myDigitalOPD team to have your account
          activated.
        </p>
      ) : (
        <>
          <div className="renew-plans is-stacked">
            {plans.map((p: Plan) => (
              <button
                key={p.id}
                type="button"
                className={`renew-plan ${plan?.code === p.code ? 'is-chosen' : ''}`}
                onClick={() => setChosen(p.code)}
                aria-pressed={plan?.code === p.code}
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

          {error && <p className="err activate-note">{error}</p>}

          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
            disabled={!plan || busy}
            onClick={() => void pay()}
          >
            {busy ? 'Opening payment…' : plan ? `Pay ${inr(plan.price.total)}` : 'Choose a plan'}
          </button>

          <p className="muted activate-note">
            Activating <strong>{email}</strong>. The receipt and the tax invoice are emailed to you,
            and your account is live as soon as the payment lands.
          </p>
        </>
      )}

      <button type="button" className="link-btn activate-back" onClick={onCancel}>
        Use a different account
      </button>
    </div>
  );
}
