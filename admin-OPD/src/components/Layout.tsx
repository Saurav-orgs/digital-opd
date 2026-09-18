import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { NAV, type NavIconName } from '../lib/nav';
import { LogoFull, LogoMark, PoweredByIttitude } from './Brand';
import { useCollapsible } from '../lib/collapsePreference';
import { RAIL, useMediaQuery } from '../lib/useMediaQuery';
import { TOPBAR_SLOT_ID } from './TopbarPortal';
import {
  AccountIcon,
  BlockIcon,
  CalendarIcon,
  ChevronIcon,
  DocumentIcon,
  FlaskIcon,
  GearIcon,
  HospitalIcon,
  PeopleIcon,
  ShieldIcon,
  UserCogIcon,
} from './icons';

const NAV_ICON: Record<NavIconName, (props: { size?: string | number }) => JSX.Element> = {
  calendar: CalendarIcon,
  people: PeopleIcon,
  block: BlockIcon,
  users: UserCogIcon,
  roles: ShieldIcon,
  hospital: HospitalIcon,
  settings: GearIcon,
  flask: FlaskIcon,
  document: DocumentIcon,
};

/**
 * The app shell.
 *
 * Two shapes, per the design's own breakpoint. Below 700px the sidebar is an
 * off-canvas drawer over a top bar; at and above it the drawer becomes a
 * permanent 72px rail of icons that expands to 240px on request.
 *
 * The rail is the default rather than the expanded menu because the doctor
 * knows these seven destinations by their second day, and the 168px it gives
 * back is a column of the appointment table. The choice is remembered — a
 * doctor who expands the menu is saying they want the labels, and re-collapsing
 * it on every page load would be answering them back.
 */
export default function Layout() {
  const { logout, can, isDoctor, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsible('sidebar', true);
  const railMode = useMediaQuery(RAIL);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const items = NAV.filter(
    (n) =>
      !n.hidden &&
      can(n.module, 'read') &&
      (!n.superAdminOnly || isSuperAdmin) &&
      (!n.doctorOnly || !isSuperAdmin),
  );

  // On a phone the drawer is either open or off-canvas; "collapsed" is a
  // rail-only idea and would otherwise hide the labels inside the drawer.
  const expanded = railMode ? !collapsed : true;

  return (
    <div className="app-shell">
      {drawerOpen && (
        <div className="sidebar-overlay" onClick={() => setDrawerOpen(false)} />
      )}
      <aside
        className={`sidebar ${drawerOpen ? 'open' : ''} ${expanded ? 'expanded' : ''}`}
      >
        {railMode && (
          <button
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={expanded ? 'Collapse menu' : 'Expand menu'}
            title={expanded ? 'Collapse menu' : 'Expand menu'}
          >
            <ChevronIcon direction={expanded ? 'left' : 'right'} size={15} />
          </button>
        )}

        {/* Home: `/` picks the first screen this account may see — the
            appointments list for anyone who can read it. */}
        <Link to="/" className="sidebar-logo" title="Home">
          {expanded ? (
            <LogoFull markSize={34} />
          ) : (
            <LogoMark size={36} />
          )}
        </Link>

        <nav className="sidebar-items">
          {items.map((n) => {
            const Icon = NAV_ICON[n.icon];
            return (
              <NavLink
                key={n.path}
                to={n.path}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                title={expanded ? undefined : n.label}
              >
                <Icon size={19} />
                <span className="nav-label">{n.label}</span>
              </NavLink>
            );
          })}
          {isDoctor && (
            // Lit for the profile and everything under it — schedule and the
            // letterhead, which is reached from the profile rather than from
            // its own menu item.
            <NavLink
              to="/profile"
              className={() =>
                `nav-item ${location.pathname.startsWith('/profile') ? 'active' : ''}`
              }
              title={expanded ? undefined : 'My profile'}
            >
              <AccountIcon size={19} />
              <span className="nav-label">My profile</span>
            </NavLink>
          )}
        </nav>

        <div className="spacer" />
        <button
          className="btn btn-logout"
          title={expanded ? undefined : 'Sign out'}
          onClick={() => {
            logout();
            navigate('/login');
          }}
        >
          <span className="nav-label">Sign out</span>
          <span className="logout-short" aria-hidden>
            ⏻
          </span>
        </button>
        <PoweredByIttitude className="sidebar-powered-by" />
      </aside>

      <div className="main">
        {/*
          The phone top bar is the hamburger plus whatever the screen puts
          beside it (see `TopbarPortal`) — the appointment list uses the room
          for its title and the doctor's initials, the consultation screen
          leaves it empty. The wordmark used to sit on the right; it is on the
          drawer the button opens, and repeating it here only ate the width
          the screen underneath actually needs.
        */}
        <header className="topbar">
          <button
            className="hamburger"
            aria-label="Menu"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="topbar-slot" id={TOPBAR_SLOT_ID} />
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
