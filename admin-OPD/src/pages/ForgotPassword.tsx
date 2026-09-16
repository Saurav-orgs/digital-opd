import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { Field, PasswordInput } from '../components/ui';
import { LogoFull, PoweredByIttitude } from '../components/Brand';

type Step = 'email' | 'code' | 'password' | 'done';

/**
 * "I forgot my password" — the admin side, in three short steps on one
 * screen: the email, the code it was sent, the new password.
 *
 * The first step answers the same way whether or not the address has an
 * account — saying "no such account" would turn the form into a way to
 * check who has signed up. The code is checked on its own before the
 * password is asked for, so a mistyped code never costs the doctor the
 * password they just typed twice.
 */
export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiError ? err.message : fallback);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await authApi.forgotPassword(email.trim());
      setResendIn(res.resendAfter);
      setCode('');
      setStep('code');
    } catch (err) {
      fail(err, 'Could not send the code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await authApi.verifyResetCode(email.trim(), code);
      setToken(res.token);
      setStep('password');
    } catch (err) {
      fail(err, 'That code did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await authApi.resetPassword(token, password);
      setStep('done');
    } catch (err) {
      fail(err, 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  }

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <div className="auth-screen">
      <div className="card login-card">
        <LogoFull markSize={52} className="login-lockup" />

        {step === 'email' && (
          <form onSubmit={sendCode}>
            <p className="muted" style={{ marginTop: 18, marginBottom: 24 }}>
              Enter the email you sign in with and we will send you a code to
              choose a new password.
            </p>
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
            {error && <div className="err" style={{ marginBottom: 12, textAlign: 'left' }}>{error}</div>}
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verify}>
            <h2 style={{ margin: '18px 0 6px' }}>Check your email</h2>
            <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 16 }}>
              If <strong>{email.trim()}</strong> has an account, a 6-digit code is
              on its way. It expires in 10 minutes.
            </p>
            <Field label="Code">
              <input
                className="input verify-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                autoFocus
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError('');
                }}
              />
            </Field>
            {error && <div className="err" style={{ marginBottom: 12, textAlign: 'left' }}>{error}</div>}
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={busy || code.length !== 6}
            >
              {busy ? 'Checking…' : 'Verify code'}
            </button>
            <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || resendIn > 0}
                onClick={() => void sendCode()}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setStep('email');
                  setError('');
                }}
              >
                Change email
              </button>
            </div>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={save}>
            <p className="muted" style={{ marginTop: 18, marginBottom: 24 }}>
              Code accepted. Choose a new password for <strong>{email.trim()}</strong>.
            </p>
            <Field label="New password" error={tooShort ? 'Password must be at least 8 characters.' : undefined}>
              <PasswordInput
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
              />
            </Field>
            <Field label="Confirm new password" error={mismatch ? 'Passwords do not match.' : undefined}>
              <PasswordInput
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            {error && <div className="err" style={{ marginBottom: 12, textAlign: 'left' }}>{error}</div>}
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={busy || password.length < 8 || confirm !== password}
            >
              {busy ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}

        {step === 'done' && (
          <>
            <h2 style={{ margin: '18px 0 8px' }}>Password changed ✓</h2>
            <p className="muted" style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              Sign in with your new password.
            </p>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => navigate('/login')}>
              Sign in
            </button>
          </>
        )}

        {step !== 'done' && (
          <div className="muted" style={{ marginTop: 16, fontSize: 13, textAlign: 'center' }}>
            <Link to="/login">Back to sign in</Link>
          </div>
        )}
        <PoweredByIttitude className="auth-powered-by" />
      </div>
    </div>
  );
}
