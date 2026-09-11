import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi, patientProfilesApi } from '../api/endpoints';
import type { PatientProfile } from '../api/types';
import { useToast } from './Toast';
import { Field, Modal } from './ui';
import { initials } from '../lib/avatar';

/**
 * How many people one number may register. Mirrors the server's own cap — the
 * server is the one that enforces it; this only keeps the desk from filling in
 * a form that was always going to be refused.
 */
const MAX_PATIENTS_PER_NUMBER = 5;

type Step = 'phone' | 'patients' | 'newPatient' | 'reason';

/** Age in whole years from a YYYY-MM-DD birth date, for display only. */
function ageFromDob(dob: string): string {
  if (!dob) return '';
  const born = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(born.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const monthDelta = now.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) age--;
  return age >= 0 && age <= 120 ? String(age) : '';
}

function describe(p: PatientProfile): string {
  const age = p.dob ? ageFromDob(p.dob) : p.last_age != null ? String(p.last_age) : '';
  return [p.gender, age && `${age} yrs`].filter(Boolean).join(' · ');
}

/**
 * Doctor-created, in-clinic booking — and a full patient registration.
 *
 * Four steps rather than one long form, because the desk is answering four
 * questions in order and only the first one is always the same: whose number
 * is this, which of the people on it is here, are they new, and what have they
 * come in for.
 *
 * **No date and no time.** The patient is standing there, and the doctor sees
 * walk-ins between bookings and after hours alike, so asking when the visit is
 * only ever produced a form field that said "now". The server stamps its own
 * clock and nudges to the next free minute if two people arrive together.
 *
 * A walk-in creates the same account and patient rows a self-booking does, so
 * the patient can log in with this number afterwards and find the visit, its
 * reports and its prescription waiting.
 */
export function WalkInModal({ doctorId, onClose }: { doctorId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [step, setStep] = useState<Step>('phone');
  const [mobile, setMobile] = useState('');
  // The number actually looked up — not the box, which may have moved on.
  const [lookedUp, setLookedUp] = useState('');
  // '' = a new patient. Never a name lookup: an identical name on the same
  // number is a different person unless the front desk picks their card.
  const [profileId, setProfileId] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState('female');
  const [dob, setDob] = useState('');
  const [description, setDescription] = useState('');

  const mobileValid = /^[6-9]\d{9}$/.test(mobile.trim());

  const patientsQ = useQuery({
    queryKey: ['patients-by-mobile', lookedUp],
    queryFn: () => patientProfilesApi.byMobile(lookedUp),
    enabled: /^[6-9]\d{9}$/.test(lookedUp),
  });
  const patients = patientsQ.data ?? [];
  const atLimit = patients.length >= MAX_PATIENTS_PER_NUMBER;

  // A different number means a different family; drop any stale selection.
  useEffect(() => {
    setProfileId('');
  }, [lookedUp]);

  const selected = patients.find((p) => p.id === profileId) ?? null;

  const book = useMutation({
    mutationFn: () =>
      appointmentsApi.bookWalkIn({
        doctor_id: doctorId,
        ...(profileId
          ? { patient_profile_id: profileId }
          : { patient_dob: dob || undefined }),
        patient_name: (selected?.name ?? name).trim(),
        patient_mobile: lookedUp,
        patient_gender: (selected?.gender ?? gender).toLowerCase(),
        description: description.trim() || undefined,
      }),
    onSuccess: (appointment) => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['patients'] });
      toast.success(
        `Walk-in booked for ${appointment.patient_name}`,
        appointment.start_time ? `Today at ${appointment.start_time.slice(0, 5)}` : undefined,
      );
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  const lookUp = () => {
    if (!mobileValid) return;
    setLookedUp(mobile.trim());
    setStep('patients');
  };

  const newPatientValid = name.trim().length >= 2 && !!dob;

  // The footer button is the whole navigation: one action per step, labelled
  // for what it does there.
  const cta = (() => {
    switch (step) {
      case 'phone':
        return { label: 'Check number', disabled: !mobileValid, run: lookUp };
      case 'patients':
        return {
          label: 'Continue',
          disabled: !profileId,
          run: () => setStep('reason'),
        };
      case 'newPatient':
        return {
          label: book.isPending ? 'Booking…' : 'Book appointment',
          disabled: !newPatientValid || book.isPending,
          run: () => book.mutate(),
        };
      default:
        return {
          label: book.isPending ? 'Booking…' : 'Book appointment',
          disabled: book.isPending,
          run: () => book.mutate(),
        };
    }
  })();

  return (
    <Modal
      title="Walk-in appointment"
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary walkin-cta"
          disabled={cta.disabled}
          onClick={cta.run}
        >
          {cta.label}
        </button>
      }
    >
      {step === 'phone' && (
        <>
          <Field label="Mobile number">
            <input
              className="input"
              inputMode="numeric"
              autoFocus
              placeholder="98xxxxxxxx"
              value={mobile}
              maxLength={10}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') lookUp();
              }}
            />
          </Field>
        </>
      )}

      {step === 'patients' && (
        <>
          <button className="wizard-back" onClick={() => setStep('phone')}>
            ← Change number
          </button>
          <div className="wizard-summary">
            <b>{lookedUp}</b>
          </div>

          {patientsQ.isLoading ? (
            <p className="muted" style={{ fontSize: 13 }}>Looking up this number…</p>
          ) : patients.length ? (
            <>
              <div className="wizard-label">
                {patients.length} patient{patients.length === 1 ? '' : 's'} registered
                on this number
              </div>
              <div className="member-list">
                {patients.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`member-chip ${profileId === p.id ? 'selected' : ''}`}
                    onClick={() => setProfileId(p.id)}
                  >
                    <span className="member-avatar" aria-hidden>
                      {initials(p.name)}
                    </span>
                    <span className="member-text">
                      <span className="member-name">{p.name}</span>
                      <span className="member-rel">{describe(p) || p.patient_code}</span>
                    </span>
                    <span className="member-radio" aria-hidden />
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>
              No patients registered on this number yet.
            </p>
          )}

          {atLimit ? (
            <p className="field-err" style={{ marginTop: 12 }}>
              This number already has {MAX_PATIENTS_PER_NUMBER} registered patients,
              the maximum allowed.
            </p>
          ) : (
            <button className="wizard-link" onClick={() => setStep('newPatient')}>
              + Add a new patient
            </button>
          )}
        </>
      )}

      {step === 'newPatient' && (
        <>
          <button className="wizard-back" onClick={() => setStep('patients')}>
            ← Back
          </button>
          <div className="wizard-label">New patient details</div>

          <Field label="Full name *">
            <input
              className="input"
              autoFocus
              placeholder="e.g. Priya Verma"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Gender *">
            <div className="gender-row">
              {['female', 'male', 'other'].map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`gender-opt ${gender === g ? 'selected' : ''}`}
                  onClick={() => setGender(g)}
                >
                  {g === 'female' ? 'Female' : g === 'male' ? 'Male' : 'Other'}
                </button>
              ))}
            </div>
          </Field>

          {/* Date of birth, not age: an age typed at the desk is wrong within a
              year, and this record outlives the visit. */}
          <Field label="Date of birth *">
            <input
              className="input"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />
            {dob && ageFromDob(dob) && (
              <span className="hint">{ageFromDob(dob)} years old</span>
            )}
          </Field>

          <Field label="Reason for visit">
            <input
              className="input"
              placeholder="e.g. Fever, follow-up, routine checkup"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </>
      )}

      {step === 'reason' && selected && (
        <>
          <button className="wizard-back" onClick={() => setStep('patients')}>
            ← Back
          </button>
          <div className="wizard-summary">
            <b>{selected.name}</b>
            <br />
            {[describe(selected), lookedUp].filter(Boolean).join(' · ')}
          </div>

          <Field label="Reason for visit">
            <input
              className="input"
              autoFocus
              placeholder="e.g. Fever, follow-up, routine checkup"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </>
      )}

    </Modal>
  );
}
