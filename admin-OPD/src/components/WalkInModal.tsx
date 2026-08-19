import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi } from '../api/endpoints';
import type { Slot } from '../api/types';
import { useToast } from './Toast';
import { Field, Modal } from './ui';
import { InlineSlotPicker } from './InlineSlotPicker';

/**
 * Doctor-created, in-clinic booking — the web equivalent of the Flutter app's
 * `WalkInFormScreen`. Payment is handled in person, so there's nothing to
 * collect here beyond patient details and a slot.
 */
export function WalkInModal({ doctorId, onClose }: { doctorId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();

  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);

  const mobileValid = /^[6-9]\d{9}$/.test(mobile.trim());
  const nameValid = name.trim().length >= 2;
  const ageNum = Number(age);
  const ageValid = age.trim() !== '' && Number.isInteger(ageNum) && ageNum >= 0 && ageNum <= 120;
  const canSubmit = mobileValid && nameValid && !!gender && ageValid && !!date && !!slot;

  const book = useMutation({
    mutationFn: () =>
      appointmentsApi.bookWalkIn({
        doctor_id: doctorId,
        appointment_date: date,
        start_time: slot!.start_time,
        patient_name: name.trim(),
        patient_mobile: mobile.trim(),
        patient_gender: gender,
        patient_age: ageNum,
        patient_address: address.trim() || undefined,
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
      <Field label="Address (optional)">
        <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
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
