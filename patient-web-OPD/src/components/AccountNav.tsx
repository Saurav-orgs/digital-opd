import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, User, LogIn, FileText, CalendarClock, LogOut } from 'lucide-react';
import { usePatientAuth } from '../auth/PatientAuthContext';
import { patientApi } from '../patientApi';

/** Signed-in account menu (visits/reports/bell+badge) or a Sign-in link. */
export const AccountNav: React.FC = () => {
  const { patient, loading, logout } = usePatientAuth();

  const { data } = useQuery({
    queryKey: ['patient-unread-count'],
    queryFn: patientApi.unreadCount,
    enabled: !!patient,
    refetchInterval: 30_000,
  });
  const unread = data?.count ?? 0;

  if (loading) return null;

  if (!patient) {
    return (
      <Link to="/login" className="web-contact-pill" style={{ textDecoration: 'none' }}>
        <LogIn size={14} />
        <span>Login</span>
      </Link>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
      <Link to="/visits" className="web-contact-pill" style={{ textDecoration: 'none' }} title="My visits">
        <CalendarClock size={14} />
        <span>Visits</span>
      </Link>
      <Link to="/reports" className="web-contact-pill" style={{ textDecoration: 'none' }} title="My reports">
        <FileText size={14} />
        <span>Reports</span>
      </Link>
      <Link
        to="/notifications"
        style={{ position: 'relative', display: 'inline-flex', color: 'inherit' }}
        title="Notifications"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -6,
              background: '#EF4444',
              color: '#fff',
              borderRadius: '999px',
              fontSize: '10px',
              fontWeight: 700,
              minWidth: 16,
              height: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Link>
      <button
        onClick={logout}
        title={`Sign out (${patient.name})`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
      >
        <User size={18} />
        <LogOut size={14} />
      </button>
    </div>
  );
};
