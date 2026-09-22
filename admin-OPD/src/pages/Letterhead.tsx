import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doctorsApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Empty, Field, Loading } from '../components/ui';
import {
  HEADER_BEST_W,
  HEADER_MIN_W,
  LetterheadHeaderPicker,
  LetterheadPreview,
} from '../components/Letterhead';
import { LEGACY_RATIO } from '../lib/letterhead';

/**
 * The doctor's prescription letterhead, on its own screen.
 *
 * It used to be the bottom half of My profile, under the photo and the
 * booking link, where a doctor looking for "where do I upload my pad" had to
 * know to scroll for it. The client asked for it in the menu — it is set up
 * once and then forgotten, and a menu item is what makes it findable the one
 * time a year it is needed.
 *
 * Address and phone are the letterhead's own fields even though they live on
 * the doctor row: they print only when there is no header image, so they
 * belong beside the image they stand in for.
 */
export default function LetterheadPage() {
  const { isDoctor, can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const headerRef = useRef<HTMLInputElement>(null);
  const canEdit = can('doctors', 'update');

  const meQ = useQuery({
    queryKey: ['doctor-me'],
    queryFn: doctorsApi.me,
    enabled: isDoctor,
  });

  const [form, setForm] = useState({ clinic_address: '', clinic_phone: '' });

  useEffect(() => {
    if (meQ.data) {
      setForm({
        clinic_address: meQ.data.clinic_address ?? '',
        clinic_phone: meQ.data.clinic_phone ?? '',
      });
    }
  }, [meQ.data]);

  const save = useMutation({
    mutationFn: () =>
      doctorsApi.updateMe({
        clinic_address: form.clinic_address || undefined,
        clinic_phone: form.clinic_phone || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor-me'] });
      toast.success('Letterhead saved');
    },
    onError: (e) => toast.error(e),
  });

  const uploadHeader = useMutation({
    mutationFn: (file: File) => doctorsApi.uploadMyLetterheadHeader(file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor-me'] });
      toast.success('Prescription header updated', 'Every prescription issued from now on carries it.');
    },
    onError: (e) => toast.error(e),
  });
  const removeHeader = useMutation({
    mutationFn: () => doctorsApi.removeMyLetterheadHeader(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctor-me'] });
      toast.success('Prescription header removed', 'Your name and details print as the header again.');
    },
    onError: (e) => toast.error(e),
  });

  if (!isDoctor) return <Empty>This page is for the doctor’s account.</Empty>;
  if (meQ.isLoading) return <Loading />;
  if (meQ.error || !meQ.data) return <Empty>Could not load your letterhead.</Empty>;

  const me = meQ.data;
  const doctorName =
    me.name.startsWith('Dr.') || me.name.startsWith('Dr ') ? me.name : `Dr. ${me.name}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Letterhead</h1>
          <span className="muted">This is what appears at the top of every prescription you issue.</span>
        </div>
        <div className="row">
          <button className="btn" onClick={() => navigate('/profile')}>My profile</button>
          {canEdit && (
            <button className="btn btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <div className="grid cols-2-1">
        <div className="card">
          {/* The doctor's own pad header, as one image. When set it replaces
              the composed name/address header on the PDF; the fields below
              still print when it is not. */}
          <div className="card-title">Header image</div>
          <p className="muted" style={{ fontSize: 12.5, margin: '-6px 0 10px' }}>
            Upload your prescription pad — a scan, a photo or the printer's PDF —
            and mark where the header ends; that strip prints at the top of every
            prescription, as tall as it needs to be. Any image format or PDF,
            at least {HEADER_MIN_W} px wide ({HEADER_BEST_W} px is ideal), under 5 MB.
            Leave it empty to print your name and details instead.
          </p>
          <div
            className="lh-header-box"
            style={{ aspectRatio: `${me.letterhead_header_ratio || LEGACY_RATIO}` }}
          >
            {me.letterhead_header_url ? (
              <img src={me.letterhead_header_url} alt="Prescription header" />
            ) : (
              <span className="muted">No header uploaded — your details print instead</span>
            )}
          </div>
          {canEdit && (
            <div className="row" style={{ gap: 8, marginTop: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <LetterheadHeaderPicker
                inputRef={headerRef}
                onPick={(f) => uploadHeader.mutate(f)}
                onReject={(problem) =>
                  toast.push('error', 'This file cannot be used as the header', problem)
                }
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={() => headerRef.current?.click()}
                disabled={uploadHeader.isPending}
              >
                {uploadHeader.isPending
                  ? 'Uploading…'
                  : me.letterhead_header_url
                    ? 'Replace header'
                    : 'Upload header'}
              </button>
              {me.letterhead_header_url && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => removeHeader.mutate()}
                  disabled={removeHeader.isPending}
                >
                  {removeHeader.isPending ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
          )}

          <div className="card-title" style={{ marginTop: 4 }}>Details</div>
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
              headerUrl={me.letterhead_header_url ?? null}
              headerRatio={me.letterhead_header_ratio}
              doctorName={doctorName}
              qualifications={me.qualifications || 'M.B.B.S.'}
              specialization={me.specialization || me.clinic_name || ''}
              address={form.clinic_address || 'Address'}
              phone={form.clinic_phone}
            />
          </div>
        </div>
      </div>
    </>
  );
}
