import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  User,
  Phone,
  MapPin,
  FileText,
  CheckCircle2,
  Upload,
  X,
  Plus,
  ArrowUp,
  Lock,
} from 'lucide-react';
import { api } from '../api';
import { patientApi, patientTokenStore } from '../patientApi';
import type { Doctor, PatientProfile, Slot } from '../types';
import { ApiException } from '../types';
import { NetworkAvatar } from '../components/NetworkAvatar';
import { usePatientAuth } from '../auth/PatientAuthContext';
import { PasswordField } from '../components/PasswordField';

/** A report the patient staged during booking, held until the visit exists. */
interface StagedReport {
  id: string;
  title: string;
  file: File;
}

const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,application/pdf';

/**
 * Step 2 — optional reports, staged in memory. Nothing is uploaded here: the
 * visit does not exist yet, so the files ride along until the booking succeeds.
 */
const ReportsStep: React.FC<{
  staged: StagedReport[];
  onRemove: (id: string) => void;
  title: string;
  onTitleChange: (t: string) => void;
  file: File | null;
  onFileChange: (f: File | null) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onAdd: () => void;
  warning: string | null;
}> = ({ staged, onRemove, title, onTitleChange, file, onFileChange, fileRef, onAdd, warning }) => {
  // Anything typed or chosen but not yet in the list. This is the state where
  // patients used to hit Confirm and lose the file, so it is called out loudly.
  const pending = Boolean(file || title.trim());

  return (
    <div className="section-card">
      <h3 className="card-section-title">
        <Upload size={18} color="var(--primary)" />
        <span>Add Reports (optional)</span>
      </h3>

      <p style={{ margin: '0 0 16px', fontSize: '13.5px', color: 'var(--text-secondary)' }}>
        Have lab reports or scans for this visit? Add them now so the doctor can review
        them beforehand. You can also skip this and add them later.
      </p>

      {staged.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="report-added-head">
            <CheckCircle2 size={14} color="var(--done)" />
            <span>
              {staged.length} report{staged.length > 1 ? 's' : ''} added to this booking
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {staged.map((r) => (
              <div key={r.id} className="report-added-row">
                <FileText size={15} color="var(--primary)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.title}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                    {r.file.name} · {(r.file.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <button
                  type="button"
                  className="link-btn link-btn-danger"
                  onClick={() => onRemove(r.id)}
                  aria-label={`Remove ${r.title}`}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Title, file and the Add button belong to one another — framing them
          together is what stops the last step from being skipped. */}
      <div className={'report-draft' + (pending ? ' pending' : '')}>
        <div className="form-field">
          <label className="form-label icon-label">
            <FileText size={14} color="var(--text-secondary)" />
            <span>Report title</span>
          </label>
          <input
            type="text"
            className="form-input"
            placeholder="e.g. Blood Test — CBC"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
          />
        </div>

        <label className="report-file-row">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_TYPES}
            className="visually-hidden-input"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          />
          <span className="report-file-btn">Choose file</span>
          <span className={'report-file-name' + (file ? ' has-file' : '')}>
            {file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB` : 'No file chosen'}
          </span>
        </label>

        <button
          type="button"
          className={'btn-add-report' + (pending ? ' pending' : '')}
          onClick={onAdd}
        >
          <Plus size={18} />
          <span>Add this report</span>
        </button>

        {pending && (
          <div className="report-pending-hint">
            <ArrowUp size={14} />
            <span>Not attached yet — tap “Add this report” to include it.</span>
          </div>
        )}
      </div>

      {warning && <div className="error-text" style={{ marginTop: 10 }}>{warning}</div>}

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
        JPG, PNG, WebP or PDF · up to 5 MB each.
      </div>
    </div>
  );
};

export const BookingForm: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const state = location.state as {
    doctor?: Doctor;
    date?: string;
    slot?: Slot;
  } | null;

  const doctor = state?.doctor;
  const date = state?.date;
  const slot = state?.slot;

  const { patient, profiles, loading: authLoading, login, signup } = usePatientAuth();

  /*
   * Four steps: the number, who the visit is for, their details, then optional
   * reports. The appointment is only created on the final confirm, since
   * reports must attach to a real visit.
   *
   * Step 2 is skipped whenever the number has nobody on it yet — a first-time
   * caller should never be shown an empty pick-list.
   */
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  /*
   * Step 1 in three parts: the number, then either the password for a number
   * that already has an account or a new password for one that does not. A
   * patient who is already signed in never sees any of it — see the effect
   * below.
   */
  const [authStage, setAuthStage] = useState<'mobile' | 'password' | 'create'>('mobile');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [knownPatients, setKnownPatients] = useState<PatientProfile[] | null>(null);
  const [identifying, setIdentifying] = useState(false);
  // null here means "a new patient" — never "look one up by name".
  const [profileId, setProfileId] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedReport[]>([]);
  const [reportWarning, setReportWarning] = useState<string | null>(null);

  // The report being filled in right now. Held here, not inside the step, so
  // Confirm can still pick it up when the patient never pressed Add.
  const [draftTitle, setDraftTitle] = useState('');
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const reportFileRef = useRef<HTMLInputElement>(null);
  const reportsCardRef = useRef<HTMLDivElement>(null);

  const [mobile, setMobile] = useState(patient?.mobile ?? '');
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [pincode, setPincode] = useState('');
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [genderError, setGenderError] = useState<string | null>(null);
  const [ageError, setAgeError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [cityError, setCityError] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [pincodeError, setPincodeError] = useState<string | null>(null);

  if (!doctor || !date || !slot) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>
          No booking information found. Please select a slot first.
        </p>
        <button
          className="btn-primary"
          style={{ marginTop: '16px', maxWidth: '240px', marginLeft: 'auto', marginRight: 'auto' }}
          onClick={() => navigate('/')}
        >
          Back to Home
        </button>
      </div>
    );
  }

  /**
   * Move the report the patient has filled in into the staged list. Returns the
   * new list, or the reason it could not be added — the caller decides whether
   * that reason blocks the booking or just shows a warning.
   */
  const stageDraft = (): { list?: StagedReport[]; error?: string } => {
    if (!draftFile) return { error: 'Please choose a file to add.' };
    if (!draftTitle.trim()) return { error: 'Please enter a title for this report.' };
    if (draftFile.size > MAX_REPORT_BYTES) {
      return { error: 'That file is larger than 5 MB. Please choose a smaller one.' };
    }

    const list = [
      ...staged,
      { id: `${draftFile.name}-${Date.now()}`, title: draftTitle.trim(), file: draftFile },
    ];
    setStaged(list);
    setDraftTitle('');
    setDraftFile(null);
    if (reportFileRef.current) reportFileRef.current.value = '';
    setReportWarning(null);
    return { list };
  };

  const addReport = () => {
    const { error } = stageDraft();
    if (error) setReportWarning(error);
  };

  const validateMobile = () => {
    const m = mobile.trim();
    if (!m) {
      setMobileError('Mobile number is required.');
      return false;
    }
    if (!/^[6-9]\d{9}$/.test(m)) {
      setMobileError('Enter a valid 10-digit mobile number.');
      return false;
    }
    setMobileError(null);
    return true;
  };

  const validateDetails = () => {
    let valid = true;
    const check = (
      ok: boolean,
      set: (v: string | null) => void,
      message: string,
    ) => {
      set(ok ? null : message);
      if (!ok) valid = false;
    };

    check(name.trim().length >= 2, setNameError, 'Please enter the patient’s full name.');
    check(!!gender, setGenderError, 'Please select a gender.');

    const ageNum = Number(age);
    check(
      !!age.trim() && Number.isInteger(ageNum) && ageNum >= 0 && ageNum <= 120,
      setAgeError,
      'Enter a valid age.',
    );

    check(address.trim().length >= 3, setAddressError, 'Please enter the address.');
    check(city.trim().length >= 2, setCityError, 'Please enter the city.');
    check(stateName.trim().length >= 2, setStateError, 'Please enter the state.');
    check(
      /^[1-9]\d{5}$/.test(pincode.trim()),
      setPincodeError,
      'Enter a valid 6-digit PIN code.',
    );

    return valid;
  };

  /*
   * A patient who is already signed in has nothing to prove: their number is
   * the account they are signed into, so booking starts at "who is this visit
   * for?" instead of asking for a number and a password they just used.
   *
   * Waits for the session to finish loading, or a signed-in patient would see
   * the number field flash on every page load.
   */
  useEffect(() => {
    if (authLoading || !patient || step !== 1) return;
    setMobile(patient.mobile);
    setKnownPatients(profiles);
    setStep(profiles.length > 0 ? 2 : 3);
  }, [authLoading, patient, profiles, step]);

  /**
   * Once signed in, go where the number used to lead: pick a patient, or add
   * the first one.
   */
  const enterBooking = (list: PatientProfile[]) => {
    setKnownPatients(list);
    setStep(list.length > 0 ? 2 : 3);
  };

  /**
   * Step 1a → is this number registered, and has it got a password?
   *
   * This used to be `identify`, which took the number alone and returned the
   * patients on it. Now the number decides only which field comes next.
   */
  const checkNumber = async () => {
    if (!validateMobile()) return;
    setIdentifying(true);
    setFormError(null);
    try {
      const res = await patientApi.check(mobile.trim());
      // An account with no password yet — one the front desk opened for a
      // walk-in — is asked to choose one, not to guess a password it never set.
      setAuthStage(res.exists && res.has_password ? 'password' : 'create');
      setPassword('');
      setConfirmPassword('');
      setPasswordError(null);
    } catch (err) {
      setFormError(
        err instanceof ApiException
          ? err.message
          : 'Could not check this number. Please try again.',
      );
    } finally {
      setIdentifying(false);
    }
  };

  /** Step 1b → sign in to a number that already has an account. */
  const submitPassword = async () => {
    if (!password) {
      setPasswordError('Please enter your password.');
      return;
    }
    setIdentifying(true);
    setFormError(null);
    setPasswordError(null);
    try {
      await login(mobile.trim(), password, doctor?.id);
      enterBooking(await patientApi.profiles());
    } catch (err) {
      setPasswordError(
        err instanceof ApiException ? err.message : 'Could not sign in. Please try again.',
      );
    } finally {
      setIdentifying(false);
    }
  };

  /** Step 1b (new number) → choose a password, which opens the account. */
  const submitNewPassword = async () => {
    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setIdentifying(true);
    setFormError(null);
    setPasswordError(null);
    try {
      await signup(mobile.trim(), password, doctor?.id);
      // Usually empty, but an account the front desk opened may already have
      // patients on it — those should still be offered.
      enterBooking(await patientApi.profiles());
    } catch (err) {
      setPasswordError(
        err instanceof ApiException
          ? err.message
          : 'Could not create your account. Please try again.',
      );
    } finally {
      setIdentifying(false);
    }
  };

  /** Chose an existing patient — carry their details forward, still editable. */
  const choosePatient = (p: PatientProfile) => {
    setProfileId(p.id);
    setName(p.name);
    setGender(p.gender ?? '');
    setAge(p.last_age != null ? String(p.last_age) : '');
    setAddress(p.address_line ?? '');
    setCity(p.city ?? '');
    setStateName(p.state ?? '');
    setPincode(p.pincode ?? '');
    setStep(3);
  };

  /**
   * Chose "new patient" — deliberately leaves `profileId` null and the form
   * blank. Filling in a name that matches an existing patient still creates a
   * separate record; that is the rule, not an oversight.
   */
  const chooseNewPatient = () => {
    setProfileId(null);
    setName('');
    setGender('');
    setAge('');
    setAddress('');
    setCity('');
    setStateName('');
    setPincode('');
    setStep(3);
  };

  /**
   * Attach the staged reports to the freshly booked visit.
   *
   * Uploading needs a patient session, and booking is a guest flow — but the
   * booking we just made means this mobile now resolves to a patient, so a
   * phone-only login provisions the session silently.
   *
   * Returns a message when some files did not make it. It never throws: the
   * appointment is already booked by this point, and losing that over a failed
   * upload would be far worse than asking the patient to re-add a file.
   */
  const attachStagedReports = async (
    appointmentId: string,
    reports: StagedReport[],
  ): Promise<string | null> => {
    if (reports.length === 0) return null;

    try {
      if (!patientTokenStore.get()) {
        const session = await patientApi.login(mobile.trim(), doctor.id);
        patientTokenStore.set(session.accessToken);
      }
    } catch {
      return 'Your appointment is booked, but we could not attach your reports. You can add them from My Visits.';
    }

    const failed: StagedReport[] = [];
    for (const r of reports) {
      try {
        await patientApi.uploadVisitReport(appointmentId, r.title, r.file);
      } catch {
        failed.push(r);
      }
    }
    if (failed.length === 0) return null;

    // An upload that timed out on a slow connection may still have landed on
    // the server. Ask the visit what it actually holds before telling the
    // patient a report was lost — they were seeing failures for reports that
    // turned out to be there.
    const missing = await reconcileFailedUploads(appointmentId, failed);
    if (missing.length === 0) return null;

    return `Your appointment is booked, but ${missing.length} of ${reports.length} report(s) could not be uploaded. You can add them from My Visits.`;
  };

  /** Which of the failed uploads are genuinely absent from the booked visit. */
  const reconcileFailedUploads = async (
    appointmentId: string,
    failed: StagedReport[],
  ): Promise<StagedReport[]> => {
    try {
      const visits = await patientApi.myVisits(doctor.id);
      const visit = visits.find((v) => v.id === appointmentId);
      if (!visit) return failed;

      // Titles are consumed one at a time so two reports sharing a title still
      // need two rows on the server before both count as delivered.
      const landed = visit.reports.map((r) => r.title);
      return failed.filter((r) => {
        const at = landed.indexOf(r.title);
        if (at === -1) return true;
        landed.splice(at, 1);
        return false;
      });
    } catch {
      return failed; // can't tell — keep the honest warning
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Step 1 is signing in — number, then password; step 2 is a pick, handled
    // by its own buttons.
    if (step === 1) {
      if (authStage === 'mobile') return checkNumber();
      if (authStage === 'password') return submitPassword();
      return submitNewPassword();
    }
    if (step === 2) return;

    if (!validateDetails()) return;

    // Details are valid but the patient hasn't seen the reports step yet.
    if (step === 3) {
      setStep(4);
      return;
    }

    // The patient may have filled in a report and gone straight for Confirm.
    // Take it along rather than dropping it silently.
    let reports = staged;
    if (draftFile || draftTitle.trim()) {
      const { list, error } = stageDraft();
      if (error) {
        setReportWarning(error);
        reportsCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      reports = list!;
    }

    setSubmitting(true);
    try {
      const result = await api.bookAppointment({
        doctorId: doctor.id,
        date,
        startTime: slot.startTime,
        patientProfileId: profileId,
        patientName: name.trim(),
        patientMobile: mobile.trim(),
        patientGender: gender,
        patientAge: Number(age),
        patientAddress: address.trim(),
        patientCity: city.trim(),
        patientState: stateName.trim(),
        patientPincode: pincode.trim(),
        description: description.trim(),
      });

      const reportsWarning = await attachStagedReports(result.id, reports);

      navigate('/confirmation', {
        replace: true,
        state: { result, doctor, reportsWarning },
      });
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiException) {
        if (err.code === 'SLOT_ALREADY_BOOKED' || err.code === 'SLOT_IN_PAST') {
          alert(err.message);
          navigate(-1);
        } else {
          setFormError(err.message);
          setStep(3); // the problem is with the details, so send them back
        }
      } else {
        setFormError('Something went wrong. Please try again.');
        setStep(3);
      }
    }
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div className="booking-header-row">
        <div>
          <div className="step-badge-text">
            Step {step} of 4 ·{' '}
            {step === 1
              ? authStage === 'mobile'
                ? 'Mobile Number'
                : authStage === 'password'
                  ? 'Your Password'
                  : 'Create a Password'
              : step === 2
                ? 'Who is this visit for?'
                : step === 3
                  ? 'Patient Details'
                  : 'Reports (optional)'}
          </div>
          <h2 style={{ fontSize: '26px', fontWeight: 800, margin: 0, color: 'var(--text)' }}>
            Complete Your Booking
          </h2>
        </div>

        <button
          type="button"
          className="btn-outlined"
          onClick={() => {
            // Step 2 only exists when the number had patients on it, so going
            // back from the details form must skip it otherwise.
            if (step === 4) return setStep(3);
            if (step === 3) return setStep(knownPatients?.length ? 2 : 1);
            if (step === 2) return setStep(1);
            // Within step 1, Back means "that was the wrong number".
            if (authStage !== 'mobile') {
              setAuthStage('mobile');
              setPassword('');
              setConfirmPassword('');
              setPasswordError(null);
              return;
            }
            window.history.length > 1 ? navigate(-1) : navigate('/');
          }}
          style={{ borderRadius: '999px', padding: '8px 20px' }}
        >
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="booking-grid">
          {/* Step 1 — signing in. The number decides which field follows:
              the password for an account that has one, or a new password for
              a number that does not. */}
          {step === 1 && authStage === 'mobile' && (
            <div className="section-card">
              <h3 className="card-section-title">
                <Phone size={18} color="var(--primary)" />
                <span>Mobile Number</span>
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: -4 }}>
                We use this to find your existing records, and to reach you about
                the visit.
              </p>
              <div className="form-field">
                <label className="form-label icon-label">
                  <Phone size={14} color="var(--text-secondary)" />
                  <span>Mobile Number *</span>
                </label>
                <input
                  type="tel"
                  autoFocus
                  className={'form-input' + (mobileError ? ' error' : '')}
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void checkNumber();
                    }
                  }}
                />
                {mobileError && <span className="error-text">{mobileError}</span>}
              </div>
            </div>
          )}

          {/* Step 1b — a number we know. */}
          {step === 1 && authStage === 'password' && (
            <div className="section-card">
              <h3 className="card-section-title">
                <Lock size={18} color="var(--primary)" />
                <span>Enter your password</span>
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: -4 }}>
                {mobile} already has an account. Sign in to see the patients on
                it and book for any of them.
              </p>
              <div className="form-field">
                <label className="form-label">Password *</label>
                <PasswordField
                  autoFocus
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(v) => {
                    setPassword(v);
                    setPasswordError(null);
                  }}
                />
                {passwordError && <span className="error-text">{passwordError}</span>}
              </div>
            </div>
          )}

          {/* Step 1b — a number with no account, or one the front desk opened
              that has never had a password. Both choose one here. */}
          {step === 1 && authStage === 'create' && (
            <div className="section-card">
              <h3 className="card-section-title">
                <Lock size={18} color="var(--primary)" />
                <span>Create a password</span>
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: -4 }}>
                This is your first visit with {mobile}. Choose a password so you
                can come back to your records later.
              </p>
              <div className="form-field">
                <label className="form-label">New password *</label>
                <PasswordField
                  autoFocus
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(v) => {
                    setPassword(v);
                    setPasswordError(null);
                  }}
                />
              </div>
              <div className="form-field">
                <label className="form-label">Confirm password *</label>
                <PasswordField
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(v) => {
                    setConfirmPassword(v);
                    setPasswordError(null);
                  }}
                />
                {passwordError && <span className="error-text">{passwordError}</span>}
              </div>
            </div>
          )}

          {/* Step 2 — who the visit is for. Picking a card reuses that
              patient's record; "New patient" always creates a separate one,
              even when the name typed next matches an existing patient. */}
          {step === 2 && (
            <div className="section-card">
              <h3 className="card-section-title">
                <User size={18} color="var(--primary)" />
                <span>Who is this visit for?</span>
              </h3>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: -4 }}>
                Choose an existing patient to add this visit to their history, or
                add a new patient on this number.
              </p>

              <div style={{ display: 'grid', gap: 10 }}>
                {(knownPatients ?? []).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="patient-pick-card"
                    onClick={() => choosePatient(p)}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                        {[
                          p.last_age != null ? `${p.last_age} yrs` : null,
                          p.gender,
                          p.patient_code,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {p.last_visit_date
                          ? `Last visit ${p.last_visit_date}`
                          : 'No visits yet'}
                      </div>
                    </div>
                    <ArrowLeft
                      size={16}
                      style={{ transform: 'rotate(180deg)', flexShrink: 0 }}
                    />
                  </button>
                ))}

                <button
                  type="button"
                  className="patient-pick-card patient-pick-new"
                  onClick={chooseNewPatient}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>+ New patient</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      Someone not listed above — a family member on this number
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Kept mounted on the reports step so typed details survive a Back. */}
          <div
            className="section-card"
            style={{ display: step === 3 ? undefined : 'none' }}
          >
            <h3 className="card-section-title">
              <User size={18} color="var(--primary)" />
              <span>Patient Information</span>
            </h3>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 13,
                color: 'var(--text-secondary)',
                marginBottom: 14,
              }}
            >
              <span>
                {profileId ? 'Existing patient' : 'New patient'} · {mobile}
              </span>
              <button
                type="button"
                className="btn-text"
                onClick={() => setStep(knownPatients?.length ? 2 : 1)}
                style={{ fontSize: 13 }}
              >
                Change
              </button>
            </div>

            <div className="form-field">
              <label className="form-label icon-label">
                <User size={14} color="var(--text-secondary)" />
                <span>Full Name *</span>
              </label>
              <input
                type="text"
                className={'form-input' + (nameError ? ' error' : '')}
                placeholder="Enter patient full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {nameError && <span className="error-text">{nameError}</span>}
            </div>

            <div style={{ display: 'flex', gap: '16px' }}>
              <div className="form-field" style={{ flex: 1 }}>
                <label className="form-label icon-label">
                  <User size={14} color="var(--text-secondary)" />
                  <span>Gender *</span>
                </label>
                <select
                  className={'form-input' + (genderError ? ' error' : '')}
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                >
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
                {genderError && <span className="error-text">{genderError}</span>}
              </div>

              <div className="form-field" style={{ flex: 1 }}>
                <label className="form-label icon-label">
                  <User size={14} color="var(--text-secondary)" />
                  <span>Age *</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={120}
                  className={'form-input' + (ageError ? ' error' : '')}
                  placeholder="Age"
                  value={age}
                  onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))}
                />
                {ageError && <span className="error-text">{ageError}</span>}
              </div>
            </div>

            <div className="form-field">
              <label className="form-label icon-label">
                <MapPin size={14} color="var(--text-secondary)" />
                <span>Address *</span>
              </label>
              <textarea
                className={'form-input' + (addressError ? ' error' : '')}
                rows={2}
                placeholder="House / street"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              {addressError && <span className="error-text">{addressError}</span>}
            </div>

            <div style={{ display: 'flex', gap: '16px' }}>
              <div className="form-field" style={{ flex: 1 }}>
                <label className="form-label">City *</label>
                <input
                  type="text"
                  className={'form-input' + (cityError ? ' error' : '')}
                  placeholder="City"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
                {cityError && <span className="error-text">{cityError}</span>}
              </div>

              <div className="form-field" style={{ flex: 1 }}>
                <label className="form-label">State *</label>
                <input
                  type="text"
                  className={'form-input' + (stateError ? ' error' : '')}
                  placeholder="State"
                  value={stateName}
                  onChange={(e) => setStateName(e.target.value)}
                />
                {stateError && <span className="error-text">{stateError}</span>}
              </div>

              <div className="form-field" style={{ flex: 1 }}>
                <label className="form-label">PIN Code *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  className={'form-input' + (pincodeError ? ' error' : '')}
                  placeholder="452001"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                {pincodeError && <span className="error-text">{pincodeError}</span>}
              </div>
            </div>

            <div className="form-field" style={{ marginBottom: 0 }}>
              <label className="form-label icon-label">
                <FileText size={14} color="var(--text-secondary)" />
                <span>Reason for Visit / Symptoms (optional)</span>
              </label>
              <textarea
                className="form-input"
                rows={2}
                placeholder="Briefly describe health concerns or symptoms"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          {step === 4 && (
            <div ref={reportsCardRef}>
              <ReportsStep
                staged={staged}
                onRemove={(id) => setStaged(staged.filter((r) => r.id !== id))}
                title={draftTitle}
                onTitleChange={setDraftTitle}
                file={draftFile}
                onFileChange={setDraftFile}
                fileRef={reportFileRef}
                onAdd={addReport}
                warning={reportWarning}
              />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="section-card summary-card-accent">
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <NetworkAvatar url={doctor.profilePhotoUrl} size={48} alt={doctor.name} />
                <div style={{ flex: 1 }}>
                  <div className="summary-tag">
                    Appointment Summary
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '17px', color: 'var(--text)' }}>
                    {doctor.name}
                  </div>
                  {doctor.specialization && (
                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      {doctor.specialization}
                    </div>
                  )}
                </div>
              </div>

              <div className="summary-bottom-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text)' }}>
                  <Calendar size={16} color="var(--primary)" />
                  <span style={{ fontWeight: 600 }}>{date}</span>
                </div>

                <div className="slot-badge-highlight">
                  {slot.startTime} - {slot.endTime}
                </div>
              </div>
            </div>

            {formError && (
              <div className="section-card" style={{ background: '#FEE2E2', borderColor: '#FCA5A5', color: 'var(--error)', fontWeight: 600 }}>
                {formError}
              </div>
            )}

            <div>
              {/* Step 2 is chosen by tapping a card, so it has no submit. */}
              {step !== 2 && (
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={submitting || identifying}
                >
                  {submitting || identifying ? (
                    <div className="spinner" style={{ width: '22px', height: '22px', borderWidth: '2.5px', borderColor: 'rgba(255,255,255,0.4)', borderTopColor: '#fff' }} />
                  ) : step === 4 ? (
                    <>
                      <CheckCircle2 size={20} />
                      <span>Confirm OPD Appointment</span>
                    </>
                  ) : (
                    <>
                      <span>Continue</span>
                      <ArrowRight size={20} />
                    </>
                  )}
                </button>
              )}

              {step === 4 && (
                <p
                  style={{
                    margin: '10px 0 0',
                    fontSize: '12.5px',
                    color: 'var(--text-secondary)',
                    textAlign: 'center',
                  }}
                >
                  Reports are optional — you can also add them later from My Visits.
                </p>
              )}
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
