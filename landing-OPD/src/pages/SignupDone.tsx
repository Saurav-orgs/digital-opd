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
  // The server could not be reached after several tries. Kept apart from a
  // settled `failed` status: this is "we could not ask", not "the bank said
  // no", and it almost always means the landing's `apiBaseUrl` does not point
  // at the running backend. Without this the page retried a dead host forever,
  // showing nothing but the confirming spinner — the "stuck on /signup/done"
  // everyone hit when the API tunnel had moved.
  const [unreachable, setUnreachable] = useState(false);
  const startedAt = useRef(Date.now());
  const failures = useRef(0);

  /** How many failed polls before we stop and say the server is unreachable. */
  const MAX_FAILURES = 5;

  useEffect(() => {
    if (!orderId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await signupApi.orderStatus(orderId);
        if (!live) return;
        failures.current = 0;
        setStatus(res);
        setError(null);
        if (res.status === 'pending') {
          if (Date.now() - startedAt.current > GIVE_UP_AFTER_MS) setTimedOut(true);
          else timer = setTimeout(tick, POLL_MS);
        }
      } catch (e) {
        if (!live) return;
        failures.current += 1;
        setError(e instanceof ApiError ? e.message : 'Could not check the payment.');
        if (failures.current >= MAX_FAILURES) setUnreachable(true);
        else timer = setTimeout(tick, POLL_MS * 2);
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
  // Where the doctor signs in after paying is the landing's own call, not the
  // API's: the backend builds its `loginUrl` from its own `adminBase` env,
  // which on a tunnel or dev host points at the wrong origin. `config.ts` is the
  // one place this landing records the admin app's address (`doctorLogin`), so
  // that is what we send them to.
  const loginUrl = AppConfig.links.doctorLogin;

  // Once the payment is confirmed, take the doctor to the panel rather than
  // leaving them on this page to find the button. The short pause lets them see
  // "Payment received" and the invoice note first; the button below is there
  // for anyone who wants to go immediately, or if the redirect is blocked.
  const REDIRECT_AFTER_MS = 3500;
  const [redirecting, setRedirecting] = useState(false);
  useEffect(() => {
    if (status?.status !== 'active') return;
    setRedirecting(true);
    const t = setTimeout(() => {
      window.location.href = loginUrl;
    }, REDIRECT_AFTER_MS);
    return () => clearTimeout(t);
  }, [status?.status, loginUrl]);

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
              . We emailed your invoice to <strong>{status.email}</strong>; it is also in
              Billing inside your account.
            </p>
            <ol className="next-steps">
              <li>Sign in with the email and password you just chose.</li>
              <li>Tell us about your practice: name, registration number, timings.</li>
              <li>Share your booking link and start taking appointments.</li>
            </ol>
            {redirecting && (
              <p className="muted" aria-live="polite">
                Taking you to sign in…
              </p>
            )}
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
              Nothing was charged for {inr(status.total)}. Pick the plan again and sign up with
              the same email to retry.
            </p>
            <Link to={`/signup?plan=${status.plan}`} className="btn btn-primary btn-lg">
              Try the payment again <RotateCw size={18} />
            </Link>
          </section>
        ) : unreachable ? (
          <section className="card result-card">
            <span className="result-icon result-icon--bad">
              <AlertCircle size={28} />
            </span>
            <h1>We could not confirm your payment</h1>
            <p className="muted">
              {error ?? 'The server could not be reached.'} If money left your
              account, nothing is lost. Your plan activates once the payment
              settles, and you can sign in then. You can also try again.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-outline btn-lg"
                onClick={() => window.location.reload()}
              >
                Check again <RotateCw size={18} />
              </button>
              <a href={loginUrl} className="btn btn-primary btn-lg">
                Sign in to myDigitalOPD <ArrowRight size={18} />
              </a>
            </div>
          </section>
        ) : timedOut ? (
          <section className="card result-card">
            <span className="result-icon result-icon--wait">
              <Loader2 size={28} />
            </span>
            <h1>Still waiting on your bank</h1>
            <p className="muted">
              The payment has not been confirmed yet. If money left your account it will show up
              shortly and we will email you. You do not need to pay again.
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
