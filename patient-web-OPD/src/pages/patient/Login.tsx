import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Phone, User, MapPin, LogIn, UserPlus } from 'lucide-react';
import { usePatientAuth } from '../../auth/PatientAuthContext';
import { useDoctorCtx } from '../../context/DoctorContext';
import { ApiException } from '../../types';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register } = usePatientAuth();
  const { doctor } = useDoctorCtx();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [mobile, setMobile] = useState('');
  // Registering creates one patient, so it asks for a patient's full details —
  // the same set booking and the front desk collect.
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [pincode, setPincode] = useState('');
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
    if (mode === 'register') {
      if (name.trim().length < 2) return setError('Please enter the patient’s name.');
      if (!gender) return setError('Please select a gender.');
      const ageNum = Number(age);
      if (!age.trim() || !Number.isInteger(ageNum) || ageNum < 0 || ageNum > 120) {
        return setError('Enter a valid age.');
      }
      if (address.trim().length < 3) return setError('Please enter the address.');
      if (city.trim().length < 2) return setError('Please enter the city.');
      if (stateName.trim().length < 2) return setError('Please enter the state.');
      if (!/^[1-9]\d{5}$/.test(pincode.trim())) {
        return setError('Enter a valid 6-digit PIN code.');
      }
    }
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(mobile.trim(), doctor?.id);
      } else {
        await register(
          mobile.trim(),
          {
            name: name.trim(),
            gender,
            age: Number(age),
            address_line: address.trim(),
            city: city.trim(),
            state: stateName.trim(),
            pincode: pincode.trim(),
          },
          doctor?.id,
        );
      }
      navigate(redirectTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiException) {
        if (err.code === 'PATIENT_NOT_FOUND') {
          setMode('register');
          setError('No patient registered on this number. Add their details to register.');
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
            : "We didn't find this number — add the patient's details to register."}
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
            <>
              <div className="form-field">
                <label className="form-label icon-label">
                  <User size={14} color="var(--text-secondary)" />
                  <span>Patient’s Full Name</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="form-label">Gender</label>
                  <select
                    className="form-input"
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                  >
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="form-label">Age</label>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    className="form-input"
                    placeholder="Age"
                    value={age}
                    onChange={(e) => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  />
                </div>
              </div>

              <div className="form-field">
                <label className="form-label icon-label">
                  <MapPin size={14} color="var(--text-secondary)" />
                  <span>Address</span>
                </label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="House / street"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="form-label">City</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="City"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="form-label">State</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="State"
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="form-label">PIN Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="form-input"
                    placeholder="452001"
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>
              </div>
            </>
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
