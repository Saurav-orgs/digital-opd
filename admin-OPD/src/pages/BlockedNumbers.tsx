import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { blockedNumbersApi } from '../api/endpoints';
import type { BlockedNumber } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog, Empty, Loading } from '../components/ui';

/**
 * Numbers this clinic refuses bookings from.
 *
 * Public booking needs only a number, a name and a free slot, so one nuisance
 * caller can quietly fill a day with appointments nobody attends. Blocking is
 * per clinic, not platform-wide: a number that abuses one practice is not
 * necessarily abusing another, and no tenant should be able to lock a patient
 * out everywhere.
 */
export default function BlockedNumbersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const canEdit = can('appointments', 'update');

  const [mobile, setMobile] = useState('');
  const [reason, setReason] = useState('');
  const [unblockTarget, setUnblockTarget] = useState<BlockedNumber | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['blocked-numbers'],
    queryFn: blockedNumbersApi.list,
  });

  const blockMut = useMutation({
    mutationFn: () => blockedNumbersApi.block(mobile.trim(), reason.trim() || undefined),
    onSuccess: () => {
      setMobile('');
      setReason('');
      toast.success('Number blocked');
      qc.invalidateQueries({ queryKey: ['blocked-numbers'] });
    },
    onError: (e) => toast.error(e),
  });

  const unblockMut = useMutation({
    mutationFn: (id: string) => blockedNumbersApi.unblock(id),
    onSuccess: () => {
      setUnblockTarget(null);
      toast.success('Number unblocked');
      qc.invalidateQueries({ queryKey: ['blocked-numbers'] });
    },
    onError: (e) => toast.error(e),
  });

  const validMobile = /^[6-9]\d{9}$/.test(mobile.trim());

  if (isLoading) return <Loading />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Blocked Patients</h1>
          <p className="muted">
            These patients cannot book online with your clinic. They can still be
            added as walk-ins at the front desk.
          </p>
        </div>
      </div>

      {canEdit && (
        <div className="card" style={{ marginBottom: 16, maxWidth: 560 }}>
          <div className="card-title">Block a number</div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 160px' }}>
              <label className="form-label">Mobile number</label>
              <input
                className="input"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit number"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
            </div>
            <div style={{ flex: '2 1 220px' }}>
              <label className="form-label">Reason (optional)</label>
              <input
                className="input"
                placeholder="e.g. repeated no-shows"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <button
              className="btn btn-primary"
              disabled={!validMobile || blockMut.isPending}
              onClick={() => blockMut.mutate()}
            >
              {blockMut.isPending ? 'Blocking…' : 'Block'}
            </button>
          </div>
          {mobile.length > 0 && !validMobile && (
            <p style={{ color: 'var(--danger, red)', fontSize: 12, marginTop: 6 }}>
              Enter a valid 10-digit mobile number.
            </p>
          )}
        </div>
      )}

      {!data?.length ? (
        <Empty>
          No blocked numbers. If someone is making repeated fake bookings, block
          their number here.
        </Empty>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {data.map((b) => (
            <div key={b.id} className="card" style={{ padding: 14 }}>
              <div
                className="row"
                style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 15 }}>
                    {b.mobile}
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                    {b.reason || 'No reason recorded'}
                  </div>
                </div>
                {canEdit && (
                  <button className="btn btn-sm" onClick={() => setUnblockTarget(b)}>
                    Unblock
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {unblockTarget && (
        <ConfirmDialog
          title="Unblock this number?"
          confirmLabel="Unblock"
          busy={unblockMut.isPending}
          message={
            <>
              <strong>{unblockTarget.mobile}</strong> will be able to book online
              with your clinic again.
            </>
          }
          onCancel={() => setUnblockTarget(null)}
          onConfirm={() => unblockMut.mutate(unblockTarget.id)}
        />
      )}
    </>
  );
}
