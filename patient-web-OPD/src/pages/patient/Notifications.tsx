import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, FileCheck, CalendarClock } from 'lucide-react';
import { patientApi } from '../../patientApi';
import { useDoctorCtx } from '../../context/DoctorContext';
import { StateView } from '../../components/StateView';
import { usePatientAuth } from '../../auth/PatientAuthContext';

export const Notifications: React.FC = () => {
  const qc = useQueryClient();
  const { doctor } = useDoctorCtx();
  // Account-wide on purpose: the bell covers the whole family. Rows are tagged
  // with the patient's name so it stays clear who each one is about.
  const { profiles } = usePatientAuth();
  const nameOf = (id: string | null) =>
    (id && profiles.find((p) => p.id === id)?.name) || null;
  const { data: items, isLoading, error, refetch } = useQuery({
    queryKey: ['patient-notifications', doctor?.id],
    queryFn: () => patientApi.notifications(doctor?.id),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['patient-notifications'] });
    qc.invalidateQueries({ queryKey: ['patient-unread-count'] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => patientApi.markRead(id),
    onSuccess: invalidate,
  });
  const markAllRead = useMutation({
    mutationFn: () => patientApi.markAllRead(),
    onSuccess: invalidate,
  });

  const unreadCount = items?.filter((n) => !n.read_at).length ?? 0;

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text)', margin: '0 0 4px' }}>
            Notifications
          </h2>
          <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '14px' }}>
            Updates about your reports and upcoming visits.
          </p>
        </div>
        {unreadCount > 0 && (
          <button className="btn-outlined" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
            Mark all read
          </button>
        )}
      </div>

      {isLoading ? (
        <StateView loading />
      ) : error ? (
        <StateView
          error={error instanceof Error ? error.message : 'Could not load notifications.'}
          onRetry={() => refetch()}
        />
      ) : !items?.length ? (
        <StateView empty="No notifications yet." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {items.map((n) => {
            const Icon = n.type === 'report_available' ? FileCheck : n.type === 'appointment_reminder' ? CalendarClock : Bell;
            return (
              <div
                key={n.id}
                className="section-card"
                style={{
                  display: 'flex',
                  gap: '12px',
                  cursor: n.read_at ? 'default' : 'pointer',
                  background: n.read_at ? undefined : '#EFF6FF',
                }}
                onClick={() => !n.read_at && markRead.mutate(n.id)}
              >
                <Icon size={20} color="var(--primary)" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--text)' }}>{n.title}</div>
                  {profiles.length > 1 && nameOf(n.patient_profile_id) && (
                    <div style={{ fontSize: '12px', color: 'var(--primary)', marginTop: '1px' }}>
                      For {nameOf(n.patient_profile_id)}
                    </div>
                  )}
                  {n.body && (
                    <div style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>{n.body}</div>
                  )}
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
                    {new Date(n.createdAt).toLocaleString()}
                  </div>
                </div>
                {!n.read_at && (
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0, marginTop: '6px' }} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
