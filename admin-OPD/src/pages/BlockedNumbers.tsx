import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { blockedNumbersApi } from '../api/endpoints';
import type { BlockedNumber } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog, Empty, Loading } from '../components/ui';
import { SearchIcon } from '../components/icons';
import { NARROW, useMediaQuery } from '../lib/useMediaQuery';
import { avatarTone, initials } from '../lib/avatar';

function prettyDate(iso: string | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The people on the row, as one line: "Priya Verma, Ramesh Verma". */
function namesOf(b: BlockedNumber) {
  return (b.patients ?? []).map((p) => p.name).join(', ');
}

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

  const narrow = useMediaQuery(NARROW);
  const [mobile, setMobile] = useState('');
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  const [unblockTarget, setUnblockTarget] = useState<BlockedNumber | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['blocked-numbers'],
    queryFn: blockedNumbersApi.list,
  });

  // A name, a number or a patient code — the list is short enough to filter
  // in the browser, and the desk types whichever they have in front of them.
  const rows = useMemo(() => {
    const all = data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (b) =>
        b.mobile.includes(q) ||
        (b.reason ?? '').toLowerCase().includes(q) ||
        (b.patients ?? []).some(
          (p) => p.name.toLowerCase().includes(q) || p.patient_code.toLowerCase().includes(q),
        ),
    );
  }, [data, query]);

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

      <div className="list-panel">
        <div className="list-panel-head">
          <div className="dash-search">
            <span className="dash-search-icon" aria-hidden>
              <SearchIcon size={17} />
            </span>
            <input
              className="input"
              type="search"
              placeholder="Search blocked patients by name, number or ID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {!data?.length ? (
          <Empty>
            No blocked patients. If someone is making repeated fake bookings, block
            their number here.
          </Empty>
        ) : !rows.length ? (
          <Empty>No blocked patient matches that search.</Empty>
        ) : narrow ? (
          <div className="appt-cards">
            {rows.map((b) => {
              const names = namesOf(b);
              return (
                <div key={b.id} className="appt-card" style={{ cursor: 'default' }}>
                  <div className="appt-card-main">
                    <span className={`appt-avatar ${avatarTone(names || b.mobile)}`} aria-hidden>
                      {names ? initials(names.split(',')[0]) : '#'}
                    </span>
                    <div className="appt-body">
                      <div className="appt-card-top">
                        <span className="appt-card-name">{names || 'No patient registered yet'}</span>
                      </div>
                      <div className="appt-meta">{b.mobile}</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {b.reason || 'No reason recorded'}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        Blocked {prettyDate(b.createdAt ?? b.created_at)}
                        {b.blocked_by ? ` by ${b.blocked_by.name}` : ''}
                      </div>
                    </div>
                    {canEdit && (
                      <button className="btn btn-sm" onClick={() => setUnblockTarget(b)}>
                        Unblock
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Mobile</th>
                  <th>Reason</th>
                  <th>Blocked on</th>
                  <th>Blocked by</th>
                  {canEdit && <th style={{ width: 1 }} />}
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>
                      {b.patients?.length ? (
                        <div className="stack" style={{ gap: 4 }}>
                          {b.patients.map((p) => (
                            <span key={p.id} className="row-name-cell">
                              <span className={`appt-avatar sm ${avatarTone(p.name)}`} aria-hidden>
                                {initials(p.name)}
                              </span>
                              <Link to={`/patients/${p.id}`}>{p.name}</Link>
                              <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                                {p.patient_code}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="muted" style={{ fontWeight: 400 }}>
                          No patient registered yet
                        </span>
                      )}
                    </td>
                    <td className="muted" style={{ fontFamily: 'monospace' }}>{b.mobile}</td>
                    <td className="muted">{b.reason || '—'}</td>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {prettyDate(b.createdAt ?? b.created_at)}
                    </td>
                    <td className="muted">{b.blocked_by?.name ?? '—'}</td>
                    {canEdit && (
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-sm" onClick={() => setUnblockTarget(b)}>
                          Unblock
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {unblockTarget && (
        <ConfirmDialog
          title="Unblock this number?"
          confirmLabel="Unblock"
          busy={unblockMut.isPending}
          message={
            <>
              <strong>{namesOf(unblockTarget) || unblockTarget.mobile}</strong>
              {namesOf(unblockTarget) ? ` (${unblockTarget.mobile})` : ''} will be able to
              book online with your clinic again.
            </>
          }
          onCancel={() => setUnblockTarget(null)}
          onConfirm={() => unblockMut.mutate(unblockTarget.id)}
        />
      )}
    </>
  );
}
