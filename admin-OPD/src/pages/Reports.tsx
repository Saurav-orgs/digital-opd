import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { patientProfilesApi, reportsApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Empty, Field, Loading } from '../components/ui';

/**
 * Upload + view patient reports by mobile number. For a pathlab login (whose
 * role only holds reports:create/read) this is the entire app.
 */
export default function Reports() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canCreate = can('reports', 'create');
  const canRead = can('reports', 'read');

  const [mobile, setMobile] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  // A number may cover a whole family, so the report has to name the person.
  // Filing it against the wrong member is not something we can detect later.
  const [profileId, setProfileId] = useState<string>('');
  const [title, setTitle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const mobileValid = /^[6-9]\d{9}$/.test(mobile.trim());

  const patientsQ = useQuery({
    queryKey: ['patients-by-mobile', searched],
    queryFn: () => patientProfilesApi.byMobile(searched!),
    enabled: !!searched,
  });
  const patients = patientsQ.data ?? [];
  const selected = patients.find((p) => p.id === profileId) ?? null;

  const reportsQ = useQuery({
    queryKey: ['reports', profileId],
    queryFn: () => reportsApi.list(profileId),
    enabled: !!profileId && canRead,
  });

  const upload = useMutation({
    mutationFn: (file: File) =>
      reportsApi.upload(mobile.trim(), profileId, title.trim(), file),
    onSuccess: () => {
      toast.success('Report uploaded');
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['reports', profileId] });
    },
    onError: (e) => toast.error(e),
  });

  const remove = useMutation({
    mutationFn: (id: string) => reportsApi.remove(id),
    onSuccess: () => {
      toast.success('Report deleted');
      qc.invalidateQueries({ queryKey: ['reports', profileId] });
    },
    onError: (e) => toast.error(e),
  });

  const handleSearch = () => {
    if (!mobileValid) return;
    setProfileId('');
    setSearched(mobile.trim());
  };

  return (
    <>
      <div className="page-head">
        <h1>Reports</h1>
      </div>

      <div className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
        <Field label="Patient mobile number">
          <input
            className="input"
            value={mobile}
            maxLength={10}
            placeholder="10-digit mobile number"
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <button className="btn" disabled={!mobileValid} onClick={handleSearch}>
          Look up reports
        </button>
      </div>

      {searched && (
        <div className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
          <div className="card-title">Which patient?</div>
          {patientsQ.isLoading ? (
            <Loading />
          ) : patients.length === 0 ? (
            <Empty>
              No patient is registered on {searched}. They are registered when a
              booking or walk-in is made.
            </Empty>
          ) : (
            <Field label="Patient on this number">
              <select
                className="input"
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
              >
                <option value="">Select a patient…</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.patient_code}
                    {p.last_age != null ? ` · ${p.last_age} yrs` : ''}
                    {p.gender ? ` · ${p.gender}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}

      {canCreate && selected && (
        <div className="card" style={{ marginBottom: 16, maxWidth: 480 }}>
          <div className="card-title">
            Upload a report for {selected.name} ({selected.patient_code})
          </div>
          <Field label="Report title">
            <input
              className="input"
              value={title}
              placeholder="e.g. Blood Test — CBC"
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="input"
            style={{ marginBottom: 10 }}
          />
          <button
            className="btn btn-primary"
            disabled={!title.trim() || upload.isPending}
            onClick={() => {
              const file = fileRef.current?.files?.[0];
              if (file) upload.mutate(file);
              else toast.error(new Error('Please choose a file to upload.'));
            }}
          >
            {upload.isPending ? 'Uploading…' : 'Upload report'}
          </button>
          <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
            JPG, PNG, WebP or PDF · up to 5 MB.
          </p>
        </div>
      )}

      {selected && canRead && (
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-title">
            Reports for {selected.name} ({selected.patient_code})
          </div>
          {reportsQ.isLoading ? (
            <Loading />
          ) : !reportsQ.data?.length ? (
            <Empty>No reports uploaded yet.</Empty>
          ) : (
            <div className="stack">
              {reportsQ.data.map((r) => (
                <div key={r.id} className="leave-item">
                  <div>
                    <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {canCreate && (
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(r.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
