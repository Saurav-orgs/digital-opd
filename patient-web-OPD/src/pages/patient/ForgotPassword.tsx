import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, MessageCircle, Phone, ShieldCheck } from 'lucide-react';
import { PasswordField } from '../../components/PasswordField';
import { patientApi } from '../../patientApi';
import { ApiException } from '../../types';

type Step = 'mobile' | 'code' | 'password' | 'done';

/**
 * "I forgot my password", for a patient.
 *
 * Three short steps on one screen: the number, the code sent to it, the new
 * password. Over WhatsApp rather than email because a patient account *is* a
 * mobile number — nothing on this side ever collects an address — and the
 * sign-up code already travels the same way, so the patient is being asked for
 * something they have done before.
 *
 * The first step answers the same whether or not the number has an account.
 * Saying "no such account" would turn this form into a way of finding out who
 * is registered, and a patient who mistypes their own number is better served
 * by "check the number" than by a screen that confirms strangers' numbers.
 */
export function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('mobile');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const mobileValid = /^[6-9]\d{9}$/.test(mobile.trim());

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ApiException ? err.message : fallback);

  /** Count the resend cooldown down to zero, one second at a time. */
  const startCountdown = (seconds: number) => {
    setResendIn(seconds);
    const timer = window.setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const sendCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await patientApi.forgotPassword(mobile.trim());
      startCountdown(res.resendAfter);
      setCode('');
      setStep('code');
    } catch (err) {
      fail(err, 'Could not send the code. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await patientApi.verifyResetCode(mobile.trim(), code);
      setToken(res.token);
      setStep('password');
    } catch (err) {
      fail(err, 'That code did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await patientApi.resetPassword(token, password);
      setStep('done');
    } catch (err) {
      fail(err, 'Could not change the password.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (step === 'mobile') {
      if (!mobileValid) return setError('Enter a valid 10-digit mobile number.');
      return void sendCode();
    }
    if (step === 'code') return void verify();
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    return void save();
  };

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <div style={{ maxWidth: '440px', margin: '40px auto' }}>
      <div className="section-card">
        <h2 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: 800, color: 'var(--text)' }}>
          {step === 'done' ? 'Password changed' : 'Reset your password'}
        </h2>
        <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
          {step === 'mobile'
            ? 'Enter the mobile number you log in with. We will send a code on WhatsApp.'
            : step === 'code'
              ? 'Type the code we sent on WhatsApp.'
              : step === 'password'
                ? 'Choose a new password for your account.'
                : 'You can now log in with your new password.'}
        </p>

        {step === 'done' ? (
          <button
            type="button"
            className="btn-primary"
            style={{ width: '100%' }}
            onClick={() => navigate('/login')}
          >
            <span>Go to login</span>
          </button>
        ) : (
          <form onSubmit={submit}>
            <div className="form-field">
              <label className="form-label icon-label">
                <Phone size={14} color="var(--text-secondary)" />
                <span>Mobile Number *</span>
              </label>
              <input
                type="tel"
                className="form-input"
                placeholder="10-digit mobile number"
                maxLength={10}
                value={mobile}
                readOnly={step !== 'mobile'}
                autoFocus={step === 'mobile'}
                onChange={(e) => {
                  setMobile(e.target.value.replace(/\D/g, ''));
                  setError(null);
                }}
              />
            </div>

            {step === 'code' && (
              <>
                <p
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    marginTop: -4,
                  }}
                >
                  <MessageCircle
                    size={16}
                    color="#25D366"
                    style={{ flexShrink: 0, marginTop: 1 }}
                  />
                  {/*
                    "If this number has an account" rather than "we sent it":
                    the server answers the same either way, and this line is
                    where that shows. It also tells a patient who mistyped
                    their number why no message arrived.
                  */}
                  <span>
                    If <strong>+91 {mobile.trim()}</strong> has an account, a 6-digit code is
                    on its way on WhatsApp. It is valid for 10 minutes.
                  </span>
                </p>
                <div className="form-field">
                  <label className="form-label">Verification code *</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="form-input"
                    placeholder="000000"
                    autoFocus
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setError(null);
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 13.5 }}>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy || resendIn > 0}
                    onClick={() => void sendCode()}
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                  </button>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setStep('mobile');
                      setError(null);
                    }}
                  >
                    Change number
                  </button>
                </div>
              </>
            )}

            {step === 'password' && (
              <>
                <div className="form-field">
                  <label className="form-label icon-label">
                    <Lock size={14} color="var(--text-secondary)" />
                    <span>New password *</span>
                  </label>
                  <PasswordField
                    placeholder="At least 8 characters"
                    value={password}
                    autoFocus
                    onChange={(v) => {
                      setPassword(v);
                      setError(null);
                    }}
                  />
                  {tooShort && (
                    <span className="error-text">Password must be at least 8 characters.</span>
                  )}
                </div>
                <div className="form-field">
                  <label className="form-label icon-label">
                    <Lock size={14} color="var(--text-secondary)" />
                    <span>Confirm new password *</span>
                  </label>
                  <PasswordField
                    placeholder="Re-enter your password"
                    value={confirm}
                    onChange={(v) => {
                      setConfirm(v);
                      setError(null);
                    }}
                  />
                  {mismatch && <span className="error-text">Passwords do not match.</span>}
                </div>
              </>
            )}

            {error && <div className="error-text" style={{ marginBottom: '12px' }}>{error}</div>}

            <button type="submit" className="btn-primary" disabled={busy} style={{ width: '100%' }}>
              {busy ? (
                <div className="spinner" style={{ width: '20px', height: '20px', borderWidth: '2.5px' }} />
              ) : step === 'mobile' ? (
                <>
                  <MessageCircle size={18} />
                  <span>Send code on WhatsApp</span>
                </>
              ) : step === 'code' ? (
                <>
                  <ShieldCheck size={18} />
                  <span>Verify code</span>
                </>
              ) : (
                <>
                  <Lock size={18} />
                  <span>Set new password</span>
                </>
              )}
            </button>
          </form>
        )}

        {step !== 'done' && (
          <div
            style={{
              textAlign: 'center',
              marginTop: '16px',
              fontSize: '13.5px',
              color: 'var(--text-secondary)',
            }}
          >
            <Link to="/login">Back to login</Link>
          </div>
        )}
      </div>
    </div>
  );
}
