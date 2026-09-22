import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, Loader2, RotateCw } from 'lucide-react';
import { Logo } from '../components/Brand';
import { ApiError, signupApi, type OrderStatus } from '../api';
import { AppConfig } from '../config';
import { inr } from '../plans';

/** Long enough for a bank redirect to settle, short enough that nobody waits forever. */
const POLL_MS = 2500;
const GIVE_UP_AFTER_MS = 90_000;

/**
 * Where Cashfree sends the doctor back. The order id is the only thing that
 * survives the redirect, so everything on this page is read from the server:
 * a browser that came back "successful" proves nothing until the API says
 * the payment settled.
 *
 * `pending` is polled — the webhook usually lands first, and the status call
 * re-checks the order with Cashfree anyway, so a webhook that never arrives
 * cannot strand a doctor who has paid.
 */
export default function SignupDone() {
  const [params] = useSearchParams();
  const orderId = params.get('order_id');
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (!orderId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await signupApi.orderStatus(orderId);
        if (!live) return;
        setStatus(res);
        setError(null);
        if (res.status === 'pending') {
          if (Date.now() - startedAt.current > GIVE_UP_AFTER_MS) setTimedOut(true);
          else timer = setTimeout(tick, POLL_MS);
        }
      } catch (e) {
        if (!live) return;
        setError(e instanceof ApiError ? e.message : 'Could not check the payment.');
        timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [orderId]);

  // The server names the plan, so a plan retired since the payment still reads correctly.
  const planName = status?.planName ?? status?.plan ?? '';
  const loginUrl = status?.loginUrl ?? AppConfig.links.doctorLogin;

  return (
    <div className="signup-page">
      <header className="signup-header">
        <div className="container signup-header-row">
          <Link to="/" className="site-logo" aria-label="myDigitalOPD home">
            <Logo size={32} />
          </Link>
        </div>
      </header>

      <main className="container result-wrap">
        {!orderId ? (
          <section className="card result-card">
            <span className="result-icon result-icon--bad">
              <AlertCircle size={28} />
            </span>
            <h1>We could not find that payment</h1>
            <p className="muted">
              This page opens after a payment. If you were charged, check your email for the
              receipt, or start again from the plans.
            </p>
            <Link to="/#pricing" className="btn btn-primary btn-lg">
              See plans <ArrowRight size={18} />
            </Link>
          </section>
        ) : status?.status === 'active' ? (
          <section className="card result-card">
            <span className="result-icon result-icon--good">
              <Check size={28} />
            </span>
            <h1>Payment received</h1>
            <p className="muted">
              Your <strong>{planName}</strong> plan is active
              {status.endsAt &&
                ` until ${new Date(status.endsAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}`}
              . We emailed a receipt to <strong>{status.email}</strong>.
            </p>
            <ol className="next-steps">
              <li>Sign in with the email and password you just chose.</li>
              <li>Tell us about your practice — name, registration number, timings.</li>
              <li>Share your booking link and start taking appointments.</li>
            </ol>
            <a href={loginUrl} className="btn btn-primary btn-lg">
              Sign in to myDigitalOPD <ArrowRight size={18} />
            </a>
          </section>
        ) : status && (status.status === 'failed' || status.status === 'expired' || status.status === 'cancelled') ? (
          <section className="card result-card">
            <span className="result-icon result-icon--bad">
              <AlertCircle size={28} />
            </span>
            <h1>That payment did not go through</h1>
            <p className="muted">
              Nothing was charged for {inr(status.total)}. Your account is saved — pick the plan
              again and sign in with the same email and password to retry.
            </p>
            <Link to={`/signup?plan=${status.plan}`} className="btn btn-primary btn-lg">
              Try the payment again <RotateCw size={18} />
            </Link>
          </section>
        ) : timedOut ? (
          <section className="card result-card">
            <span className="result-icon result-icon--wait">
              <Loader2 size={28} />
            </span>
            <h1>Still waiting on your bank</h1>
            <p className="muted">
              The payment has not been confirmed yet. If money left your account it will show up
              shortly and we will email you — you do not need to pay again.
            </p>
            <button
              type="button"
              className="btn btn-outline btn-lg"
              onClick={() => window.location.reload()}
            >
              Check again <RotateCw size={18} />
            </button>
          </section>
        ) : (
          <section className="card result-card">
            <span className="result-icon result-icon--wait">
              <Loader2 size={28} className="spin" />
            </span>
            <h1>Confirming your payment…</h1>
            <p className="muted">
              {error ?? 'This takes a few seconds. Please do not close this page.'}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
