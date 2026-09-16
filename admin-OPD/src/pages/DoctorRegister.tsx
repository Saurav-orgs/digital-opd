import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { authApi, doctorRegistrationApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { PasswordInput } from '../components/ui';
import { TermsDialog } from '../components/TermsDialog';
import { PoweredByIttitude } from '../components/Brand';
import { PROVIDER_TERMS_VERSION } from '../content/providerTerms';
import {
  DayAvailabilityEditor,
  workingDays,
  type DayTimings,
} from '../components/DayAvailabilityEditor';
import { HEADER_PX, LetterheadHeaderPicker, MIN_RATIO } from '../components/Letterhead';

const MAX_LICENSE_BYTES = 6 * 1024 * 1024;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/*
 * The design turns specialisation into a picker. The list is the one it shows;
 * "Other" reveals a free-text box so nothing that used to be typeable becomes
 * un-typeable — existing doctors hold values that are not on this list.
 */
const SPECIALISATIONS = [
  'General Medicine',
  'Pediatrics',
  'Cardiology',
  'Dermatology',
  'Orthopedics',
  'Gynaecology',
  'ENT',
  'Psychiatry',
  'Dentistry',
];

const STEPS = ['Account', 'Register', 'Availability'] as const;
type Stage = 1 | 2 | 3;

interface Vacation {
  from: string;
  to: string;
  reason: string;
}

/**
 * Public sign-up for a doctor who wants their own clinic on the platform.
 *
 * The account is usable as soon as it is created: the super-admin licence
 * review no longer gates sign-in (see registerSelf on the server). The licence
 * is still collected and still reviewable — it is the verification step that
 * stopped being a gate, so this page promises an account rather than a wait.
 *
 * Three stages, per the updated design: the credentials you will sign in with,
 * then who you are, then when you work. Splitting the account off the profile
 * matters because they fail differently — a taken email is a different problem
 * from a missing qualification, and finding out about the first one after
 * filling in the second is the worst order to learn it.
 *
 * The third stage writes opening hours and any booked leave along with the
 * account, so a doctor who finishes this form has a booking link that already
 * works — and it ends on their dashboard, signed in, because the server
 * answers the registration with a session.
 */
export default function DoctorRegisterPage() {
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>(1);

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    contact_mobile: '',
    license_number: '',
    specialization: '',
    qualifications: '',
    clinic_address: '',
  });
  const [confirmPassword, setConfirmPassword] = useState('');
  // ── Email verification ────────────────────────────────────
  // The address is proven before the account exists: Continue on stage 1
  // sends a code, the code unlocks stage 2. `verifiedEmail` remembers which
  // address passed, so editing it afterwards asks again.
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);
  const [specChoice, setSpecChoice] = useState('');
  const [license, setLicense] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  // The prescription pad header. Optional — the letterhead screen takes it
  // later just as well — but a doctor who has the file to hand at sign-up
  // should not have to come back for it.
  const [header, setHeader] = useState<File | null>(null);
  const [headerPreview, setHeaderPreview] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // ── Availability ──────────────────────────────────────────
  const [timings, setTimings] = useState<DayTimings>({});
  const [slotMins, setSlotMins] = useState(15);
  const [vacations, setVacations] = useState<Vacation[]>([]);

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value }));
      setError(null);
    },
  });

  const openDays = workingDays(timings);

  const mut = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (v.trim()) fd.append(k, v.trim());
      });
      if (license) fd.append('license', license);
      if (photo) fd.append('photo', photo);
      if (header) fd.append('letterhead_header', header);
      // Only send hours if some were set — the server treats an empty set as
      // "not configured" rather than "closed every day".
      if (openDays.length) {
        fd.append(
          'availability',
          JSON.stringify({
            slot_duration_min: slotMins,
            days: openDays.map((day) => ({
              day,
              slots: timings[day].slots.map((s) => ({
                start_time: s.start_time,
                end_time: s.end_time,
              })),
            })),
          }),
        );
      }
      const realVacations = vacations.filter((v) => v.from && v.to);
      if (realVacations.length) fd.append('vacations', JSON.stringify(realVacations));
      // Recorded server-side against this exact wording, so a later change to
      // the document cannot rewrite what this doctor actually agreed to.
      fd.append('terms_version', PROVIDER_TERMS_VERSION);
      return doctorRegistrationApi.register(fd);
    },
    onSuccess: (res) => {
      // The account is live and the server has already signed the doctor in,
      // so the next screen is their dashboard — not a login form asking for
      // the email and password they typed a minute ago. The "sign in" card
      // stays only for an API that has not started returning a session.
      if (res.accessToken && res.user) {
        setSession({ accessToken: res.accessToken, user: res.user });
        navigate('/', { replace: true });
        return;
      }
      setDone(true);
    },
    onError: (e: any) =>
      setError(e?.response?.data?.message ?? e?.message ?? 'Something went wrong.'),
  });

  const validMobile = /^[6-9]\d{9}$/.test(form.contact_mobile.trim());
  const passwordsMatch = form.password === confirmPassword;

  /*
   * Stage 1 is the credential, and nothing else. The client's answer was
   * explicit: sign-in is by email — the design's "email or mobile" would have
   * meant a second login path the server does not have.
   */
  const emailOk = /\S+@\S+\.\S+/.test(form.email.trim());
  const emailVerified = verifiedEmail === form.email.trim().toLowerCase();
  const stage1Valid = emailOk && form.password.length >= 8 && passwordsMatch && emailVerified;
  /** Stage 1 minus the verification — what has to be right before a code is sent. */
  const stage1Typed = emailOk && form.password.length >= 8 && passwordsMatch;

  const sendCode = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await authApi.sendEmailCode(form.email.trim());
      setCodeSentTo(form.email.trim().toLowerCase());
      setCode('');
      setResendIn(res.resendAfter);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the code. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const confirmCode = async () => {
    if (!codeSentTo) return;
    setChecking(true);
    setError(null);
    try {
      await authApi.confirmEmailCode(codeSentTo, code);
      setVerifiedEmail(codeSentTo);
      setStage(2);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That code did not work. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  /*
   * Stage 2 holds everything the profile cannot be created without. The
   * certificate is not among them — the design offers "you can add this
   * later", and licence review already happened after the account went live,
   * so requiring it here only ever cost sign-ups.
   */
  const stage2Valid =
    form.name.trim().length >= 2 &&
    validMobile &&
    form.license_number.trim().length >= 3 &&
    form.clinic_address.trim().length >= 3 &&
    form.qualifications.trim().length >= 2 &&
    form.specialization.trim().length >= 2;

  const canSubmit = stage1Valid && stage2Valid && acceptedTerms && !mut.isPending;

  if (done) {
    return (
      <div className="auth-screen">
        <div className="card login-card" style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: 8 }}>Your practice is ready ✓</h2>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.6 }}>
            Thank you. You can sign in right away with{' '}
            <strong>{form.email.trim()}</strong> and the password you just chose.
            {openDays.length > 0 && ' Your booking link is live with the hours you set.'}
            {!license && ' You can add your registration certificate from My profile.'}
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

  const goStage = (n: Stage) => {
    // Later stages are reachable only once the ones before them hold up —
    // otherwise the last step submits a form with a hole in the middle of it.
    if (n >= 2 && !stage1Valid) return;
    if (n >= 3 && !stage2Valid) return;
    setError(null);
    setStage(n);
  };

  return (
    <div className="register-screen">
      <div className="register-inner">
        <header className="register-head">
          <h1>Doctor Registration</h1>
          <p className="muted">Set up your profile to start seeing patients.</p>
        </header>

        <ol className="steps2 register-steps" aria-label="Registration progress">
          {STEPS.map((label, i) => {
            const n = (i + 1) as Stage;
            const locked = (n === 2 && !stage1Valid) || (n === 3 && !stage2Valid);
            return (
              <Fragment key={label}>
                {i > 0 && (
                  <li className={`step2-track ${stage > i ? 'done' : ''}`} aria-hidden />
                )}
                <li className="step2-item">
                  <button
                    type="button"
                    className={`step2 ${stage === n ? 'active' : stage > n ? 'done' : ''} ${
                      locked ? 'locked' : ''
                    }`}
                    aria-current={stage === n ? 'step' : undefined}
                    disabled={locked}
                    onClick={() => goStage(n)}
                  >
                    <span className="step2-dot" aria-hidden>
                      {stage > n ? '✓' : n}
                    </span>
                    <span className="step2-label">{label}</span>
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ol>

        {stage === 1 && (
          <section className="box teal-accent">
            <h2 className="box-title">Create your account</h2>
            <div className="box-sub">This is what you will sign in with.</div>

            <label className="form-label">Email *</label>
            <input
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              {...field('email')}
            />

            <label className="form-label">Password *</label>
            <PasswordInput placeholder="At least 8 characters" {...field('password')} />
            {form.password.length > 0 && form.password.length < 8 && (
              <p className="field-err">Password must be at least 8 characters.</p>
            )}

            <label className="form-label">Confirm password *</label>
            <PasswordInput
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError(null);
              }}
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="field-err">Passwords do not match.</p>
            )}

            {emailVerified ? (
              <p className="verify-ok">✓ {form.email.trim()} is verified.</p>
            ) : codeSentTo === form.email.trim().toLowerCase() ? (
              <div className="verify-box">
                <div className="verify-title">Check your email</div>
                <p className="muted" style={{ fontSize: 12.5, margin: '2px 0 10px' }}>
                  We sent a 6-digit code to <strong>{codeSentTo}</strong>. It expires in 10 minutes.
                </p>
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
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.length === 6) void confirmCode();
                  }}
                />
                <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={sending || resendIn > 0}
                    onClick={() => void sendCode()}
                  >
                    {sending ? 'Sending…' : resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setCodeSentTo(null);
                      setCode('');
                    }}
                  >
                    Change email
                  </button>
                </div>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                We will email you a code to confirm this address before you continue.
              </p>
            )}
          </section>
        )}

        {stage === 2 && (
          <>
            {/* ── Photo ── */}
            <div className="photo-picker">
              <input
                ref={photoRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > MAX_PHOTO_BYTES) {
                    setError('That photo is larger than 6 MB. Please choose a smaller one.');
                    return;
                  }
                  setPhoto(f);
                  setPhotoPreview(URL.createObjectURL(f));
                  setError(null);
                }}
              />
              <button
                type="button"
                className="photo-drop"
                onClick={() => photoRef.current?.click()}
              >
                {photoPreview ? (
                  <img src={photoPreview} alt="" />
                ) : (
                  <span className="photo-drop-icon" aria-hidden>📷</span>
                )}
              </button>
              <div className="photo-label">
                Doctor's photo <span className="muted">(optional)</span>
              </div>
            </div>

            {/* ── Basic details ── */}
            <section className="box sky-accent">
              <h2 className="box-title">Basic details</h2>

              <label className="form-label">Doctor's name *</label>
              <input className="input" placeholder="e.g. Dr. Ananya Sharma" {...field('name')} />

              <label className="form-label">Mobile number *</label>
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
                <p className="field-err">Enter a valid 10-digit mobile number.</p>
              )}

              <label className="form-label">Registration number *</label>
              <input className="input" placeholder="e.g. DMC/12345/2015" {...field('license_number')} />
            </section>

            {/* ── Certificate ── */}
            <section className="box marigold-accent">
              <h2 className="box-title">Registration certificate</h2>
              <div className="box-sub">Optional — you can add this later.</div>
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
              <button type="button" className="file-drop" onClick={() => fileRef.current?.click()}>
                <span className="file-drop-icon" aria-hidden>📄</span>
                <span className="file-drop-main">
                  {license ? license.name : 'Tap to upload or drop a file'}
                </span>
                <span className="file-drop-sub">
                  {license ? 'Choose a different file' : 'JPG, PNG or PDF · up to 6 MB'}
                </span>
              </button>
            </section>

            {/* ── Practice details ── */}
            <section className="box berry-accent">
              <h2 className="box-title">Practice details</h2>

              <label className="form-label">Address *</label>
              <textarea
                className="input"
                rows={2}
                placeholder="Clinic / practice address"
                {...field('clinic_address')}
              />

              <label className="form-label">Qualifications *</label>
              <input className="input" placeholder="e.g. MBBS, MD" {...field('qualifications')} />

              <label className="form-label">Specialisation *</label>
              <select
                className="select"
                value={specChoice}
                onChange={(e) => {
                  const v = e.target.value;
                  setSpecChoice(v);
                  // "Other" clears the field so the free-text box starts empty
                  // rather than inheriting the last picked option.
                  setForm((f) => ({ ...f, specialization: v === 'Other' ? '' : v }));
                  setError(null);
                }}
              >
                <option value="">Select specialisation</option>
                {SPECIALISATIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="Other">Other</option>
              </select>
              {specChoice === 'Other' && (
                <input
                  className="input"
                  style={{ marginTop: 8 }}
                  placeholder="Your specialisation"
                  {...field('specialization')}
                />
              )}
            </section>
          </>
        )}

        {stage === 3 && (
          <>
            {/* ── Slot timing ── */}
            <section className="box teal-accent">
              <h2 className="box-title">Slot timing</h2>
              <div className="box-sub">
                Open a day to add its time slots, then save it. A day can have more
                than one slot. Days you leave unset are treated as days off.
              </div>

              <DayAvailabilityEditor
                timings={timings}
                onChange={setTimings}
                onNotify={setNotice}
              />

              <label className="form-label" style={{ marginTop: 14 }}>
                Each appointment slot
              </label>
              {/* Not in the design, but the booking grid cannot be built
                  without it, and guessing silently would be worse. */}
              <select
                className="select"
                value={slotMins}
                onChange={(e) => setSlotMins(Number(e.target.value))}
              >
                {[5, 10, 15, 20, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>

              {notice && <p className="form-notice">{notice}</p>}
            </section>

            {/* ── Letterhead ──
                Skippable, and says so: the header prints on every
                prescription, but nothing about booking depends on it. */}
            <section className="box sky-accent">
              <h2 className="box-title">Prescription letterhead</h2>
              <div className="box-sub">
                Optional — upload the top strip of your prescription pad and it
                prints as the header on every prescription. You can skip this and
                add it later from the Letterhead menu.
              </div>
              <LetterheadHeaderPicker
                inputRef={headerRef}
                onPick={(f) => {
                  if (f.size > MAX_PHOTO_BYTES) {
                    setError('That image is larger than 6 MB. Please choose a smaller one.');
                    return;
                  }
                  setHeader(f);
                  setHeaderPreview(URL.createObjectURL(f));
                  setError(null);
                }}
                onReject={(problem) => setError(problem)}
              />
              {headerPreview ? (
                <div className="lh-header-box">
                  <img src={headerPreview} alt="Your prescription header" />
                </div>
              ) : (
                <button type="button" className="file-drop" onClick={() => headerRef.current?.click()}>
                  <span className="file-drop-icon" aria-hidden>🖼</span>
                  <span className="file-drop-main">Tap to upload your pad header</span>
                  <span className="file-drop-sub">
                    PNG or JPG, a wide strip — best at {HEADER_PX.w} × {HEADER_PX.h} px, at
                    least {MIN_RATIO}× wider than tall
                  </span>
                </button>
              )}
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {headerPreview ? (
                  <>
                    <button type="button" className="btn btn-sm" onClick={() => headerRef.current?.click()}>
                      Choose a different image
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        setHeader(null);
                        setHeaderPreview(null);
                      }}
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    Skip for now — your name, qualifications and address print instead.
                  </span>
                )}
              </div>
            </section>

            {/* ── Vacation ── */}
            <section className="box marigold-accent">
              <h2 className="box-title">Vacation</h2>
              <div className="box-sub">Patients won't be able to book appointments on these dates.</div>

              {vacations.map((v, i) => (
                <div key={i} className="vacation-row">
                  <div className="time-row">
                    <div>
                      <label className="form-label">From</label>
                      <input
                        className="input"
                        type="date"
                        value={v.from}
                        onChange={(e) =>
                          setVacations((prev) =>
                            prev.map((x, j) =>
                              j === i
                                ? { ...x, from: e.target.value, to: x.to || e.target.value }
                                : x,
                            ),
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="form-label">To</label>
                      <input
                        className="input"
                        type="date"
                        min={v.from || undefined}
                        value={v.to}
                        onChange={(e) =>
                          setVacations((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                  </div>
                  <label className="form-label">Reason (optional)</label>
                  <input
                    className="input"
                    placeholder="e.g. Family vacation"
                    value={v.reason}
                    onChange={(e) =>
                      setVacations((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    style={{ marginTop: 8 }}
                    onClick={() => setVacations((prev) => prev.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="add-row-btn"
                onClick={() =>
                  setVacations((prev) => [...prev, { from: '', to: '', reason: '' }])
                }
              >
                + Add vacation dates
              </button>
            </section>

            {/* ── Terms ──
                On the last step, where the client asked for it: it is the
                thing you agree to as you commit, not as you start typing. */}
            <label className="terms-row">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => {
                  setAcceptedTerms(e.target.checked);
                  setError(null);
                }}
              />
              <span>
                I have read and accept the{' '}
                {/* A button, not a link: this opens the text over the form so
                    nothing already typed is lost. */}
                <button
                  type="button"
                  className="link-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowTerms(true);
                  }}
                >
                  Provider Terms &amp; Conditions
                </button>
                . *
              </span>
            </label>
          </>
        )}

        {error && <p className="field-err" style={{ marginTop: 12 }}>{error}</p>}

        <div className="register-actions">
          {stage > 1 && (
            <button className="btn" onClick={() => goStage((stage - 1) as Stage)}>
              Back
            </button>
          )}
          {stage === 1 ? (
            emailVerified ? (
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!stage1Valid}
                onClick={() => goStage(2)}
              >
                Continue
              </button>
            ) : codeSentTo === form.email.trim().toLowerCase() ? (
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={code.length !== 6 || checking}
                onClick={() => void confirmCode()}
              >
                {checking ? 'Checking…' : 'Verify & continue'}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!stage1Typed || sending}
                onClick={() => void sendCode()}
              >
                {sending ? 'Sending code…' : 'Send verification code'}
              </button>
            )
          ) : stage === 2 ? (
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!stage2Valid}
              onClick={() => goStage(3)}
            >
              Continue
            </button>
          ) : (
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!canSubmit || openDays.length === 0}
              title={
                openDays.length === 0 ? 'Save timings for at least one day' : undefined
              }
              onClick={() => mut.mutate()}
            >
              {mut.isPending ? 'Submitting…' : 'Complete setup'}
            </button>
          )}
        </div>

        <p className="muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 14 }}>
          Already registered? <Link to="/login">Sign in</Link>
        </p>

        <PoweredByIttitude className="auth-powered-by" />
      </div>

      {showTerms && <TermsDialog onClose={() => setShowTerms(false)} />}
    </div>
  );
}
