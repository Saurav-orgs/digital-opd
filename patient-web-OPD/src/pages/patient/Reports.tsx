import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, ExternalLink, Upload } from 'lucide-react';
import { patientApi } from '../../patientApi';
import { ApiException } from '../../types';
import { StateView } from '../../components/StateView';

export const Reports: React.FC = () => {
  const qc = useQueryClient();
  const { data: reports, isLoading, error, refetch } = useQuery({
    queryKey: ['patient-reports'],
    queryFn: patientApi.myReports,
  });

  const [title, setTitle] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: (file: File) => patientApi.uploadMyReport(title.trim(), file),
    onSuccess: () => {
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      setUploadError(null);
      qc.invalidateQueries({ queryKey: ['patient-reports'] });
      qc.invalidateQueries({ queryKey: ['patient-visits'] });
    },
    onError: (err) => {
      setUploadError(
        err instanceof ApiException ? err.message : 'Could not upload the report. Please try again.',
      );
    },
  });

  const handleUpload = () => {
    const file = fileRef.current?.files?.[0];
    if (!title.trim()) {
      setUploadError('Please enter a title for this report.');
      return;
    }
    if (!file) {
      setUploadError('Please choose a file to upload.');
      return;
    }
    upload.mutate(file);
  };

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>
        My Reports
      </h2>
      <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
        Lab reports from the clinic, plus anything you upload yourself — attached to your
        latest appointment.
      </p>

      <div className="section-card" style={{ marginBottom: '20px' }}>
        <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Upload size={18} color="var(--primary)" />
          <span>Upload a report</span>
        </div>
        <div className="form-field">
          <label className="form-label">Title</label>
          <input
            type="text"
            className="form-input"
            placeholder="e.g. Blood Test — CBC"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          style={{ marginBottom: '12px' }}
        />
        <div>
          <button className="btn-primary" onClick={handleUpload} disabled={upload.isPending}>
            {upload.isPending ? (
              <div className="spinner" style={{ width: '18px', height: '18px', borderWidth: '2.5px' }} />
            ) : (
              <span>Upload report</span>
            )}
          </button>
        </div>
        {uploadError && <div className="error-text" style={{ marginTop: '10px' }}>{uploadError}</div>}
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>
          JPG, PNG, WebP or PDF · up to 5 MB.
        </div>
      </div>

      {isLoading ? (
        <StateView loading />
      ) : error ? (
        <StateView
          error={error instanceof Error ? error.message : 'Could not load your reports.'}
          onRetry={() => refetch()}
        />
      ) : !reports?.length ? (
        <StateView empty="No reports available yet." />
      ) : (
        <div className="section-card" style={{ padding: 0 }}>
          {reports.map((r, i) => (
            <a
              key={r.id}
              href={r.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '16px 20px',
                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                color: 'var(--text)',
                textDecoration: 'none',
              }}
            >
              <FileText size={20} color="var(--primary)" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '14.5px' }}>{r.title}</div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                  {new Date(r.createdAt).toLocaleDateString()}
                </div>
              </div>
              <ExternalLink size={16} color="var(--text-secondary)" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
};
