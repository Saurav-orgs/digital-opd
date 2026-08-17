import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Phone, User, LogIn, UserPlus } from 'lucide-react';
import { usePatientAuth } from '../../auth/PatientAuthContext';
import { ApiException } from '../../types';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register } = usePatientAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from || '/visits';

  const mobileValid = /^[6-9]\d{9}$/.test(mobile.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!mobileValid) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    if (mode === 'register' && name.trim().length < 2) {
      setError('Please enter your name.');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(mobile.trim());
      } else {
        await register(mobile.trim(), name.trim());
      }
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiException) {
        if (err.code === 'PATIENT_NOT_FOUND') {
          setMode('register');
          setError('No account found. Please enter your name to register.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '440px', margin: '40px auto' }}>
      <div className="section-card">
        <h2 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: 800, color: 'var(--text)' }}>
          {mode === 'login' ? 'Login to your account' : 'Create your account'}
        </h2>
        <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
          {mode === 'login'
            ? 'Use the mobile number you booked your OPD appointment with.'
            : "We didn't find an account for this number — enter your name to register."}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="form-label icon-label">
              <Phone size={14} color="var(--text-secondary)" />
              <span>Mobile Number</span>
            </label>
            <input
              type="tel"
              className="form-input"
              placeholder="10-digit mobile number"
              maxLength={10}
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
            />
          </div>

          {mode === 'register' && (
            <div className="form-field">
              <label className="form-label icon-label">
                <User size={14} color="var(--text-secondary)" />
                <span>Full Name</span>
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Enter your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          {error && <div className="error-text" style={{ marginBottom: '12px' }}>{error}</div>}

          <button type="submit" className="btn-primary" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? (
              <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2.5px' }} />
            ) : mode === 'login' ? (
              <>
                <LogIn size={18} />
                <span>Login</span>
              </>
            ) : (
              <>
                <UserPlus size={18} />
                <span>Register</span>
              </>
            )}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '13.5px', color: 'var(--text-secondary)' }}>
          {mode === 'login' ? (
            <>
              New here?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('register'); setError(null); }}>
                Register instead
              </a>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); setError(null); }}>
                Login instead
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
