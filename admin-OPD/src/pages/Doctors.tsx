import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doctorsApi } from '../api/endpoints';
import type { CreateDoctorResult, Doctor } from '../api/types';
import { Badge, Empty, Loading } from '../components/ui';

export default function DoctorsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editDoctor, setEditDoctor] = useState<Doctor | null>(null);
  const [createdResult, setCreatedResult] = useState<CreateDoctorResult | null>(null);
  const [resetDoctor, setResetDoctor] = useState<Doctor | null>(null);

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
              onResetPassword={() => setResetDoctor(d)}
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

      {resetDoctor && (
        <ResetPasswordModal
          doctor={resetDoctor}
          onClose={() => setResetDoctor(null)}
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
  onResetPassword,
  onDelete,
  deleting,
}: {
  doctor: Doctor;
  onToggle: (enable: boolean) => void;
  onRotateQr: () => void;
  onResetPassword: () => void;
  rotating: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const defaultBase = window.location.origin.replace(':5173', ':5174');
  const base = doctor.profile_base_url ? doctor.profile_base_url.replace(/\/+$/, '') : defaultBase;
  const qrUrl = doctor.booking_url || `${base}/d/${doctor.public_slug}`;

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

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
        {doctor.qr_code_url && (
          <a href={doctor.qr_code_url} target="_blank" rel="noreferrer" title="Click to view full QR">
            <img
              src={doctor.qr_code_url}
              alt="Doctor QR"
              style={{ width: 44, height: 44, objectFit: 'contain', borderRadius: 6, border: 'var(--hairline)', background: '#fff' }}
            />
          </a>
        )}
        <div style={{ flex: 1, padding: '8px 12px', background: 'var(--surface-2, #f4f4f5)', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {qrUrl}
        </div>
      </div>

      <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
        <button
          className={`btn btn-sm ${doctor.is_enabled ? '' : 'btn-primary'}`}
          onClick={() => onToggle(!doctor.is_enabled)}
        >
          {doctor.is_enabled ? 'Disable' : 'Enable'}
        </button>
        <button className="btn btn-sm" onClick={onEdit}>
          Edit & QR
        </button>
        <button
          className="btn btn-sm"
          onClick={onRotateQr}
          disabled={rotating}
          title="Generate a new QR slug — old QR links stop working"
        >
          {rotating ? 'Rotating…' : 'Rotate Slug'}
        </button>
        <button
          className="btn btn-sm"
          onClick={() => navigator.clipboard.writeText(qrUrl)}
        >
          Copy link
        </button>
        <button
          className="btn btn-sm"
          onClick={onResetPassword}
          title="Set a new login password for this doctor"
        >
          Reset password
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
  const qrRef = useRef<HTMLInputElement>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(doctor.qr_code_url ?? null);
  const [form, setForm] = useState({
    name: doctor.name ?? '',
    specialization: doctor.specialization ?? '',
    qualifications: doctor.qualifications ?? '',
    bio: doctor.bio ?? '',
    consultation_fee: doctor.consultation_fee != null ? String(doctor.consultation_fee) : '',
    profile_base_url: doctor.profile_base_url ?? '',
  });
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: () =>
      doctorsApi.update(doctor.id, {
        name: form.name.trim(),
        specialization: form.specialization.trim() || undefined,
        qualifications: form.qualifications.trim() || undefined,
        bio: form.bio.trim() || undefined,
        profile_base_url: form.profile_base_url.trim() || undefined,
        consultation_fee: form.consultation_fee.trim()
          ? Number(form.consultation_fee)
          : undefined,
      }),
    onSuccess: onSaved,
    onError: (e: any) => setError(e?.message ?? 'Something went wrong.'),
  });

  const uploadQrMut = useMutation({
    mutationFn: (file: File) => doctorsApi.uploadQr(doctor.id, file),
    onSuccess: (updated) => {
      setQrCodeUrl(updated.qr_code_url ?? null);
    },
    onError: (e: any) => setError(e?.message ?? 'Could not upload QR code.'),
  });

  const removeQrMut = useMutation({
    mutationFn: () => doctorsApi.removeQr(doctor.id),
    onSuccess: () => {
      setQrCodeUrl(null);
    },
    onError: (e: any) => setError(e?.message ?? 'Could not remove QR code.'),
  });

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  const defaultBase = window.location.origin.replace(':5173', ':5174');
  const resolvedBase = form.profile_base_url ? form.profile_base_url.replace(/\/+$/, '') : defaultBase;
  const fullBookingUrl = `${resolvedBase}/d/${doctor.public_slug}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 16 }}>Edit doctor profile & QR</h2>

        <label className="form-label">Full name *</label>
        <input className="input" placeholder="Dr. Asha Rao" {...field('name')} />

        <label className="form-label" style={{ marginTop: 12 }}>Profile Base URL (Domain / Host)</label>
        <input
          className="input"
          placeholder={`e.g. https://booking.myclinic.com (default: ${defaultBase})`}
          {...field('profile_base_url')}
        />
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)' }}>
          Full doctor URL: <code style={{ wordBreak: 'break-all', background: 'var(--surface-2, #f4f4f5)', padding: '2px 4px', borderRadius: 4 }}>{fullBookingUrl}</code>
        </div>

        {/* ── Doctor Profile QR Code Section ── */}
        <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 8, border: 'var(--hairline)', background: 'var(--surface-2, #f8f9fa)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Doctor Profile QR Code</div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {qrCodeUrl ? (
              <img
                src={qrCodeUrl}
                alt="Doctor QR code"
                style={{ width: 68, height: 68, objectFit: 'contain', background: '#fff', borderRadius: 6, border: 'var(--hairline)' }}
              />
            ) : (
              <div style={{ width: 68, height: 68, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', borderRadius: 6, border: 'var(--hairline)', fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: 4 }}>
                No QR uploaded
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                ref={qrRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadQrMut.mutate(f);
                }}
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => qrRef.current?.click()}
                disabled={uploadQrMut.isPending}
              >
                {uploadQrMut.isPending ? 'Uploading…' : qrCodeUrl ? 'Change QR code image' : 'Upload QR code image'}
              </button>
              {qrCodeUrl && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ color: 'var(--danger, #dc2626)' }}
                  onClick={() => removeQrMut.mutate()}
                  disabled={removeQrMut.isPending}
                >
                  {removeQrMut.isPending ? 'Removing…' : 'Remove QR'}
                </button>
              )}
            </div>
          </div>
        </div>

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

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: 4 }}>
      {children}
    </p>
  );
}

/**
 * Super admin sets a new password for a doctor's own login.
 *
 * Shown once, like the credentials at creation: there is no email delivery in
 * this deployment, so a locked-out doctor gets back in by the super admin
 * reading the new password out to them. The doctor can then change it from
 * their own profile.
 */
function ResetPasswordModal({
  doctor,
  onClose,
}: {
  doctor: Doctor;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => doctorsApi.resetPassword(doctor.id, password),
    onSuccess: (res) => setDone(res),
    onError: (e: unknown) =>
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Could not reset the password.',
      ),
  });

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= 8 && confirm === password && !mut.isPending;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <h2 style={{ marginBottom: 4 }}>Password reset ✓</h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              Give these to {doctor.name} — the password is shown only once.
            </p>
            <InfoRow label="Login email" value={done.email} copyable />
            <InfoRow label="New password" value={done.password} copyable />
            <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
              Ask them to change it from <strong>My profile</strong> after they
              sign in.
            </p>
            <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <h2 style={{ marginBottom: 4 }}>Reset password</h2>
            <p className="muted" style={{ marginBottom: 16 }}>
              Sets a new login password for <strong>{doctor.name}</strong>. Their
              current password stops working immediately.
            </p>

            <label className="form-label">New password *</label>
            <input
              className="input"
              type="password"
              autoFocus
              placeholder="min 8 characters"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
            />
            {tooShort && <FieldError>Password must be at least 8 characters.</FieldError>}

            <label className="form-label" style={{ marginTop: 12 }}>
              Confirm password *
            </label>
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(null); }}
            />
            {mismatch && <FieldError>Passwords do not match.</FieldError>}
            {error && <FieldError>{error}</FieldError>}

            <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!canSubmit}
                onClick={() => mut.mutate()}
              >
                {mut.isPending ? 'Resetting…' : 'Reset password'}
              </button>
            </div>
          </>
        )}
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
