import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../api/endpoints';
import { Field, Loading } from '../components/ui';
import { useToast } from '../components/Toast';
import { ApiError } from '../api/client';

/**
 * Platform settings — super admin only.
 *
 * Just the patient portal's address for now. It lives here rather than in an
 * env var because it is the address baked into every doctor's booking QR: when
 * it is wrong, every printed code points somewhere that answers nothing, and
 * fixing it should not need a redeploy.
 */
export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [base, setBase] = useState('');
  const [error, setError] = useState<string | null>(null);

  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  useEffect(() => {
    if (settingsQ.data) setBase(settingsQ.data.patient_web_base ?? '');
  }, [settingsQ.data]);

  const save = useMutation({
    mutationFn: () => settingsApi.update({ patient_web_base: base.trim() }),
    onSuccess: () => {
      toast.success(
        'Settings saved',
        'New booking QRs use this address. Existing ones keep the old one until regenerated.',
      );
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['doctors'] });
    },
    onError: (e: unknown) =>
      setError(e instanceof ApiError ? e.message : 'Could not save. Please try again.'),
  });

  if (settingsQ.isLoading) return <Loading />;

  const valid = /^https?:\/\/.+/i.test(base.trim());
  const unchanged = base.trim() === (settingsQ.data?.patient_web_base ?? '');

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Settings</h2>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-title">Patient portal address</div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0, marginBottom: 14 }}>
          Where patients land when they scan a doctor's QR code. Every booking
          link is this address plus the doctor's slug — so it has to be
          reachable from a patient's phone, not just from this machine.
        </p>

        <Field label="Base URL">
          <input
            className="input"
            placeholder="https://booking.myclinic.com"
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              setError(null);
            }}
          />
          <span className="hint">
            Must start with http:// or https://. A doctor can override this on
            their own profile.
          </span>
        </Field>

        {base.trim().length > 0 && !valid && (
          <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: -6 }}>
            Enter a full URL starting with http:// or https://
          </p>
        )}
        {/localhost|127\.0\.0\.1/i.test(base) && (
          <p style={{ color: 'var(--warning, #b45309)', fontSize: 12.5, marginTop: -4 }}>
            A phone cannot reach localhost — QR codes built from this address
            will not open on a patient's device.
          </p>
        )}
        {error && <p style={{ color: 'var(--danger, red)', fontSize: 13 }}>{error}</p>}

        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary"
            disabled={!valid || unchanged || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
