import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError, lockoutStore } from '../api/client';
import { Field, PasswordInput } from '../components/ui';
import { LogoFull, PoweredByIttitude } from '../components/Brand';
import {
  ActivateAccountPanel,
  longDate,
  useSignupOrderWatch,
} from '../components/ActivateAccountPanel';

/**
 * The account behind a `SUBSCRIPTION_REQUIRED` refusal, and the credentials it
 * was refused with.
 *
 * Held here rather than read back off the form, so that editing the fields
 * afterwards cannot point the checkout at a different account than the one the
 * message is about. Nothing is stored: a reload clears it.
 */
interface Locked {
  email: string;
  password: string;
  message: string;
}

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [locked, setLocked] = useState<Locked | null>(null);
  const [busy, setBusy] = useState(false);

  // Cashfree appends ?order_id= when it sends a doctor back here from the
  // activation checkout. Everything shown about it comes from the server: a
  // browser that came back "successful" proves nothing until the API agrees.
  const orderId = params.get('order_id');
  const { status: order, timedOut, unknown: unknownOrder } = useSignupOrderWatch(orderId);

  // A session the server ended because the plan ran out lands here with its
  // reason, so the doctor is not left looking at a login form wondering what
  // happened. Read once — a reason shown is not shown again.
  useEffect(() => {
    const lockout = lockoutStore.take();
    if (lockout) setError(lockout.message);
  }, []);

  // The payment settled while they were away, so the address is known and the
  // only thing left to type is the password.
  useEffect(() => {
    if (order?.email) setEmail((current) => current || order.email);
  }, [order?.email]);

  if (user) navigate('/', { replace: true });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const signedIn = await login(email, password);
      // An account on a mailed password goes straight to the change form, and
      // carries what was just typed so it need not be copied out of the email
      // a second time. Router state only — nothing is stored.
      if (signedIn.mustChangePassword) {
        navigate('/change-password', { replace: true, state: { current: password } });
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;
      // A doctor refused for want of a plan is not sent anywhere: the password
      // they just typed is proof enough for `/signup/resume`, so the plans and
      // the checkout appear right here. Staff of a lapsed clinic get the
      // message alone — the plan is not theirs to buy, and the server would
      // refuse them.
      const canSubscribe =
        apiErr?.code === 'SUBSCRIPTION_REQUIRED' &&
        (apiErr.details as { canSubscribe?: boolean } | undefined)?.canSubscribe === true;
      if (canSubscribe) {
        setLocked({ email, password, message: apiErr!.message });
        // The result of an older payment has nothing to say about this refusal.
        if (orderId) setParams({}, { replace: true });
        return;
      }
      setError(apiErr ? apiErr.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  /** The banner for the checkout Cashfree has just returned from. */
  const orderNote = !orderId || unknownOrder ? null : order?.status === 'active' ? (
    <div className="renew-result is-good" role="status">
      <span>
        Payment received. Your <strong>{order.planName}</strong> plan runs until{' '}
        <strong>{longDate(order.endsAt)}</strong>. Sign in to continue — the invoice is on its way
        to your email.
      </span>
    </div>
  ) : order && order.status !== 'pending' ? (
    <div className="renew-result is-bad" role="status">
      <span>
        That payment did not go through, and nothing was charged. Sign in again to choose a plan.
      </span>
    </div>
  ) : timedOut ? (
    <div className="renew-result is-waiting" role="status">
      <span>
        The bank has not confirmed this payment yet. Nothing is lost — try signing in again in a few
        minutes, and get in touch if it still says this.
      </span>
    </div>
  ) : (
    <div className="renew-result is-waiting" role="status">
      <span>Checking the payment with your bank…</span>
    </div>
  );

  return (
    <div className="auth-screen">
      <div className={`card login-card ${locked ? 'is-wide' : ''}`}>
        {/* The login screen is the one place the full lockup is shown; every
            other surface uses the mark on its own. */}
        <LogoFull markSize={52} className="login-lockup" />

        {locked ? (
          <ActivateAccountPanel
            email={locked.email}
            password={locked.password}
            message={locked.message}
            onCancel={() => {
              setLocked(null);
              setPassword('');
            }}
          />
        ) : (
          <>
            <p className="muted" style={{ marginTop: 18, marginBottom: 24 }}>
              Sign in to manage doctors, schedules and appointments.
            </p>
            {orderNote}
            <form onSubmit={onSubmit}>
              <Field label="Email">
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  required
                />
              </Field>
              <Field label="Password">
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
              <div className="login-forgot">
                <Link className="link-btn" to="/forgot-password">
                  Forgot password?
                </Link>
              </div>
              {error && (
                <div className="err" style={{ marginBottom: 12, textAlign: 'left' }}>
                  {error}
                </div>
              )}
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                disabled={busy}
              >
                {busy ? 'Signing in…' : 'Sign in'}
              </button>

              <div className="muted" style={{ marginTop: 16, fontSize: 13, textAlign: 'center' }}>
                New here? <Link to="/register">Register your practice</Link>
              </div>
            </form>
          </>
        )}
        <PoweredByIttitude className="auth-powered-by" />
      </div>
    </div>
  );
}
