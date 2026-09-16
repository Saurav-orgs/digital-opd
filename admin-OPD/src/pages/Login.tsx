import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Field, PasswordInput } from '../components/ui';
import { LogoFull, PoweredByIttitude } from '../components/Brand';

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) navigate('/', { replace: true });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="card login-card">
        {/* The login screen is the one place the full lockup is shown; every
            other surface uses the mark on its own. */}
        <LogoFull markSize={52} className="login-lockup" />
        <p className="muted" style={{ marginTop: 18, marginBottom: 24 }}>
          Sign in to manage doctors, schedules and appointments.
        </p>
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
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <div className="muted" style={{ marginTop: 16, fontSize: 13, textAlign: 'center' }}>
            New here? <Link to="/register">Register your practice</Link>
          </div>
        </form>
        <PoweredByIttitude className="auth-powered-by" />
      </div>
    </div>
  );
}
