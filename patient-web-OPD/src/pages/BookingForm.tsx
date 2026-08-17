import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  User,
  Phone,
  MapPin,
  FileText,
  Upload,
  Image as ImageIcon,
  ShieldCheck,
  QrCode,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../api';
import { AppConfig } from '../config';
import type { Doctor, Slot } from '../types';
import { ApiException } from '../types';
import { NetworkAvatar } from '../components/NetworkAvatar';
import { usePatientAuth } from '../auth/PatientAuthContext';

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

  const [mobile, setMobile] = useState(patient?.mobile ?? '');
  const [name, setName] = useState(patient?.name ?? '');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');

  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [genderError, setGenderError] = useState<string | null>(null);
  const [ageError, setAgeError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > AppConfig.maxUploadMb) {
      setScreenshot(null);
      setPreviewUrl(null);
      setFileError('Image is too large. Choose a screenshot up to ' + AppConfig.maxUploadMb + ' MB.');
      return;
    }

    setScreenshot(file);
    setPreviewUrl(URL.createObjectURL(file));
    setFileError(null);
  };

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

    if (!screenshot) {
      setFileError('Please upload your payment screenshot to confirm.');
      valid = false;
    } else {
      setFileError(null);
    }

    return valid;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!validate()) return;

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
        screenshot: screenshot!,
      });

      navigate('/confirmation', {
        replace: true,
        state: { result, doctor },
      });
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiException) {
        if (err.code === 'SLOT_ALREADY_BOOKED' || err.code === 'SLOT_IN_PAST') {
          alert(err.message);
          navigate(-1);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    }
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div className="booking-header-row">
        <div>
          <div className="step-badge-text">
            Patient Details
          </div>
          <h2 style={{ fontSize: '26px', fontWeight: 800, margin: 0, color: 'var(--text)' }}>
            Complete Your Booking
          </h2>
        </div>

        <button
          type="button"
          className="btn-outlined"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          style={{ borderRadius: '999px', padding: '8px 20px' }}
        >
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="booking-grid">
          <div className="section-card">
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

            {doctor.paymentQrUrl && (
              <div className="section-card" style={{ textAlign: 'center' }}>
                <div className="qr-header-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '15px' }}>
                    <QrCode size={18} color="var(--primary)" />
                    <span>Scan & Pay via UPI</span>
                  </div>
                  {doctor.consultationFee && (
                    <span className="fee-badge">₹{doctor.consultationFee} Fee</span>
                  )}
                </div>

                <div className="qr-img-box">
                  <img
                    src={doctor.paymentQrUrl}
                    alt="UPI Payment QR Code"
                    style={{ maxHeight: '200px', maxWidth: '100%', objectFit: 'contain', borderRadius: '8px' }}
                  />
                </div>

                <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '10px', margin: '10px 0 0 0' }}>
                  Scan using Google Pay, PhonePe, Paytm, or BHIM UPI app.
                </p>
              </div>
            )}

            <div className="section-card">
              <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Upload size={18} color="var(--primary)" />
                <span>Upload Payment Screenshot *</span>
              </div>

              {previewUrl && (
                <div style={{ marginBottom: '14px', borderRadius: 'var(--radius-control)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <img
                    src={previewUrl}
                    alt="Payment screenshot preview"
                    style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', display: 'block' }}
                  />
                </div>
              )}

              <label className="btn-outlined" style={{ width: '100%', justifyContent: 'center', cursor: 'pointer' }}>
                {previewUrl ? <ImageIcon size={18} /> : <Upload size={18} />}
                <span>{previewUrl ? 'Change Screenshot File' : 'Browse & Upload Screenshot'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
              </label>

              {fileError && <div className="error-text" style={{ marginTop: '8px' }}>{fileError}</div>}

              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center' }}>
                Supported: JPG, PNG, WebP · Max size {AppConfig.maxUploadMb} MB.
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
                ) : (
                  <>
                    <CheckCircle2 size={20} />
                    <span>Confirm OPD Appointment</span>
                  </>
                )}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '12px' }}>
                <ShieldCheck size={15} color="#10B981" />
                <span>Your booking will be verified by clinic staff immediately.</span>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
