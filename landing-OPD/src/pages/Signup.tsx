import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { load } from '@cashfreepayments/cashfree-js';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, Lock } from 'lucide-react';
import { Logo } from '../components/Brand';
import { Field, PasswordField } from '../components/Field';
import { OrderSummary } from '../components/OrderSummary';
import { ApiError, signupApi, type CheckoutSession } from '../api';
import { findPlan } from '../plans';
import { usePlans } from '../usePlans';

const STEPS = ['Plan', 'Account', 'Verify email', 'Payment'] as const;
type Step = 0 | 1 | 2 | 3;

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * The paid sign-up: the plan comes in on the query string, then credentials,
 * then the code that proves the address, then Cashfree's checkout.
 *
 * The account is created at the end of step 2 rather than after payment, so
 * the password the doctor typed is never carried around the payment round
 * trip — the server holds it, and Cashfree returns us to an order id.
 * A doctor who abandons the checkout comes back through "Already started?",
 * which opens a new order against the account that already exists.
 */
export default function Signup() {
  const [params] = useSearchParams();
  const { plans, error: plansError, loading: plansLoading } = usePlans();
  const plan = plans ? findPlan(plans, params.get('plan')) : undefined;

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState({ email: '', password: '', confirm: '', mobile: '' });
  const [code, setCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState<null | 'code' | 'verify' | 'pay'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Set when the email is already taken: offer to resume instead of starting over. */
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // The SDK is fetched once, lazily — it is only needed if the doctor pays.
  const cashfree = useRef<Awaited<ReturnType<typeof load>> | null>(null);

  const email = form.email.trim().toLowerCase();
  const mobile = form.mobile.trim();
  const accountValid =
    EMAIL_RE.test(email) &&
    form.password.length >= 8 &&
    form.password === form.confirm &&
    MOBILE_RE.test(mobile);

  const mismatch = form.confirm.length > 0 && form.password !== form.confirm;

  const stepState = useMemo(
    () =>
      STEPS.map((label, i) => ({
        label,
        state: i < step ? 'done' : i === step ? 'current' : 'todo',
      })),
    [step],
  );

  // The plan list is the server's, so it arrives a moment after the page. A
  // code that is not on it (retired, or mistyped in a shared link) sends the
  // visitor back to the pricing section to pick again.
  if (plansLoading) {
    return (
      <div className="signup-page">
        <main className="container result-wrap">
          <p className="plans-state" role="status">
            <Loader2 size={20} className="spin" aria-hidden="true" /> Loading your plan…
          </p>
        </main>
      </div>
    );
  }
  if (plansError || !plan) return <Navigate to="/#pricing" replace />;

  const fail = (e: unknown, fallback: string) =>
    setError(e instanceof ApiError ? e.message : fallback);

  const sendCode = async () => {
    setBusy('code');
    setError(null);
    setNotice(null);
    try {
      const res = await signupApi.sendEmailCode(email);
      setCodeSentTo(email);
      setCode('');
      setResendIn(res.resendAfter);
      setStep(2);
      setNotice(`We sent a 6-digit code to ${email}.`);
    } catch (e) {
      // "Already registered" is not a dead end — it is the doctor who closed
      // the checkout tab last time, so offer the way back in.
      if (e instanceof ApiError && e.code === 'CONFLICT') setResuming(true);
      fail(e, 'Could not send the code. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  /** Hand the session to Cashfree's hosted checkout. */
  const openCheckout = async (session: CheckoutSession) => {
    cashfree.current ??= await load({ mode: session.env });
    if (!cashfree.current) throw new Error('checkout unavailable');
    await cashfree.current.checkout({
      paymentSessionId: session.paymentSessionId,
      redirectTarget: '_self',
    });
  };

  const verifyAndPay = async () => {
    if (!codeSentTo) return;
    setBusy('verify');
    setError(null);
    try {
      await signupApi.confirmEmailCode(codeSentTo, code.trim());
      setStep(3);
      setBusy('pay');
      const session = await signupApi.createAccount({
        email: codeSentTo,
        password: form.password,
        mobile,
        plan: plan.code,
      });
      await openCheckout(session);
    } catch (e) {
      setStep(2);
      fail(e, 'That code did not work. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const resume = async () => {
    setBusy('pay');
    setError(null);
    try {
      const session = await signupApi.resume({
        email,
        password: form.password,
        mobile,
        plan: plan.code,
      });
      setStep(3);
      await openCheckout(session);
    } catch (e) {
      fail(e, 'Could not reopen the payment. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="signup-page">
      <header className="signup-header">
        <div className="container signup-header-row">
          <Link to="/" className="site-logo" aria-label="myDigitalOPD home">
            <Logo size={32} />
          </Link>
          <Link to="/#pricing" className="btn btn-ghost">
            <ArrowLeft size={16} /> Change plan
          </Link>
        </div>
      </header>

      <main className="container signup-grid">
        <section className="card signup-main">
          <ol className="stepper" aria-label="Sign-up progress">
            {stepState.map((s, i) => (
              <li
                key={s.label}
                className={s.state === 'done' ? 'is-done' : s.state === 'current' ? 'is-current' : ''}
              >
                <span className="stepper-dot" aria-hidden="true">
                  {s.state === 'done' ? <Check size={14} /> : i + 1}
                </span>
                <span className="stepper-label">{s.label}</span>
              </li>
            ))}
          </ol>

          {error && (
            <p className="alert alert-error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </p>
          )}
          {notice && !error && (
            <p className="alert alert-ok" role="status">
              <Check size={18} aria-hidden="true" />
              <span>{notice}</span>
            </p>
          )}

          {resuming ? (
            <>
              <h1>You already have an account</h1>
              <p className="muted">
                Sign in with your password to pay for the {plan.name.toLowerCase()} plan and
                finish setting up.
              </p>
              <div className="form-grid">
                <Field label="Email" value={form.email} disabled readOnly />
                <PasswordField
                  label="Password"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
                <Field
                  label="Mobile number"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={10}
                  hint="Used for the payment receipt."
                  value={form.mobile}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, mobile: e.target.value.replace(/\D/g, '') }))
                  }
                />
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setResuming(false);
                    setError(null);
                  }}
                >
                  Use another email
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  disabled={!form.password || !MOBILE_RE.test(mobile) || busy !== null}
                  onClick={resume}
                >
                  {busy === 'pay' ? <Loader2 size={18} className="spin" /> : <Lock size={18} />}
                  Continue to payment
                </button>
              </div>
            </>
          ) : step === 1 ? (
            <>
              <h1>Create your doctor account</h1>
              <p className="muted">
                This is what you will sign in with. Your practice details come after payment.
              </p>
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (accountValid) void sendCode();
                }}
              >
                <Field
                  label="Email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@clinic.com"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
                <Field
                  label="Mobile number"
                  inputMode="numeric"
                  autoComplete="tel"
                  maxLength={10}
                  placeholder="10-digit number"
                  hint="For the payment receipt and account recovery."
                  value={form.mobile}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, mobile: e.target.value.replace(/\D/g, '') }))
                  }
                />
                <PasswordField
                  label="Password"
                  autoComplete="new-password"
                  hint="At least 8 characters."
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
                <PasswordField
                  label="Confirm password"
                  autoComplete="new-password"
                  error={mismatch ? 'Both passwords must match.' : null}
                  value={form.confirm}
                  onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
                />
                <div className="form-actions">
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg"
                    disabled={!accountValid || busy !== null}
                  >
                    {busy === 'code' ? (
                      <Loader2 size={18} className="spin" />
                    ) : (
                      <ArrowRight size={18} />
                    )}
                    Send verification code
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <h1>Verify your email</h1>
              <p className="muted">
                Enter the 6-digit code we sent to <strong>{codeSentTo}</strong>. Paying comes
                next.
              </p>
              <form
                className="form-grid"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.trim().length === 6) void verifyAndPay();
                }}
              >
                <Field
                  label="Verification code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  className="input code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={resendIn > 0 || busy !== null}
                    onClick={sendCode}
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg"
                    disabled={code.trim().length !== 6 || busy !== null}
                  >
                    {busy ? <Loader2 size={18} className="spin" /> : <Lock size={18} />}
                    {busy === 'pay' ? 'Opening checkout…' : 'Verify & pay'}
                  </button>
                </div>
              </form>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setStep(1);
                  setError(null);
                  setNotice(null);
                }}
              >
                Change email or password
              </button>
            </>
          )}

          <p className="pay-note">
            <Lock size={14} aria-hidden="true" /> Payment is handled by Cashfree. We never see
            your card details.
          </p>
        </section>

        <OrderSummary plan={plan} allPlans={plans ?? []} />
      </main>
    </div>
  );
}
