import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, doctorsApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Empty, Field, Loading } from '../components/ui';

/**
 * The doctor's own home in the admin — profile details, photo and a link to
 * their OPD schedule. The SuperAdmin is the clinic's single doctor, so there is
 * no separate "Doctor Profile" page; everything lives here.
 */
export default function Profile() {
  const { isDoctor, can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const photoRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const canEdit = can('doctors', 'update');
  const canSchedule = can('opd_schedules', 'read');

  const meQ = useQuery({
    queryKey: ['doctor-me'],
    queryFn: doctorsApi.me,
    enabled: isDoctor,
  });

  const [form, setForm] = useState({
    name: '', specialization: '', qualifications: '', consultation_fee: '', bio: '',
    clinic_name: '', clinic_address: '', clinic_phone: '',
  });

  useEffect(() => {
    if (meQ.data) {
      setForm({
        name: meQ.data.name ?? '',
        specialization: meQ.data.specialization ?? '',
        qualifications: meQ.data.qualifications ?? '',
        consultation_fee: meQ.data.consultation_fee ?? '',
        bio: meQ.data.bio ?? '',
        clinic_name: meQ.data.clinic_name ?? '',
        clinic_address: meQ.data.clinic_address ?? '',
        clinic_phone: meQ.data.clinic_phone ?? '',
      });
    }
  }, [meQ.data]);

  const save = useMutation({
    mutationFn: () =>
      doctorsApi.updateMe({
        name: form.name,
        specialization: form.specialization || undefined,
        qualifications: form.qualifications || undefined,
        bio: form.bio || undefined,
        consultation_fee: form.consultation_fee === '' ? undefined : (Number(form.consultation_fee) as any),
        clinic_name: form.clinic_name || undefined,
        clinic_address: form.clinic_address || undefined,
        clinic_phone: form.clinic_phone || undefined,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doctor-me'] }); toast.success('Profile updated'); },
    onError: (e) => toast.error(e),
  });

  const uploadPhoto = useMutation({
    mutationFn: (file: File) => doctorsApi.uploadMyPhoto(file),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doctor-me'] }); toast.success('Profile photo updated'); },
    onError: (e) => toast.error(e),
  });

  const uploadLogo = useMutation({
    mutationFn: (file: File) => doctorsApi.uploadMyLetterheadLogo(file),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doctor-me'] }); toast.success('Letterhead logo updated'); },
    onError: (e) => toast.error(e),
  });

  if (!isDoctor) {
    // Staff and the super admin have no doctor profile, but they still need
    // somewhere to change their own password.
    return (
      <>
        <div className="page-head">
          <h1>My account</h1>
        </div>
        <div style={{ maxWidth: 420 }}>
          <ChangePasswordCard />
        </div>
      </>
    );
  }
  if (meQ.isLoading) return <Loading />;
  if (meQ.error) return <Empty>Could not load your profile.</Empty>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My profile</h1>
          {!canEdit && <span className="muted">Read-only — your role doesn’t grant profile editing.</span>}
        </div>
        <div className="row">
          {canSchedule && (
            <button className="btn" onClick={() => navigate('/profile/schedule')}>
              Schedule
            </button>
          )}
          {canEdit && (
            <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending || !form.name.trim()}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <div className="grid cols-2-1">
        <div className="card">
          <div className="grid cols-2">
            <Field label="Name">
              <input className="input" disabled={!canEdit} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Specialization">
              <input className="input" disabled={!canEdit} value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} />
            </Field>
            <Field label="Qualifications">
              <input className="input" disabled={!canEdit} value={form.qualifications} onChange={(e) => setForm({ ...form, qualifications: e.target.value })} />
            </Field>
            <Field label="Consultation fee (₹)">
              <input className="input" type="number" disabled={!canEdit} value={form.consultation_fee} onChange={(e) => setForm({ ...form, consultation_fee: e.target.value })} />
            </Field>
          </div>
          <Field label="Bio">
            <textarea className="input" rows={4} disabled={!canEdit} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
          </Field>
        </div>

        <div className="stack">
          <ChangePasswordCard />

          <div className="card">
            <div className="card-title">Profile photo</div>
            {meQ.data?.profile_photo_url ? (
              <img
                src={meQ.data.profile_photo_url}
                alt="Photo"
                style={{ width: '100%', borderRadius: 8, border: 'var(--hairline)', marginBottom: 12 }}
              />
            ) : (
              <p className="muted">No photo uploaded yet.</p>
            )}
            {canEdit && (
              <>
                <input
                  ref={photoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto.mutate(f); }}
                />
                <button className="btn btn-sm" onClick={() => photoRef.current?.click()} disabled={uploadPhoto.isPending}>
                  {uploadPhoto.isPending ? 'Uploading…' : 'Upload new photo'}
                </button>
              </>
            )}
          </div>

          {meQ.data?.public_slug && (
            <div className="card">
              <div className="card-title">My booking link & QR</div>
              <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                Share this link or QR code with patients so they can book appointments directly.
              </p>

              {meQ.data.qr_code_url && (
                <div style={{ textAlign: 'center', marginBottom: 14, padding: '12px', background: '#fff', borderRadius: 8, border: 'var(--hairline)' }}>
                  <img
                    src={meQ.data.qr_code_url}
                    alt="Doctor booking QR"
                    style={{ width: 140, height: 140, objectFit: 'contain', display: 'inline-block' }}
                  />
                  <div className="row" style={{ marginTop: 8, gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <a
                      className="btn btn-sm"
                      href={meQ.data.qr_code_url}
                      target="_blank"
                      rel="noreferrer"
                      download="doctor-booking-qr.png"
                    >
                      ⬇ Download QR
                    </a>
                    <ShareQrButton
                      qrUrl={meQ.data.qr_code_url}
                      doctorName={meQ.data.name}
                      bookingUrl={
                        meQ.data.booking_url ||
                        `${(meQ.data.profile_base_url || window.location.origin.replace(':5173', ':5174')).replace(/\/+$/, '')}/d/${meQ.data.public_slug}`
                      }
                    />
                  </div>
                </div>
              )}

              {(() => {
                const defaultBase = window.location.origin.replace(':5173', ':5174');
                const base = meQ.data.profile_base_url ? meQ.data.profile_base_url.replace(/\/+$/, '') : defaultBase;
                const url = meQ.data.booking_url || `${base}/d/${meQ.data.public_slug}`;
                return (
                  <>
                    <div style={{
                      fontSize: 12,
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      background: 'var(--surface-2, #f4f4f5)',
                      padding: '8px 12px',
                      borderRadius: 8,
                      marginBottom: 10,
                    }}>
                      {url}
                    </div>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(url);
                          toast.success('Link copied!');
                        }}
                      >
                        Copy link
                      </button>
                      {'share' in navigator && (
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={async () => {
                            try {
                              await navigator.share({
                                title: `Book appointment with ${meQ.data?.name}`,
                                text: `Book an appointment with ${meQ.data?.name}:`,
                                url,
                              });
                            } catch (_) {}
                          }}
                        >
                          Share
                        </button>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* ── Prescription letterhead ── */}
      <div className="page-head" style={{ marginTop: 28 }}>
        <div>
          <h1 style={{ fontSize: 18 }}>Prescription letterhead</h1>
          <span className="muted">This is what appears at the top of every prescription you issue.</span>
        </div>
      </div>

      <div className="grid cols-2-1">
        <div className="card">
          <Field label="Clinic / practice name">
            <input
              className="input"
              disabled={!canEdit}
              placeholder="e.g. Rao Heart Clinic"
              value={form.clinic_name}
              onChange={(e) => setForm({ ...form, clinic_name: e.target.value })}
            />
          </Field>
          <Field label="Address">
            <textarea
              className="input"
              rows={2}
              disabled={!canEdit}
              placeholder="2nd Floor, MG Road, Bengaluru 560001"
              value={form.clinic_address}
              onChange={(e) => setForm({ ...form, clinic_address: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              disabled={!canEdit}
              placeholder="+91 98765 43210"
              value={form.clinic_phone}
              onChange={(e) => setForm({ ...form, clinic_phone: e.target.value })}
            />
          </Field>

          <div className="card-title" style={{ marginTop: 8 }}>Clinic logo</div>
          <div className="row" style={{ alignItems: 'center', gap: 12 }}>
            {meQ.data?.clinic_logo_url ? (
              <img
                src={meQ.data.clinic_logo_url}
                alt="Logo"
                style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 8, border: 'var(--hairline)', background: '#fff' }}
              />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: 8, border: 'var(--hairline)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                No logo
              </div>
            )}
            {canEdit && (
              <>
                <input
                  ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo.mutate(f); e.target.value = ''; }}
                />
                <button className="btn btn-sm" onClick={() => logoRef.current?.click()} disabled={uploadLogo.isPending}>
                  {uploadLogo.isPending ? 'Uploading…' : 'Upload logo'}
                </button>
              </>
            )}
          </div>

          {canEdit && (
            <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save letterhead'}
              </button>
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-title">Live preview</div>
            <LetterheadPreview
              logoUrl={meQ.data?.clinic_logo_url ?? null}
              clinicName={form.clinic_name || form.name || 'Your clinic'}
              doctorName={form.name}
              creds={[form.qualifications, form.specialization].filter(Boolean).join('  •  ')}
              address={form.clinic_address}
              phone={form.clinic_phone}
            />
          </div>
        </div>
      </div>
    </>
  );
}

/** A faithful mini of the PDF letterhead band, so the doctor sees their pad. */
function LetterheadPreview({
  logoUrl, clinicName, doctorName, creds, address, phone,
}: {
  logoUrl: string | null;
  clinicName: string;
  doctorName: string;
  creds: string;
  address: string;
  phone: string;
}) {
  const brand = '#0F766E';
  const showDoctorLine = clinicName !== doctorName;
  return (
    <div style={{ border: 'var(--hairline)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      <div style={{ background: brand, color: '#fff', padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {logoUrl && (
          <img src={logoUrl} alt="" style={{ width: 44, height: 44, objectFit: 'contain', background: '#fff', borderRadius: 6, flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.15 }}>{clinicName}</div>
          {creds && <div style={{ fontSize: 11, color: '#DCEDEA', marginTop: 3 }}>{creds}</div>}
          {showDoctorLine && doctorName && (
            <div style={{ fontSize: 11, fontStyle: 'italic', color: '#CFE6E2', marginTop: 2 }}>{doctorName}</div>
          )}
        </div>
        <div style={{ fontSize: 10, color: '#EAF3F1', textAlign: 'right', whiteSpace: 'pre-line', maxWidth: 150 }}>
          {[address, phone].filter(Boolean).join('\n')}
        </div>
      </div>
      <div style={{ height: 3, background: '#0B5750' }} />
      <div style={{ padding: '18px 16px', color: 'var(--text-muted)', fontSize: 12 }}>
        <div style={{ fontFamily: 'Times, serif', fontStyle: 'italic', fontWeight: 700, fontSize: 22, color: brand }}>Rx</div>
        <div style={{ marginTop: 8 }}>Patient details, medicines and advice appear here.</div>
      </div>
    </div>
  );
}

/**
 * Shares the QR image itself, not just the booking link — a doctor sending this
 * to a patient on WhatsApp wants the picture, which is what they will print or
 * forward.
 *
 * Web Share level 2 (`files`) is the good path and exists on the phones this
 * matters on. Where it is missing — most desktop browsers — the image is copied
 * to the clipboard instead, so it can be pasted straight into a chat. Download
 * remains as the button next to this one.
 */
function ShareQrButton({
  qrUrl,
  doctorName,
  bookingUrl,
}: {
  qrUrl: string;
  doctorName: string;
  bookingUrl: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const share = async () => {
    setBusy(true);
    try {
      const blob = await fetch(qrUrl).then((r) => {
        if (!r.ok) throw new Error('Could not load the QR image.');
        return r.blob();
      });
      const file = new File([blob], `${doctorName.replace(/\s+/g, '-')}-booking-qr.png`, {
        type: blob.type || 'image/png',
      });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Book an appointment with ${doctorName}`,
          text: `Scan this QR or open ${bookingUrl} to book an appointment with ${doctorName}.`,
        });
        return;
      }

      // No file sharing here — put the image on the clipboard instead.
      if (navigator.clipboard && 'ClipboardItem' in window) {
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type || 'image/png']: blob }),
        ]);
        toast.success('QR code copied — paste it into a chat');
        return;
      }

      toast.error('Sharing is not supported here — use Download QR instead.');
    } catch (err) {
      // A user dismissing the share sheet is not an error worth shouting about.
      if ((err as Error)?.name === 'AbortError') return;
      toast.error((err as Error)?.message ?? 'Could not share the QR code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="btn btn-sm btn-primary" onClick={share} disabled={busy}>
      {busy ? 'Preparing…' : '↗ Share QR'}
    </button>
  );
}

/**
 * Rotate your own password.
 *
 * The current password is required even though you are already signed in — a
 * session left open on a shared clinic machine should not be enough to lock the
 * real owner out. A user who has forgotten their password entirely needs the
 * super admin to reset it from the Doctors screen (or their doctor, from Users).
 */
function ChangePasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const change = useMutation({
    mutationFn: () => authApi.changePassword(current, next),
    onSuccess: () => {
      toast.success('Password changed');
      setCurrent('');
      setNext('');
      setConfirm('');
    },
    onError: (e) => toast.error(e),
  });

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit =
    current.length > 0 && next.length >= 8 && confirm === next && !change.isPending;

  return (
    <div className="card">
      <div className="card-title">Change password</div>
      <Field label="Current password">
        <input
          className="input"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Field>
      <Field label="New password">
        <input
          className="input"
          type="password"
          placeholder="min 8 characters"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </Field>
      {tooShort && (
        <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: -6 }}>
          Password must be at least 8 characters.
        </p>
      )}
      <Field label="Confirm new password">
        <input
          className="input"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      {mismatch && (
        <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: -6 }}>
          Passwords do not match.
        </p>
      )}
      <button
        className="btn btn-primary"
        disabled={!canSubmit}
        onClick={() => change.mutate()}
      >
        {change.isPending ? 'Changing…' : 'Change password'}
      </button>
    </div>
  );
}
