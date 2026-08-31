import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { doctorRegistrationApi } from '../api/endpoints';
import { PasswordInput } from '../components/ui';
import { TermsDialog } from '../components/TermsDialog';
import { PROVIDER_TERMS_VERSION } from '../content/providerTerms';

const MAX_LICENSE_BYTES = 6 * 1024 * 1024;

/**
 * Public sign-up for a doctor who wants their own clinic on the platform.
 *
 * The account is usable as soon as it is created: the super-admin licence
 * review no longer gates sign-in (see registerSelf on the server). The licence
 * is still collected and still reviewable — it is the verification step that
 * stopped being a gate, so this page promises an account rather than a wait.
 */
export default function DoctorRegisterPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    contact_mobile: '',
    license_number: '',
    specialization: '',
    qualifications: '',
  });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [license, setLicense] = useState<File | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      setError(null);
    },
  });

  const mut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (v.trim()) fd.append(k, v.trim());
      });
      fd.append('license', license!);
      // Recorded server-side against this exact wording, so a later change to
      // the document cannot rewrite what this doctor actually agreed to.
      fd.append('terms_version', PROVIDER_TERMS_VERSION);
      return doctorRegistrationApi.register(fd);
    },
    onSuccess: () => setDone(true),
    onError: (e: any) =>
      setError(e?.response?.data?.message ?? e?.message ?? 'Something went wrong.'),
  });

  const validMobile = /^[6-9]\d{9}$/.test(form.contact_mobile.trim());
  const passwordsMatch = form.password === confirmPassword;
  const canSubmit =
    form.name.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(form.email.trim()) &&
    form.password.length >= 8 &&
    passwordsMatch &&
    validMobile &&
    form.license_number.trim().length >= 3 &&
    !!license &&
    acceptedTerms &&
    !mut.isPending;

  if (done) {
    return (
      <div className="auth-screen">
        <div className="card login-card" style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>Your practice is ready ✓</h2>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
            Thank you. We have your details and your practice licence. You can
            sign in right away with <strong>{form.email.trim()}</strong> and the
            password you just chose.
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 18, width: '100%' }}
            onClick={() => navigate('/login')}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div
        className="card login-card"
        style={{ maxWidth: 460, textAlign: 'left' }}
      >
        <h2 style={{ marginBottom: 4, textAlign: 'center' }}>Register your practice</h2>
        <p
          className="muted"
          style={{ fontSize: 13.5, marginBottom: 18, textAlign: 'center' }}
        >
          Create your clinic on Digital OPD. Your practice licence is kept on
          file for verification — your account is ready to use straight away.
        </p>

        <label className="form-label">Full name *</label>
        <input className="input" placeholder="Dr. Asha Rao" {...field('name')} />

        <label className="form-label" style={{ marginTop: 12 }}>Login email *</label>
        <input className="input" type="email" placeholder="dr.asha@clinic.com" {...field('email')} />

        <label className="form-label" style={{ marginTop: 12 }}>Password *</label>
        <PasswordInput placeholder="min 8 characters" {...field('password')} />
        {form.password.length > 0 && form.password.length < 8 && (
          <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: 4 }}>
            Password must be at least 8 characters.
          </p>
        )}

        <label className="form-label" style={{ marginTop: 12 }}>Confirm password *</label>
        <PasswordInput
          placeholder="re-enter your password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setError(null);
          }}
        />
        {confirmPassword.length > 0 && !passwordsMatch && (
          <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: 4 }}>
            Passwords do not match.
          </p>
        )}

        <label className="form-label" style={{ marginTop: 12 }}>Mobile number *</label>
        <input
          className="input"
          inputMode="numeric"
          maxLength={10}
          placeholder="10-digit number"
          value={form.contact_mobile}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              contact_mobile: e.target.value.replace(/\D/g, '').slice(0, 10),
            }))
          }
        />
        {form.contact_mobile.length > 0 && !validMobile && (
          <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: 4 }}>
            Enter a valid 10-digit mobile number.
          </p>
        )}

        <label className="form-label" style={{ marginTop: 12 }}>
          Medical registration number *
        </label>
        <input className="input" placeholder="e.g. MCI-12345/2018" {...field('license_number')} />

        <label className="form-label" style={{ marginTop: 12 }}>Specialization</label>
        <input className="input" placeholder="Cardiologist" {...field('specialization')} />

        <label className="form-label" style={{ marginTop: 12 }}>Qualifications</label>
        <input className="input" placeholder="MD, DM (Cardiology)" {...field('qualifications')} />

        <label className="form-label" style={{ marginTop: 12 }}>
          Practice licence / registration certificate *
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > MAX_LICENSE_BYTES) {
              setError('That file is larger than 6 MB. Please choose a smaller one.');
              return;
            }
            setLicense(f);
            setError(null);
          }}
        />
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            {license ? 'Choose a different file' : 'Choose file'}
          </button>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {license ? license.name : 'PDF or image, up to 6 MB'}
          </span>
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
            marginTop: 16,
            fontSize: 13,
            lineHeight: 1.55,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => {
              setAcceptedTerms(e.target.checked);
              setError(null);
            }}
            style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }}
          />
          <span>
            I have read and accept the{' '}
            {/* A button, not a link: this opens the text over the form so
                nothing already typed is lost. */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setShowTerms(true);
              }}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                font: 'inherit',
                color: 'var(--primary)',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              Provider Terms &amp; Conditions
            </button>
            . *
          </span>
        </label>

        {error && (
          <p style={{ color: 'var(--danger, red)', marginTop: 12, fontSize: 13 }}>{error}</p>
        )}

        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 18 }}
          disabled={!canSubmit}
          onClick={() => mut.mutate()}
        >
          {mut.isPending ? 'Submitting…' : 'Create my account'}
        </button>

        <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 14 }}>
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </div>

      {showTerms && <TermsDialog onClose={() => setShowTerms(false)} />}
    </div>
  );
}
