import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doctorsApi } from '../api/endpoints';
import type { CreateDoctorResult, Doctor } from '../api/types';
import { Badge, Empty, Loading } from '../components/ui';

export default function DoctorsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editDoctor, setEditDoctor] = useState<Doctor | null>(null);
  const [createdResult, setCreatedResult] = useState<CreateDoctorResult | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['doctors'],
    queryFn: doctorsApi.list,
  });

  const enableMut = useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      enable ? doctorsApi.enable(id) : doctorsApi.disable(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctors'] }),
  });

  const slugMut = useMutation({
    mutationFn: (id: string) => doctorsApi.regenerateSlug(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctors'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => doctorsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctors'] }),
  });

  if (isLoading) return <Loading />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Doctors</h1>
          <p className="muted">Manage doctor tenants and their QR links.</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setShowCreate(true); setCreatedResult(null); }}>
          + New doctor
        </button>
      </div>

      {!data?.length ? (
        <Empty>No doctors yet. Create one to get started.</Empty>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {data.map((d) => (
            <DoctorCard
              key={d.id}
              doctor={d}
              onToggle={(enable) => enableMut.mutate({ id: d.id, enable })}
              onRotateQr={() => slugMut.mutate(d.id)}
              rotating={slugMut.isPending && slugMut.variables === d.id}
              onEdit={() => setEditDoctor(d)}
              onDelete={() => {
                if (window.confirm(`Remove Dr. ${d.name}? This cannot be undone.`)) {
                  deleteMut.mutate(d.id);
                }
              }}
              deleting={deleteMut.isPending && deleteMut.variables === d.id}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateDoctorModal
          onClose={() => setShowCreate(false)}
          onCreated={(result) => {
            setCreatedResult(result);
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['doctors'] });
          }}
        />
      )}

      {editDoctor && (
        <EditDoctorModal
          doctor={editDoctor}
          onClose={() => setEditDoctor(null)}
          onSaved={() => {
            setEditDoctor(null);
            qc.invalidateQueries({ queryKey: ['doctors'] });
          }}
        />
      )}

      {createdResult && (
        <CredentialsModal result={createdResult} onClose={() => setCreatedResult(null)} />
      )}
    </>
  );
}

function DoctorCard({
  doctor,
  onToggle,
  onRotateQr,
  rotating,
  onEdit,
  onDelete,
  deleting,
}: {
  doctor: Doctor;
  onToggle: (enable: boolean) => void;
  onRotateQr: () => void;
  rotating: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const qrUrl = `${window.location.origin.replace(':5173', ':5174')}/d/${doctor.public_slug}`;
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <strong style={{ fontWeight: 600, fontSize: 16 }}>{doctor.name}</strong>
          {doctor.specialization && (
            <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>{doctor.specialization}</p>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Badge value={doctor.is_enabled ? 'confirmed' : 'rejected'} label={doctor.is_enabled ? 'Active' : 'Disabled'} />
        </div>
      </div>

      <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--surface-2, #f4f4f5)', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>
        {qrUrl}
      </div>

      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
        <button
          className={`btn btn-sm ${doctor.is_enabled ? '' : 'btn-primary'}`}
          onClick={() => onToggle(!doctor.is_enabled)}
        >
          {doctor.is_enabled ? 'Disable' : 'Enable'}
        </button>
        <button className="btn btn-sm" onClick={onEdit}>
          Edit
        </button>
        <button
          className="btn btn-sm"
          onClick={onRotateQr}
          disabled={rotating}
          title="Generate a new QR slug — old QR links stop working"
        >
          {rotating ? 'Rotating…' : 'Rotate QR'}
        </button>
        <button
          className="btn btn-sm"
          onClick={() => navigator.clipboard.writeText(qrUrl)}
        >
          Copy link
        </button>
        <button
          className="btn btn-sm"
          style={{ color: 'var(--danger, #dc2626)', borderColor: 'var(--danger, #dc2626)' }}
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? 'Removing…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

function EditDoctorModal({
  doctor,
  onClose,
  onSaved,
}: {
  doctor: Doctor;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: doctor.name ?? '',
    specialization: doctor.specialization ?? '',
    qualifications: doctor.qualifications ?? '',
    bio: doctor.bio ?? '',
    consultation_fee: doctor.consultation_fee != null ? String(doctor.consultation_fee) : '',
  });
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      doctorsApi.update(doctor.id, {
        name: form.name.trim(),
        specialization: form.specialization.trim() || undefined,
        qualifications: form.qualifications.trim() || undefined,
        bio: form.bio.trim() || undefined,
        consultation_fee: form.consultation_fee.trim()
          ? Number(form.consultation_fee)
          : undefined,
      }),
    onSuccess: onSaved,
    onError: (e: any) => setError(e?.message ?? 'Something went wrong.'),
  });

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 16 }}>Edit doctor</h2>

        <label className="form-label">Full name *</label>
        <input className="input" placeholder="Dr. Asha Rao" {...field('name')} />

        <label className="form-label" style={{ marginTop: 12 }}>Specialization</label>
        <input className="input" placeholder="Cardiologist" {...field('specialization')} />

        <label className="form-label" style={{ marginTop: 12 }}>Qualifications</label>
        <input className="input" placeholder="MD, DM (Cardiology)" {...field('qualifications')} />

        <label className="form-label" style={{ marginTop: 12 }}>Consultation fee (₹)</label>
        <input className="input" type="number" min="0" placeholder="e.g. 500" {...field('consultation_fee')} />

        <label className="form-label" style={{ marginTop: 12 }}>Bio</label>
        <textarea
          className="input"
          placeholder="Brief description…"
          rows={3}
          style={{ resize: 'vertical' }}
          {...field('bio')}
        />

        {error && <p style={{ color: 'var(--danger, red)', marginTop: 8, fontSize: 13 }}>{error}</p>}

        <div className="row" style={{ marginTop: 20, gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.name.trim()}
          >
            {mut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateDoctorModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: CreateDoctorResult) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    specialization: '',
    qualifications: '',
  });
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      doctorsApi.create({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        specialization: form.specialization.trim() || undefined,
        qualifications: form.qualifications.trim() || undefined,
      }),
    onSuccess: onCreated,
    onError: (e: any) => setError(e?.message ?? 'Something went wrong.'),
  });

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 16 }}>Create doctor</h2>

        <label className="form-label">Full name *</label>
        <input className="input" placeholder="Dr. Asha Rao" {...field('name')} />

        <label className="form-label" style={{ marginTop: 12 }}>Login email *</label>
        <input className="input" type="email" placeholder="dr.asha@hospital.com" {...field('email')} />

        <label className="form-label" style={{ marginTop: 12 }}>Temporary password *</label>
        <input className="input" type="password" placeholder="min 8 characters" {...field('password')} />
        {form.password.length > 0 && form.password.length < 8 && (
          <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: 4 }}>
            Password must be at least 8 characters.
          </p>
        )}

        <label className="form-label" style={{ marginTop: 12 }}>Specialization</label>
        <input className="input" placeholder="Cardiologist" {...field('specialization')} />

        <label className="form-label" style={{ marginTop: 12 }}>Qualifications</label>
        <input className="input" placeholder="MD, DM (Cardiology)" {...field('qualifications')} />

        {error && <p style={{ color: 'var(--danger, red)', marginTop: 8, fontSize: 13 }}>{error}</p>}

        <div className="row" style={{ marginTop: 20, gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.name.trim() || !form.email.trim() || form.password.length < 8}
          >
            {mut.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CredentialsModal({
  result,
  onClose,
}: {
  result: CreateDoctorResult;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 4 }}>Doctor created ✓</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Share these credentials with {result.doctor.name} — they are shown only once.
        </p>

        <InfoRow label="Name" value={result.doctor.name} />
        <InfoRow label="Login email" value={result.login.email} copyable />
        <InfoRow label="Temp password" value={result.login.tempPassword} copyable />
        <InfoRow label="QR / booking link" value={result.qrUrl} copyable />

        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
          The doctor can change their password on first login. The QR link can be regenerated if needed.
        </p>

        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <code style={{ flex: 1, fontSize: 13, wordBreak: 'break-all', background: 'var(--surface-2, #f4f4f5)', padding: '4px 8px', borderRadius: 6 }}>
          {value}
        </code>
        {copyable && (
          <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(value)} style={{ flexShrink: 0 }}>
            Copy
          </button>
        )}
      </div>
    </div>
  );
}
