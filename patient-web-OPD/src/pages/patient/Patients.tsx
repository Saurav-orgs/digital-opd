import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { User, Trash2, Plus, Check } from 'lucide-react';
import { patientApi } from '../../patientApi';
import { usePatientAuth } from '../../auth/PatientAuthContext';
import { ApiException, type PatientDetailsInput, type PatientProfile } from '../../types';
import { ConfirmDialog } from '../../components/ConfirmDialog';

/**
 * Everyone registered on this number — add, switch to, or remove.
 *
 * Deleting is the only way to undo a duplicate, since nothing in this system
 * merges patient records. It stays available exactly until an OPD is completed;
 * after that the record carries real clinical history and the button is
 * disabled with the reason shown.
 */
export const Patients: React.FC = () => {
  const { profiles, selected, selectProfile, refreshProfiles } = usePatientAuth();
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PatientProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => patientApi.deleteProfile(id),
    onSuccess: () => {
      setDeleteTarget(null);
      return refreshProfiles();
    },
    onError: (err) =>
      setError(
        err instanceof ApiException ? err.message : 'Could not delete this patient.',
      ),
  });

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>
        Patients on this number
      </h2>
      <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: 14 }}>
        Each person has their own visits, reports and summaries. Two people may
        share a name — they are still separate records.
      </p>

      {error && (
        <div className="error-text" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
        {profiles.map((p) => (
          <div key={p.id} className="section-card" style={{ padding: 14 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontWeight: 700,
                  }}
                >
                  <User size={15} color="var(--primary)" />
                  {p.name}
                  {selected?.id === p.id && (
                    <span
                      className="fee-badge"
                      style={{ background: '#DCFCE7', color: '#166534' }}
                    >
                      <Check size={11} /> Viewing
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                  {[p.last_age != null ? `${p.last_age} yrs` : null, p.gender, p.patient_code]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  {p.visit_count === 0
                    ? 'No visits yet'
                    : `${p.visit_count} visit${p.visit_count > 1 ? 's' : ''}` +
                      (p.last_visit_date ? ` · last ${p.last_visit_date}` : '')}
                </div>
                {[p.address_line, p.city, p.state, p.pincode].some(Boolean) && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                    {[p.address_line, p.city, p.state, p.pincode].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selected?.id !== p.id && (
                  <button
                    type="button"
                    className="btn-outlined"
                    style={{ padding: '5px 12px', fontSize: 13 }}
                    onClick={() => selectProfile(p.id)}
                  >
                    View
                  </button>
                )}
                <button
                  type="button"
                  className="btn-outlined"
                  disabled={!p.can_delete || remove.isPending}
                  title={
                    p.can_delete
                      ? 'Delete this patient'
                      : 'This patient has a completed OPD and can no longer be deleted.'
                  }
                  style={{
                    padding: '5px 12px',
                    fontSize: 13,
                    color: p.can_delete ? 'var(--error)' : 'var(--text-secondary)',
                    borderColor: p.can_delete ? '#FCA5A5' : 'var(--border)',
                  }}
                  onClick={() => {
                    setError(null);
                    setDeleteTarget(p);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete ${deleteTarget.name}?`}
          destructive
          confirmLabel="Delete patient"
          busy={remove.isPending}
          message={
            <>
              Any upcoming bookings for {deleteTarget.name} will be cancelled and
              their reports removed. This cannot be undone.
            </>
          }
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => remove.mutate(deleteTarget.id)}
        />
      )}

      {adding ? (
        <AddPatientForm
          onCancel={() => setAdding(false)}
          onAdded={async (id) => {
            setAdding(false);
            await refreshProfiles();
            selectProfile(id);
          }}
        />
      ) : (
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
          <Plus size={18} />
          <span>Add a patient</span>
        </button>
      )}
    </div>
  );
};

const AddPatientForm: React.FC<{
  onCancel: () => void;
  onAdded: (id: string) => void;
}> = ({ onCancel, onAdded }) => {
  const [form, setForm] = useState<PatientDetailsInput>({
    name: '',
    gender: '',
    address_line: '',
    city: '',
    state: '',
    pincode: '',
  });
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof PatientDetailsInput, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const add = useMutation({
    mutationFn: () => patientApi.addProfile(form),
    onSuccess: (created) => onAdded(created.id),
    onError: (err) =>
      setError(err instanceof ApiException ? err.message : 'Could not add this patient.'),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.name.trim().length < 2) return setError('Please enter the patient’s name.');
    if (form.address_line.trim().length < 3) return setError('Please enter the address.');
    if (form.city.trim().length < 2) return setError('Please enter the city.');
    if (form.state.trim().length < 2) return setError('Please enter the state.');
    if (!/^[1-9]\d{5}$/.test(form.pincode.trim())) {
      return setError('Enter a valid 6-digit PIN code.');
    }
    add.mutate();
  };

  return (
    <form className="section-card" onSubmit={submit}>
      <h3 className="card-section-title">
        <User size={18} color="var(--primary)" />
        <span>Add a patient</span>
      </h3>

      <div className="form-field">
        <label className="form-label">Full Name *</label>
        <input
          className="form-input"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Enter full name"
        />
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div className="form-field" style={{ flex: 1 }}>
          <label className="form-label">Gender</label>
          <select
            className="form-input"
            value={form.gender ?? ''}
            onChange={(e) => set('gender', e.target.value)}
          >
            <option value="">Select</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="form-field" style={{ flex: 1 }}>
          <label className="form-label">Relation</label>
          <select
            className="form-input"
            value={form.relation ?? ''}
            onChange={(e) => set('relation', e.target.value)}
          >
            <option value="">Select</option>
            <option value="self">Self</option>
            <option value="spouse">Spouse</option>
            <option value="child">Child</option>
            <option value="parent">Parent</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">Address *</label>
        <textarea
          className="form-input"
          rows={2}
          value={form.address_line}
          onChange={(e) => set('address_line', e.target.value)}
          placeholder="House / street"
        />
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div className="form-field" style={{ flex: 1 }}>
          <label className="form-label">City *</label>
          <input
            className="form-input"
            value={form.city}
            onChange={(e) => set('city', e.target.value)}
          />
        </div>
        <div className="form-field" style={{ flex: 1 }}>
          <label className="form-label">State *</label>
          <input
            className="form-input"
            value={form.state}
            onChange={(e) => set('state', e.target.value)}
          />
        </div>
        <div className="form-field" style={{ flex: 1 }}>
          <label className="form-label">PIN Code *</label>
          <input
            className="form-input"
            inputMode="numeric"
            maxLength={6}
            value={form.pincode}
            onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </div>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10 }}>
        <button type="submit" className="btn-primary" disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add patient'}
        </button>
        <button type="button" className="btn-outlined" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
};
