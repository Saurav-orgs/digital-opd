import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi, patientProfilesApi } from '../api/endpoints';
import type { PatientProfile, Slot } from '../api/types';
import { useToast } from './Toast';
import { Field, Modal } from './ui';
import { InlineSlotPicker } from './InlineSlotPicker';

/**
 * Doctor-created, in-clinic booking — and a full patient registration.
 *
 * A walk-in creates the same account and patient rows a self-booking does, so
 * the patient can log in with this number afterwards and find the visit, its
 * reports and its prescription waiting. That is why the address is required
 * here and why the number is entered first: one number may already carry
 * several family members, and the front desk must say which one this is.
 */
export function WalkInModal({ doctorId, onClose }: { doctorId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [mobile, setMobile] = useState('');
  // '' = a new patient. Never a name lookup: an identical name on the same
  // number is a different person unless the front desk picks their card.
  const [profileId, setProfileId] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [pincode, setPincode] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);

  const mobileValid = /^[6-9]\d{9}$/.test(mobile.trim());

  const patientsQ = useQuery({
    queryKey: ['patients-by-mobile', mobile.trim()],
    queryFn: () => patientProfilesApi.byMobile(mobile.trim()),
    enabled: mobileValid,
  });
  const patients = patientsQ.data ?? [];

  // Picking an existing patient prefills their details; they stay editable,
  // since people move and ages change between visits.
  const applyPatient = (p: PatientProfile | null) => {
    setName(p?.name ?? '');
    setGender(p?.gender ?? '');
    setAge(p?.last_age != null ? String(p.last_age) : '');
    setAddress(p?.address_line ?? '');
    setCity(p?.city ?? '');
    setStateName(p?.state ?? '');
    setPincode(p?.pincode ?? '');
  };

  // A different number means a different family; drop any stale selection.
  useEffect(() => {
    setProfileId('');
    applyPatient(null);
  }, [mobile]);

  const nameValid = name.trim().length >= 2;
  const ageNum = Number(age);
  const ageValid = age.trim() !== '' && Number.isInteger(ageNum) && ageNum >= 0 && ageNum <= 120;
  const addressValid =
    address.trim().length >= 3 &&
    city.trim().length >= 2 &&
    stateName.trim().length >= 2 &&
    /^[1-9]\d{5}$/.test(pincode.trim());
  const canSubmit =
    mobileValid && nameValid && !!gender && ageValid && addressValid && !!date && !!slot;

  const book = useMutation({
    mutationFn: () =>
      appointmentsApi.bookWalkIn({
        doctor_id: doctorId,
        appointment_date: date,
        start_time: slot!.start_time,
        ...(profileId ? { patient_profile_id: profileId } : {}),
        patient_name: name.trim(),
        patient_mobile: mobile.trim(),
        patient_gender: gender,
        patient_age: ageNum,
        patient_address: address.trim(),
        patient_city: city.trim(),
        patient_state: stateName.trim(),
        patient_pincode: pincode.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Walk-in booked');
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  return (
    <Modal title="Book a walk-in" onClose={onClose} large>
      <div className="grid cols-2">
        <Field label="Mobile number *">
          <input
            className="input"
            value={mobile}
            maxLength={10}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field label="Patient *">
          <select
            className="select"
            value={profileId}
            disabled={!mobileValid}
            onChange={(e) => {
              setProfileId(e.target.value);
              applyPatient(patients.find((p) => p.id === e.target.value) ?? null);
            }}
          >
            <option value="">
              {patients.length ? '+ New patient on this number' : 'New patient'}
            </option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.patient_code}
                {p.last_age != null ? ` · ${p.last_age} yrs` : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid cols-2">
        <Field label="Patient name *">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Gender *">
          <select className="select" value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">Select</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Age *">
          <input
            className="input"
            type="number"
            min={0}
            max={120}
            value={age}
            onChange={(e) => setAge(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Address *">
        <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <div className="grid cols-2">
        <Field label="City *">
          <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label="State *">
          <input
            className="input"
            value={stateName}
            onChange={(e) => setStateName(e.target.value)}
          />
        </Field>
        <Field label="PIN code *">
          <input
            className="input"
            inputMode="numeric"
            maxLength={6}
            value={pincode}
            onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </Field>
      </div>
      <Field label="Reason for visit (optional)">
        <textarea
          className="input"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div style={{ marginTop: 8 }}>
        <div className="card-title" style={{ marginBottom: 8 }}>Pick a slot *</div>
        <InlineSlotPicker doctorId={doctorId} onChange={(d, s) => { setDate(d); setSlot(s); }} />
      </div>

      <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
        This registers the patient — they can log in with this number afterwards
        to see the visit, its reports and the prescription.
      </p>

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn btn-primary"
          disabled={!canSubmit || book.isPending}
          onClick={() => book.mutate()}
        >
          {book.isPending ? 'Booking…' : 'Book walk-in'}
        </button>
      </div>
    </Modal>
  );
}
