import React, { useRef, useState } from 'react';
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
} from 'lucide-react';
import { api } from '../api';
import { patientApi, patientTokenStore } from '../patientApi';
import type { Doctor, Slot } from '../types';
import { ApiException } from '../types';
import { NetworkAvatar } from '../components/NetworkAvatar';
import { usePatientAuth } from '../auth/PatientAuthContext';

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
  onChange: (next: StagedReport[]) => void;
  warning: string | null;
  onWarning: (w: string | null) => void;
}> = ({ staged, onChange, warning, onWarning }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');

  const add = () => {
    const file = fileRef.current?.files?.[0];
    if (!title.trim()) return onWarning('Please enter a title for this report.');
    if (!file) return onWarning('Please choose a file to add.');
    if (file.size > MAX_REPORT_BYTES) {
      return onWarning('That file is larger than 5 MB. Please choose a smaller one.');
    }
    onChange([
      ...staged,
      { id: `${file.name}-${Date.now()}`, title: title.trim(), file },
    ]);
    setTitle('');
    if (fileRef.current) fileRef.current.value = '';
    onWarning(null);
  };

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {staged.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 13,
              }}
            >
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
                onClick={() => onChange(staged.filter((s) => s.id !== r.id))}
                aria-label={`Remove ${r.title}`}
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

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
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <input ref={fileRef} type="file" accept={ACCEPTED_TYPES} style={{ marginBottom: 12 }} />

      <div>
        <button type="button" className="btn-secondary" onClick={add}>
          Add this report
        </button>
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

  const { patient } = usePatientAuth();

  // Two steps: patient details, then optional reports. The appointment is only
  // created on the final confirm, since reports must attach to a real visit.
  const [step, setStep] = useState<1 | 2>(1);
  const [staged, setStaged] = useState<StagedReport[]>([]);
  const [reportWarning, setReportWarning] = useState<string | null>(null);

  const [mobile, setMobile] = useState(patient?.mobile ?? '');
  const [name, setName] = useState(patient?.name ?? '');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [genderError, setGenderError] = useState<string | null>(null);
  const [ageError, setAgeError] = useState<string | null>(null);

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

  const validate = () => {
    let valid = true;
    const m = mobile.trim();
    const n = name.trim();

    if (!m) {
      setMobileError('Mobile number is required.');
      valid = false;
    } else if (!/^[6-9]\d{9}$/.test(m)) {
      setMobileError('Enter a valid 10-digit mobile number.');
      valid = false;
    } else {
      setMobileError(null);
    }

    if (!n || n.length < 2) {
      setNameError('Please enter your full name.');
      valid = false;
    } else {
      setNameError(null);
    }

    if (!gender) {
      setGenderError('Please select a gender.');
      valid = false;
    } else {
      setGenderError(null);
    }

    const ageNum = Number(age);
    if (!age.trim() || !Number.isInteger(ageNum) || ageNum < 0 || ageNum > 120) {
      setAgeError('Enter a valid age.');
      valid = false;
    } else {
      setAgeError(null);
    }

    return valid;
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
  const attachStagedReports = async (appointmentId: string): Promise<string | null> => {
    if (staged.length === 0) return null;

    try {
      if (!patientTokenStore.get()) {
        const session = await patientApi.login(mobile.trim(), doctor.id);
        patientTokenStore.set(session.accessToken);
      }
    } catch {
      return 'Your appointment is booked, but we could not attach your reports. You can add them from My Visits.';
    }

    let failed = 0;
    for (const r of staged) {
      try {
        await patientApi.uploadVisitReport(appointmentId, r.title, r.file);
      } catch {
        failed += 1;
      }
    }
    if (failed === 0) return null;
    return `Your appointment is booked, but ${failed} of ${staged.length} report(s) could not be uploaded. You can add them from My Visits.`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!validate()) return;

    // Details are valid but the patient hasn't seen the reports step yet.
    if (step === 1) {
      setStep(2);
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.bookAppointment({
        doctorId: doctor.id,
        date,
        startTime: slot.startTime,
        patientName: name.trim(),
        patientMobile: mobile.trim(),
        patientGender: gender,
        patientAge: Number(age),
        patientAddress: address.trim(),
        description: description.trim(),
      });

      const reportsWarning = await attachStagedReports(result.id);

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
          setStep(1); // the problem is with the details, so send them back
        }
      } else {
        setFormError('Something went wrong. Please try again.');
        setStep(1);
      }
    }
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div className="booking-header-row">
        <div>
          <div className="step-badge-text">
            Step {step} of 2 · {step === 1 ? 'Patient Details' : 'Reports (optional)'}
          </div>
          <h2 style={{ fontSize: '26px', fontWeight: 800, margin: 0, color: 'var(--text)' }}>
            Complete Your Booking
          </h2>
        </div>

        <button
          type="button"
          className="btn-outlined"
          onClick={() => {
            if (step === 2) return setStep(1);
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
          {/* Kept mounted while on step 2 so the typed details survive a Back. */}
          <div className="section-card" style={{ display: step === 1 ? undefined : 'none' }}>
            <h3 className="card-section-title">
              <User size={18} color="var(--primary)" />
              <span>Patient Information</span>
            </h3>

            <div className="form-field">
              <label className="form-label icon-label">
                <Phone size={14} color="var(--text-secondary)" />
                <span>Mobile Number *</span>
              </label>
              <input
                type="tel"
                className={'form-input' + (mobileError ? ' error' : '')}
                placeholder="10-digit mobile number"
                maxLength={10}
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
              />
              {mobileError && <span className="error-text">{mobileError}</span>}
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
                <span>Residential Address (optional)</span>
              </label>
              <textarea
                className="form-input"
                rows={2}
                placeholder="Enter city / street address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
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

          {step === 2 && (
            <ReportsStep
              staged={staged}
              onChange={setStaged}
              warning={reportWarning}
              onWarning={setReportWarning}
            />
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
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? (
                  <div className="spinner" style={{ width: '22px', height: '22px', borderWidth: '2.5px', borderColor: 'rgba(255,255,255,0.4)', borderTopColor: '#fff' }} />
                ) : step === 1 ? (
                  <>
                    <span>Continue</span>
                    <ArrowRight size={20} />
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={20} />
                    <span>Confirm OPD Appointment</span>
                  </>
                )}
              </button>

              {step === 2 && (
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
