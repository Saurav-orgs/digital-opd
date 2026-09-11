import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, User, LogIn, FileText, CalendarClock, LogOut, Plus, Menu, X } from 'lucide-react';
import { usePatientAuth } from '../auth/PatientAuthContext';
import { patientApi } from '../patientApi';
import { useDoctorCtx } from '../context/DoctorContext';

/** Signed-in account menu (visits/reports/bell+badge) or a Sign-in link. */
export const AccountNav: React.FC = () => {
  const { patient, loading, logout } = usePatientAuth();
  const { doctor } = useDoctorCtx();
  const location = useLocation();

  /*
   * Signed in, the bar carries five things next to the brand lockup — book,
   * visits, reports, notifications, sign out — which does not fit a phone and
   * was wrapping the header onto a second line. Below the breakpoint the
   * links collapse in here instead; the bell stays out, because an unread
   * badge is no use hidden behind a menu.
   */
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [location.pathname]);

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

  /*
   * Booking is what a patient comes back to do, so it stays reachable from
   * the visits and reports pages rather than only from the doctor's landing
   * page. Straight to that doctor's date picker when we know who they came
   * from; "/" otherwise, which explains how to find their doctor.
   */
  const bookHref = doctor ? `/d/${doctor.slug}` : '/';

  const bell = (
    <Link to="/notifications" className="account-bell" title="Notifications">
      <Bell size={20} />
      {unread > 0 && (
        <span className="account-bell-badge">{unread > 9 ? '9+' : unread}</span>
      )}
    </Link>
  );

  return (
    <div className="account-nav">
      {/* Wide screens: everything on one row, as before. */}
      <div className="account-nav-wide">
        <Link to={bookHref} className="web-cta-pill" title="Book a new appointment">
          <Plus size={15} />
          <span>Appointment</span>
        </Link>
        <Link to="/visits" className="web-contact-pill web-nav-pill" style={{ textDecoration: 'none' }} title="My visits">
          <CalendarClock size={14} />
          <span>Visits</span>
        </Link>
        <Link to="/reports" className="web-contact-pill web-nav-pill" style={{ textDecoration: 'none' }} title="My reports">
          <FileText size={14} />
          <span>Reports</span>
        </Link>
      </div>

      {bell}

      <button onClick={logout} className="account-signout" title={`Sign out (${patient.mobile})`}>
        <User size={18} />
        <LogOut size={14} />
      </button>

      <button
        className="nav-hamburger"
        aria-label={menuOpen ? 'Close menu' : 'Menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {menuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {menuOpen && (
        <>
          {/* Tapping anywhere else closes it — on a phone there is no cursor
              to move away, so the sheet needs a way out that is not the icon. */}
          <div className="nav-menu-backdrop" onClick={() => setMenuOpen(false)} />
          <div className="nav-menu" role="menu">
            <Link to={bookHref} className="nav-menu-item primary" role="menuitem">
              <Plus size={16} />
              <span>Book appointment</span>
            </Link>
            <Link to="/visits" className="nav-menu-item" role="menuitem">
              <CalendarClock size={16} />
              <span>My visits</span>
            </Link>
            <Link to="/reports" className="nav-menu-item" role="menuitem">
              <FileText size={16} />
              <span>My reports</span>
            </Link>
            <div className="nav-menu-sep" />
            <div className="nav-menu-mobile">{patient.mobile}</div>
            <button
              className="nav-menu-item danger"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                logout();
              }}
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};
