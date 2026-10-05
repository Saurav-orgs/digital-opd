import { NavLink, Navigate, useParams } from 'react-router-dom';
import { Bell, FileText, User } from 'lucide-react';
import Profile from './Profile';
import LetterheadPage from './Letterhead';

/**
 * The doctor's own settings, as three tabs on one screen.
 *
 * Profile and Letterhead used to be two menu items and two screens that
 * cross-linked to each other, which meant a doctor changing their clinic
 * address had to know which of the two owned it. They are panes now, and the
 * profile is the single place the address is edited — the letterhead shows it
 * and points back here.
 *
 * Deliberately *not* `/settings`. That path is the platform super admin's
 * screen (the patient-portal base URL, the invoice issuer) and has been for
 * a while. Two audiences, two paths, rather than one component asking who is
 * looking at it.
 *
 * The tab is in the URL rather than in state so a doctor can bookmark the
 * letterhead, and so the browser Back button walks the tabs the way people
 * expect it to.
 */

const TABS = [
  { slug: '', label: 'My profile', icon: User },
  { slug: 'letterhead', label: 'Letterhead', icon: FileText },
  { slug: 'notifications', label: 'Notifications', icon: Bell },
] as const;

type TabSlug = (typeof TABS)[number]['slug'];

export default function MySettings() {
  const { tab } = useParams<{ tab?: string }>();
  const current = (tab ?? '') as TabSlug;

  // A typed-in tab that does not exist lands on the profile rather than on an
  // empty screen.
  if (tab !== undefined && !TABS.some((t) => t.slug === tab)) {
    return <Navigate to="/my-settings" replace />;
  }

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <nav className="tabs" aria-label="Settings sections">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <NavLink
              key={t.slug}
              to={t.slug ? `/my-settings/${t.slug}` : '/my-settings'}
              end={!t.slug}
              className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}
            >
              <Icon size={16} strokeWidth={1.9} />
              {t.label}
            </NavLink>
          );
        })}
      </nav>

      {current === '' && <Profile embedded />}
      {current === 'letterhead' && <LetterheadPage embedded />}
      {current === 'notifications' && <NotificationsTab />}
    </>
  );
}

/**
 * Placeholder, and labelled as one.
 *
 * The design ships this tab; the backend has no per-doctor notification
 * preferences behind it yet. An empty tab that looks finished is worse than
 * one that says what it is — a doctor who toggles nothing and expects
 * something to change is a support call.
 */
function NotificationsTab() {
  return (
    <div className="card">
      <div className="card-title">Notifications</div>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
        Appointment and prescription alerts currently go out over WhatsApp to
        the number on each booking, and cannot be turned off per doctor yet.
        Controls will appear here when they can.
      </p>
    </div>
  );
}
