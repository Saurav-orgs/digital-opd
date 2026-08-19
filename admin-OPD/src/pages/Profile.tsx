import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doctorsApi } from '../api/endpoints';
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

  if (!isDoctor) return <Empty>This page is for the doctor’s account.</Empty>;
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

        </div>
      </div>
    </>
  );
}
