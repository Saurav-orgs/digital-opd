import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doctorsApi } from '../api/endpoints';
import type { Doctor } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Empty, Field, Loading, Modal } from '../components/ui';

/**
 * Single-doctor profile — the web equivalent of the Flutter app's
 * `DoctorProfileScreen`. Replaces the old multi-doctor list + enable/disable
 * table, which no longer applies now the clinic has one doctor.
 */
export default function Doctors() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Doctor | 'new' | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['doctors'], queryFn: doctorsApi.list });
  const canCreate = can('doctors', 'create');
  const canUpdate = can('doctors', 'update');
  const canSchedule = can('opd_schedules', 'read');

  if (isLoading) return <Loading />;

  const doctor = data?.[0] ?? null;

  return (
    <>
      <div className="page-head">
        <h1>Doctor Profile</h1>
      </div>

      {!doctor ? (
        <>
          <Empty>No doctor profile set up yet.</Empty>
          {canCreate && (
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setEditing('new')}>
              + Add doctor
            </button>
          )}
        </>
      ) : (
        <div className="stack" style={{ maxWidth: 560 }}>
          <div className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              {doctor.profile_photo_url ? (
                <img src={doctor.profile_photo_url} alt={doctor.name} className="avatar" />
              ) : (
                <div className="avatar" />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{doctor.name}</div>
                {doctor.specialization && <div className="muted">{doctor.specialization}</div>}
                {doctor.qualifications && (
                  <div className="muted" style={{ fontSize: 13 }}>{doctor.qualifications}</div>
                )}
                {doctor.consultation_fee && (
                  <span className="badge badge-available" style={{ marginTop: 8 }}>
                    ₹{doctor.consultation_fee} fee
                  </span>
                )}
              </div>
            </div>
            {doctor.bio && (
              <p className="muted" style={{ marginTop: 16, borderTop: 'var(--hairline)', paddingTop: 16 }}>
                {doctor.bio}
              </p>
            )}
          </div>

          {doctor.payment_qr_url && (
            <div className="card">
              <div className="row">
                <img src={doctor.payment_qr_url} alt="Payment QR" className="thumb" style={{ height: 56 }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Payment QR</div>
                  <span className="muted">Shown to patients on the booking screen.</span>
                </div>
              </div>
            </div>
          )}

          {(canSchedule || canUpdate) && (
            <div className="row">
              {canSchedule && (
                <button className="btn" onClick={() => navigate(`/doctors/${doctor.id}/schedule`)}>
                  Schedule
                </button>
              )}
              {canUpdate && (
                <button className="btn btn-primary" onClick={() => setEditing(doctor)}>
                  Edit
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {editing && (
        <DoctorModal
          doctor={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function DoctorModal({ doctor, onClose }: { doctor: Doctor | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const qrRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: doctor?.name ?? '',
    specialization: doctor?.specialization ?? '',
    qualifications: doctor?.qualifications ?? '',
    consultation_fee: doctor?.consultation_fee ?? '',
    bio: doctor?.bio ?? '',
  });

  // Files are picked locally and uploaded on Save — so a brand-new doctor can
  // get a photo + QR in one go (no need to save first, then re-open).
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    doctor?.profile_photo_url ?? null,
  );
  const [qrPreview, setQrPreview] = useState<string | null>(
    doctor?.payment_qr_url ?? null,
  );

  const pickPhoto = (f: File) => {
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  };
  const pickQr = (f: File) => {
    setQrFile(f);
    setQrPreview(URL.createObjectURL(f));
  };

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: form.name,
        specialization: form.specialization || undefined,
        qualifications: form.qualifications || undefined,
        bio: form.bio || undefined,
        consultation_fee: form.consultation_fee === '' ? undefined : Number(form.consultation_fee),
      };
      // Create/update first to obtain the id the upload endpoints need,
      // then upload any newly-picked images to it.
      const saved = doctor
        ? await doctorsApi.update(doctor.id, body)
        : await doctorsApi.create(body);
      if (photoFile) await doctorsApi.uploadPhoto(saved.id, photoFile);
      if (qrFile) await doctorsApi.uploadQr(saved.id, qrFile);
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctors'] });
      toast.success(doctor ? 'Doctor updated' : 'Doctor created');
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  return (
    <Modal title={doctor ? 'Edit doctor' : 'Add doctor'} onClose={onClose} large>
      <div className="grid cols-2">
        <Field label="Name">
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Specialization">
          <input
            className="input"
            value={form.specialization}
            onChange={(e) => setForm({ ...form, specialization: e.target.value })}
          />
        </Field>
        <Field label="Qualifications">
          <input
            className="input"
            value={form.qualifications}
            onChange={(e) => setForm({ ...form, qualifications: e.target.value })}
          />
        </Field>
        <Field label="Consultation fee (₹)">
          <input
            className="input"
            type="number"
            value={form.consultation_fee}
            onChange={(e) => setForm({ ...form, consultation_fee: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Bio">
        <textarea
          className="input"
          rows={3}
          value={form.bio}
          onChange={(e) => setForm({ ...form, bio: e.target.value })}
        />
      </Field>

      <div className="grid cols-2" style={{ marginTop: 4 }}>
        <div className="card" style={{ background: 'var(--page)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 500 }}>Profile photo</div>
              <span className="muted">Shown to patients.</span>
            </div>
            {photoPreview && (
              <img src={photoPreview} alt="Photo" className="avatar" />
            )}
          </div>
          <input
            ref={photoRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickPhoto(f);
            }}
          />
          <button
            className="btn btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => photoRef.current?.click()}
          >
            {photoPreview ? 'Change photo' : 'Upload photo'}
          </button>
        </div>

        <div className="card" style={{ background: 'var(--page)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 500 }}>Payment QR</div>
              <span className="muted">Shown on the booking screen.</span>
            </div>
            {qrPreview && (
              <img src={qrPreview} alt="QR" className="thumb" style={{ height: 56 }} />
            )}
          </div>
          <input
            ref={qrRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickQr(f);
            }}
          />
          <button
            className="btn btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => qrRef.current?.click()}
          >
            {qrPreview ? 'Change QR' : 'Upload QR'}
          </button>
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => save.mutate()}
          disabled={save.isPending || !form.name.trim()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
