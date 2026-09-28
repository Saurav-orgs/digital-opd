import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, doctorsApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { MyPlanCard } from '../components/MyPlanCard';
import { Empty, Field, Loading, PasswordInput } from '../components/ui';
import { ShareQrButton } from '../components/BookingQr';

/**
 * The doctor's own home in the admin — profile details, photo and links to
 * their OPD schedule and letterhead. The SuperAdmin is the clinic's single
 * doctor, so there is no separate "Doctor Profile" page. The letterhead used
 * to be the bottom half of this screen; it has its own page (and menu item)
 * now — see `pages/Letterhead.tsx`.
 */
export default function Profile() {
  const { isDoctor, can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const photoRef = useRef<HTMLInputElement>(null);
  // const logoRef = useRef<HTMLInputElement>(null);
  const canEdit = can('doctors', 'update');
  const canSchedule = can('opd_schedules', 'read');

  const meQ = useQuery({
    queryKey: ['doctor-me'],
    queryFn: doctorsApi.me,
    enabled: isDoctor,
  });

  const [form, setForm] = useState({
    name: '', specialization: '', qualifications: '', consultation_fee: '', bio: '',
  });

  useEffect(() => {
    if (meQ.data) {
      setForm({
        name: meQ.data.name ?? '',
        specialization: meQ.data.specialization ?? '',
        qualifications: meQ.data.qualifications ?? '',
        consultation_fee: meQ.data.consultation_fee ?? '',
        bio: meQ.data.bio ?? '',
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
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doctor-me'] }); toast.success('Profile updated'); },
    onError: (e) => toast.error(e),
  });

  const uploadPhoto = useMutation({
    mutationFn: (file: File) => doctorsApi.uploadMyPhoto(file),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doctor-me'] }); toast.success('Profile photo updated'); },
    onError: (e) => toast.error(e),
  });

  /*
  const uploadLogo = useMutation({
    mutationFn: (file: File) => doctorsApi.uploadMyLetterheadLogo(file),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doctor-me'] }); toast.success('Letterhead logo updated'); },
    onError: (e) => toast.error(e),
  });
  */

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
          {/* The letterhead has its own screen and menu item now; this is the
              shortcut for a doctor who came here looking for it. */}
          <button className="btn" onClick={() => navigate('/profile/letterhead')}>
            Letterhead
          </button>
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
          <MyPlanCard />

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
    </>
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
        <PasswordInput
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
        />
      </Field>
      <Field label="New password">
        <PasswordInput
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
        <PasswordInput
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
