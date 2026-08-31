import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doctorsApi } from '../api/endpoints';
import type { CreateDoctorResult, Doctor, PendingDoctor } from '../api/types';
import { Badge, ConfirmDialog, Empty, Loading, PasswordInput } from '../components/ui';
import { useToast } from '../components/Toast';

const MAX_LICENSE_BYTES = 6 * 1024 * 1024;

export default function DoctorsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editDoctor, setEditDoctor] = useState<Doctor | null>(null);
  const [createdResult, setCreatedResult] = useState<CreateDoctorResult | null>(null);
  const [resetDoctor, setResetDoctor] = useState<Doctor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Doctor | null>(null);
  const [profileDoctor, setProfileDoctor] = useState<Doctor | null>(null);

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

      <PendingRegistrations />

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
              onViewProfile={() => setProfileDoctor(d)}
              onResetPassword={() => setResetDoctor(d)}
              onDelete={() => setDeleteTarget(d)}
              deleting={deleteMut.isPending && deleteMut.variables === d.id}
            />
          ))}
        </div>
      )}

      {profileDoctor && (
        <DoctorProfileModal
          doctorId={profileDoctor.id}
          onClose={() => setProfileDoctor(null)}
        />
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

      {deleteTarget && (
        <ConfirmDialog
          title="Remove doctor"
          destructive
          confirmLabel="Remove doctor"
          busy={deleteMut.isPending}
          message={
            <>
              Remove <strong>{deleteTarget.name}</strong>? Their login stops
              working and their booking link goes dead. This cannot be undone.
            </>
          }
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() =>
            deleteMut.mutate(deleteTarget.id, {
              onSuccess: () => setDeleteTarget(null),
            })
          }
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
  onViewProfile,
  onResetPassword,
  onDelete,
  deleting,
}: {
  doctor: Doctor;
  onToggle: (enable: boolean) => void;
  onRotateQr: () => void;
  onViewProfile: () => void;
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
        <button
          className="btn btn-sm"
          onClick={onViewProfile}
          title="Details, registration number and certificate"
        >
          View profile
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

/**
 * Read-only view of a doctor for the super admin: who they are, how to reach
 * them, and the certificate they registered with.
 *
 * The certificate is the reason this exists — until now an admin could create
 * a doctor but never look at their credentials again, and a self-registered
 * doctor's licence was only reachable from the pending-review panel, which
 * empties as soon as the registration is dealt with.
 *
 * Editing stays in Edit & QR. Uploading a certificate is allowed here because
 * a doctor created before this existed has none, and the profile is where an
 * admin notices that.
 */
function DoctorProfileModal({
  doctorId,
  onClose,
}: {
  doctorId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const profileQ = useQuery({
    queryKey: ['doctor-profile', doctorId],
    queryFn: () => doctorsApi.profile(doctorId),
  });

  const upload = useMutation({
    mutationFn: (file: File) => doctorsApi.uploadLicense(doctorId, file),
    onSuccess: () => {
      toast.success('Certificate uploaded');
      qc.invalidateQueries({ queryKey: ['doctor-profile', doctorId] });
      qc.invalidateQueries({ queryKey: ['doctors'] });
    },
    onError: (e: any) => setError(e?.message ?? 'Could not upload the certificate.'),
  });

  const d = profileQ.data;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 4 }}>{d?.name ?? 'Doctor profile'}</h2>
        {d?.specialization && (
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{d.specialization}</p>
        )}

        {profileQ.isLoading && <Loading />}
        {profileQ.isError && (
          <p style={{ color: 'var(--danger, red)', fontSize: 13 }}>
            Could not load this profile.
          </p>
        )}

        {d && (
          <>
            <div style={{ marginTop: 12, borderTop: 'var(--hairline)', paddingTop: 12 }}>
              <InfoRow label="Login email" value={d.login_email ?? '—'} copyable />
              <InfoRow label="Mobile" value={d.contact_mobile ?? '—'} />
              <InfoRow label="Qualifications" value={d.qualifications ?? '—'} />
              <InfoRow label="Registration no." value={d.license_number ?? '—'} />
              <InfoRow
                label="Account"
                value={`${d.is_enabled ? 'Active' : 'Disabled'} · login ${d.login_active ? 'enabled' : 'disabled'}`}
              />
              <InfoRow
                label="Terms accepted"
                value={
                  d.terms_accepted_at
                    ? `${new Date(d.terms_accepted_at).toLocaleDateString()}${d.terms_version ? ` (v${d.terms_version})` : ''}`
                    : 'Not recorded'
                }
              />
            </div>

            <div style={{ marginTop: 16, borderTop: 'var(--hairline)', paddingTop: 12 }}>
              <div className="card-title" style={{ marginBottom: 8 }}>
                Practice licence / certificate
              </div>

              {d.license_url ? (
                <a
                  className="btn btn-sm btn-primary"
                  href={d.license_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open certificate
                </a>
              ) : (
                <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
                  No certificate on file for this doctor.
                </p>
              )}

              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > MAX_LICENSE_BYTES) {
                    setError('That file is larger than 6 MB. Please choose a smaller one.');
                    return;
                  }
                  setError('');
                  upload.mutate(f);
                }}
              />
              <button
                className="btn btn-sm"
                style={{ marginTop: 8 }}
                disabled={upload.isPending}
                onClick={() => fileRef.current?.click()}
              >
                {upload.isPending
                  ? 'Uploading…'
                  : d.license_url
                    ? 'Replace certificate'
                    : 'Upload certificate'}
              </button>
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                PDF or image, up to 6 MB. The link above expires after 15 minutes.
              </p>
            </div>
          </>
        )}

        {error && <FieldError>{error}</FieldError>}

        <div className="row" style={{ marginTop: 20, gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
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
    onSuccess: (updated) => {
      // Drops the custom image and puts the generated one back, so there is
      // always a QR here rather than an empty slot.
      setQrCodeUrl(updated.qr_code_url ?? null);
    },
    onError: (e: any) => setError(e?.message ?? 'Could not reset the QR code.'),
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
                  onClick={() => removeQrMut.mutate()}
                  disabled={removeQrMut.isPending}
                  title="Discard a custom image and re-render the QR from the doctor's booking link"
                >
                  {removeQrMut.isPending ? 'Resetting…' : 'Reset to generated QR'}
                </button>
              )}
            </div>
          </div>
        </div>

        <label className="form-label" style={{ marginTop: 12 }}>Specialization</label>
        <input className="input" placeholder="Cardiologist" {...field('specialization')} />

        <label className="form-label" style={{ marginTop: 12 }}>Qualifications</label>
        <input className="input" placeholder="MD, DM (Cardiology)" {...field('qualifications')} />


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
    license_number: '',
    contact_mobile: '',
  });
  const [license, setLicense] = useState<File | null>(null);
  const licenseRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const mut = useMutation({
    mutationFn: async () => {
      const created = await doctorsApi.create({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        specialization: form.specialization.trim() || undefined,
        qualifications: form.qualifications.trim() || undefined,
        license_number: form.license_number.trim() || undefined,
        contact_mobile: form.contact_mobile.trim() || undefined,
      });
      // Two calls on purpose: creating the tenant is one transaction (doctor,
      // roles, login) and an S3 upload does not belong inside it. If the
      // upload fails the doctor still exists — the certificate can be added
      // afterwards from their profile.
      if (license) {
        try {
          await doctorsApi.uploadLicense(created.doctor.id, license);
        } catch {
          setError(
            'The doctor was created, but the certificate did not upload. Add it from their profile.',
          );
        }
      }
      return created;
    },
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
        <PasswordInput placeholder="min 8 characters" {...field('password')} />
        {form.password.length > 0 && form.password.length < 8 && (
          <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: 4 }}>
            Password must be at least 8 characters.
          </p>
        )}

        <label className="form-label" style={{ marginTop: 12 }}>Specialization</label>
        <input className="input" placeholder="Cardiologist" {...field('specialization')} />

        <label className="form-label" style={{ marginTop: 12 }}>Qualifications</label>
        <input className="input" placeholder="MD, DM (Cardiology)" {...field('qualifications')} />

        <label className="form-label" style={{ marginTop: 12 }}>Mobile number</label>
        <input
          className="input"
          inputMode="numeric"
          maxLength={10}
          placeholder="10-digit number"
          value={form.contact_mobile}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              contact_mobile: e.target.value.replace(/\D/g, '').slice(0, 10),
            }))
          }
        />
        {form.contact_mobile.length > 0 && !/^[6-9]\d{9}$/.test(form.contact_mobile) && (
          <FieldError>Enter a valid 10-digit mobile number.</FieldError>
        )}

        <label className="form-label" style={{ marginTop: 12 }}>
          Medical registration number
        </label>
        <input className="input" placeholder="e.g. MCI-12345/2018" {...field('license_number')} />

        <label className="form-label" style={{ marginTop: 12 }}>
          Practice licence / certificate
        </label>
        <input
          ref={licenseRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > MAX_LICENSE_BYTES) {
              setError('That file is larger than 6 MB. Please choose a smaller one.');
              return;
            }
            setLicense(f);
            setError('');
          }}
        />
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => licenseRef.current?.click()}>
            {license ? 'Choose a different file' : 'Choose file'}
          </button>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {license ? license.name : 'PDF or image, up to 6 MB'}
          </span>
        </div>

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

/**
 * Doctors who signed themselves up and are waiting on review.
 *
 * The licence is the whole point of this panel — approving without opening it
 * defeats the verification step, so the link is the most prominent control
 * here, ahead of Approve.
 */
function PendingRegistrations() {
  const qc = useQueryClient();
  const toast = useToast();
  const [rejectTarget, setRejectTarget] = useState<PendingDoctor | null>(null);
  const [reason, setReason] = useState('');

  const { data } = useQuery({
    queryKey: ['pending-doctors'],
    queryFn: doctorsApi.pendingRegistrations,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['pending-doctors'] });
    qc.invalidateQueries({ queryKey: ['doctors'] });
  };

  const approve = useMutation({
    mutationFn: (id: string) => doctorsApi.approveRegistration(id),
    onSuccess: () => { toast.success('Doctor approved'); refresh(); },
    onError: (e) => toast.error(e),
  });

  const reject = useMutation({
    mutationFn: () => doctorsApi.rejectRegistration(rejectTarget!.id, reason.trim() || undefined),
    onSuccess: () => {
      toast.success('Registration rejected');
      setRejectTarget(null);
      setReason('');
      refresh();
    },
    onError: (e) => toast.error(e),
  });

  if (!data?.length) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="card-title" style={{ marginBottom: 10 }}>
        Pending registrations ({data.length})
      </div>

      <div className="stack" style={{ gap: 10 }}>
        {data.map((d) => (
          <div
            key={d.id}
            className="card"
            style={{ borderLeft: '3px solid var(--warning, #f59e0b)' }}
          >
            <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <strong>{d.name}</strong>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                  {[d.specialization, d.qualifications].filter(Boolean).join(' · ') ||
                    'No specialization given'}
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  Reg. no. <strong>{d.license_number ?? '—'}</strong>
                  {d.contact_mobile ? ` · ${d.contact_mobile}` : ''}
                </div>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {d.license_url && (
                  <a
                    className="btn btn-sm btn-primary"
                    href={d.license_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View licence
                  </a>
                )}
                <button
                  className="btn btn-sm"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate(d.id)}
                >
                  Approve
                </button>
                <button
                  className="btn btn-sm"
                  style={{ color: 'var(--danger, #dc2626)', borderColor: 'var(--danger, #dc2626)' }}
                  onClick={() => setRejectTarget(d)}
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {rejectTarget && (
        <div className="modal-backdrop" onClick={() => setRejectTarget(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3>Reject registration</h3>
            <p className="muted" style={{ fontSize: 13.5 }}>
              <strong>{rejectTarget.name}</strong> will not be able to sign in. The
              reason is shown to them when they try.
            </p>
            <label className="form-label" style={{ marginTop: 12 }}>Reason (optional)</label>
            <input
              className="input"
              autoFocus
              placeholder="e.g. licence document was unreadable"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="row" style={{ marginTop: 18, gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setRejectTarget(null)}>Cancel</button>
              <button
                className="btn btn-danger"
                disabled={reject.isPending}
                onClick={() => reject.mutate()}
              >
                {reject.isPending ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
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
            <PasswordInput
              autoFocus
              placeholder="min 8 characters"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
            />
            {tooShort && <FieldError>Password must be at least 8 characters.</FieldError>}

            <label className="form-label" style={{ marginTop: 12 }}>
              Confirm password *
            </label>
            <PasswordInput
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
