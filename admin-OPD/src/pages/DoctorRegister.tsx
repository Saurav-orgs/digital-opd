import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { doctorRegistrationApi } from '../api/endpoints';

const MAX_LICENSE_BYTES = 6 * 1024 * 1024;

/**
 * Public sign-up for a doctor who wants their own clinic on the platform.
 *
 * Nothing typed here grants access. The account is created switched off and
 * stays that way until the super admin has looked at the licence — so this page
 * deliberately promises a review, not an account.
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
  const [license, setLicense] = useState<File | null>(null);
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
      return doctorRegistrationApi.register(fd);
    },
    onSuccess: () => setDone(true),
    onError: (e: any) =>
      setError(e?.response?.data?.message ?? e?.message ?? 'Something went wrong.'),
  });

  const validMobile = /^[6-9]\d{9}$/.test(form.contact_mobile.trim());
  const canSubmit =
    form.name.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(form.email.trim()) &&
    form.password.length >= 8 &&
    validMobile &&
    form.license_number.trim().length >= 3 &&
    !!license &&
    !mut.isPending;

  if (done) {
    return (
      <div className="auth-screen">
        <div className="card login-card" style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>Registration received ✓</h2>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
            Thank you. We have your details and your practice licence. Our team
            will verify them, and you will be able to sign in with{' '}
            <strong>{form.email.trim()}</strong> once your registration has been
            approved.
          </p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 18, width: '100%' }}
            onClick={() => navigate('/login')}
          >
            Back to sign in
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
          Create your clinic on Digital OPD. We verify every practice licence
          before activating an account.
        </p>

        <label className="form-label">Full name *</label>
        <input className="input" placeholder="Dr. Asha Rao" {...field('name')} />

        <label className="form-label" style={{ marginTop: 12 }}>Login email *</label>
        <input className="input" type="email" placeholder="dr.asha@clinic.com" {...field('email')} />

        <label className="form-label" style={{ marginTop: 12 }}>Password *</label>
        <input className="input" type="password" placeholder="min 8 characters" {...field('password')} />
        {form.password.length > 0 && form.password.length < 8 && (
          <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: 4 }}>
            Password must be at least 8 characters.
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

        {error && (
          <p style={{ color: 'var(--danger, red)', marginTop: 12, fontSize: 13 }}>{error}</p>
        )}

        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 18 }}
          disabled={!canSubmit}
          onClick={() => mut.mutate()}
        >
          {mut.isPending ? 'Submitting…' : 'Submit for verification'}
        </button>

        <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 14 }}>
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
