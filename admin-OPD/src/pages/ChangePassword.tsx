import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Field, PasswordInput } from '../components/ui';
import { LogoFull, PoweredByIttitude } from '../components/Brand';

/**
 * The first screen after signing in with a password somebody else chose.
 *
 * Not a suggestion: the API refuses every other route while the flag is set,
 * so this is the only place the session can go. That is the point — a password
 * that travelled through an inbox in plain text is the one credential on a
 * brand-new account, and leaving it in place because a doctor clicked past a
 * prompt is exactly the outcome worth preventing.
 *
 * The current password is prefilled when the doctor arrives straight from the
 * sign-in form, which passes what was just typed through router state. It is
 * never stored anywhere — a reload empties the field and the doctor types it
 * again from the email.
 */
export default function ChangePassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, passwordChanged, logout } = useAuth();

  const handedOver = (location.state as { current?: string } | null)?.current ?? '';
  const [current, setCurrent] = useState(handedOver);
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current.length > 0 && next.length >= 8 && next === confirm && next !== current;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await authApi.changePassword(current, next);
      passwordChanged();
      // Wherever they were headed — the profile form for a new clinic, the
      // dashboard for an existing one — Home works it out.
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not change the password. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="card login-card">
        <LogoFull markSize={52} className="login-lockup" />

        <form onSubmit={save}>
          <p className="muted" style={{ marginTop: 18, marginBottom: 24 }}>
            Welcome{user?.name ? `, ${user.name}` : ''}. Your account was opened with a temporary
            password. Choose your own to continue.
          </p>

          <Field label="Temporary password">
            <PasswordInput
              autoComplete="current-password"
              placeholder="The one from your email"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>

          <Field label="New password">
            <PasswordInput
              placeholder="At least 8 characters"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>

          <Field label="Confirm new password">
            <PasswordInput
              placeholder="Type it again"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>

          {mismatch && (
            <div className="err" style={{ marginBottom: 12, textAlign: 'left' }}>
              Both passwords must match.
            </div>
          )}
          {next.length > 0 && next === current && (
            <div className="err" style={{ marginBottom: 12, textAlign: 'left' }}>
              Please choose something other than the temporary password.
            </div>
          )}
          {error && (
            <div className="err" style={{ marginBottom: 12, textAlign: 'left' }}>
              {error}
            </div>
          )}

          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={!ready || busy}
          >
            {busy ? 'Saving…' : 'Set my password'}
          </button>
        </form>

        <div className="muted" style={{ marginTop: 16, fontSize: 13, textAlign: 'center' }}>
          <button className="btn btn-sm btn-ghost" onClick={logout} type="button">
            Sign out
          </button>
        </div>

        <PoweredByIttitude className="auth-powered-by" />
      </div>
    </div>
  );
}
