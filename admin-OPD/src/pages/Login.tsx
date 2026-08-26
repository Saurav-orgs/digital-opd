import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Field } from '../components/ui';

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgotNote, setForgotNote] = useState(false);

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
        <div className="login-logo">+</div>
        <h1 style={{ fontSize: 20, marginBottom: 2 }}>Digital OPD Admin</h1>
        <div
          className="muted"
          style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: 0.4, textTransform: 'uppercase' }}
        >
          by Ittitude
        </div>
        <p className="muted" style={{ marginTop: 10, marginBottom: 24 }}>
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
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <div className="login-forgot">
            <button type="button" className="link-btn" onClick={() => setForgotNote(true)}>
              Forgot password?
            </button>
          </div>
          {forgotNote && (
            <div className="muted login-forgot-note">
              Password reset is coming soon. For now, please contact your system administrator to
              reset your password.
            </div>
          )}
          {error && (
            <div className="err" style={{ marginBottom: 12, textAlign: 'left' }}>
              {error}
            </div>
          )}
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
