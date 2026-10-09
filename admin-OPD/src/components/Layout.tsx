import { Fragment, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  NAV,
  NAV_SECTION_LABEL,
  type NavIconName,
  type NavItem,
  type NavSection,
} from '../lib/nav';
import { LogoFull, LogoMark, PoweredByIttitude } from './Brand';
import { useCollapsible } from '../lib/collapsePreference';
import { RAIL, useMediaQuery } from '../lib/useMediaQuery';
import { TOPBAR_SLOT_ID } from './TopbarPortal';
import { ConfirmDialog } from './ui';
import { Clock3, Settings, Zap } from 'lucide-react';
import {
  BlockIcon,
  CalendarIcon,
  WalletIcon,
  ReceiptIcon,
  ChevronIcon,
  DocumentIcon,
  FlaskIcon,
  HospitalIcon,
  PeopleIcon,
  ShieldIcon,
  UserCogIcon,
} from './icons';

const NAV_ICON: Record<NavIconName, (props: { size?: string | number }) => JSX.Element> = {
  calendar: CalendarIcon,
  // First of the lucide glyphs. CLAUDE.md puts new icons here rather than in
  // `icons.tsx`, which is frozen pending the standards-plan icon migration;
  // the redesign needs roughly twenty more, so this is where they land.
  clock: (props) => <Clock3 size={props.size} strokeWidth={1.9} />,
  // A bolt, as the design draws it — the same glyph the template menu
  // uses for a built-in.
  template: (props) => <Zap size={props.size} strokeWidth={1.9} />,
  people: PeopleIcon,
  block: BlockIcon,
  users: UserCogIcon,
  roles: ShieldIcon,
  hospital: HospitalIcon,
  // The design's gear, from lucide like the rest of the new glyphs.
  settings: (props) => <Settings size={props.size} strokeWidth={1.9} />,
  wallet: WalletIcon,
  receipt: ReceiptIcon,
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
  const { user, logout, can, isDoctor, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  /*
   * Sign out is asked about first.
   *
   * It sits at the foot of a rail the doctor is otherwise tapping all day to
   * get between screens, and at 72px wide it is an unlabelled ⏻ one slot
   * below Settings. Pressing it mid-consultation drops the prescription being
   * written and costs a re-login at the desk — and nothing on the way out
   * said so.
   */
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsible('sidebar', true);
  const railMode = useMediaQuery(RAIL);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const items = NAV.filter(
    (n) =>
      !n.hidden &&
      // A self-service screen is about whoever is signed in, so being a doctor
      // is the permission — see `NavItem.selfService`.
      (n.selfService ? isDoctor : can(n.module, 'read')) &&
      (!n.superAdminOnly || isSuperAdmin) &&
      (!n.doctorOnly || !isSuperAdmin) &&
      // Staff the doctor added are `admin` accounts inside the tenant; what
      // the clinic pays for is not theirs to see.
      (!n.ownerOnly || user?.type === 'doctor'),
  );

  /*
    Grouped for the doctor, flat for the super admin.

    The clinic menu splits into "Main menu" and "Practice" with Settings
    pinned at the foot; the platform menu is six items and a heading over it
    would be louder than the list. `ungrouped` is therefore not an "other"
    bucket — it is the whole super-admin menu.
  */
  const ungrouped = items.filter((n) => !n.section);
  const grouped = (Object.keys(NAV_SECTION_LABEL) as NavSection[])
    .map((section) => ({
      section,
      label: NAV_SECTION_LABEL[section],
      items: items.filter((n) => n.section === section),
    }))
    .filter((g) => g.items.length > 0);

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
          {ungrouped.map((n) => (
            <NavItemLink key={n.path} item={n} expanded={expanded} />
          ))}
          {grouped.map((g) => (
            <Fragment key={g.section}>
              {/* The foot group is pushed down rather than headed: Settings
                  belongs at the bottom edge, not under a title. */}
              {g.section === 'bottom' && <div className="spacer" />}
              {g.label && expanded && <div className="nav-heading">{g.label}</div>}
              {g.items.map((n) => (
                <NavItemLink
                  key={n.path}
                  item={n}
                  expanded={expanded}
                  bottom={g.section === 'bottom'}
                />
              ))}
            </Fragment>
          ))}
        </nav>

        {/* Only when nothing was pinned to the foot — otherwise the group
            above brought its own. */}
        {!grouped.some((g) => g.section === 'bottom') && <div className="spacer" />}
        <button
          className="btn btn-logout"
          title={expanded ? undefined : 'Sign out'}
          onClick={() => setConfirmingLogout(true)}
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

      {confirmingLogout && (
        <ConfirmDialog
          title="Sign out?"
          message={
            <>
              Anything you have not saved on this screen is lost, and you will
              need your password to get back in.
            </>
          }
          confirmLabel="Sign out"
          cancelLabel="Stay signed in"
          onConfirm={() => {
            setConfirmingLogout(false);
            logout();
            navigate('/login');
          }}
          onCancel={() => setConfirmingLogout(false)}
        />
      )}
    </div>
  );
}

/**
 * One sidebar row.
 *
 * Lit for the item's own path, for anything nested under it, and for the extra
 * prefixes the item claims (`match` in `nav.ts`) — so Settings stays lit
 * while a tab is open and Appointments stays lit inside a consultation, which
 * lives under `/appointments/:id` rather than under its own `/dashboard`.
 * `NavLink`'s own `end`-less matching would light `/` for everything, which is
 * why the check is written out.
 */
function NavItemLink({
  item,
  expanded,
  bottom,
}: {
  item: NavItem;
  expanded: boolean;
  /** The foot group — Settings — which the design draws as a card. */
  bottom?: boolean;
}) {
  const location = useLocation();
  const Icon = NAV_ICON[item.icon];
  const covers = (prefix: string) =>
    location.pathname === prefix || location.pathname.startsWith(prefix + '/');
  const active = covers(item.path) || (item.match?.some(covers) ?? false);
  return (
    <NavLink
      to={item.path}
      className={`nav-item ${active ? 'active' : ''} ${bottom ? 'is-bottom' : ''}`}
      title={expanded ? undefined : item.label}
    >
      <Icon size={19} />
      <span className="nav-label">{item.label}</span>
    </NavLink>
  );
}
