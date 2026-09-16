import type { PermModule } from '../api/types';

/**
 * Which icon a menu item draws. A name rather than a component so this stays a
 * plain config module with no JSX in it; `Layout` maps the name to the glyph.
 */
export type NavIconName =
  | 'calendar'
  | 'people'
  | 'block'
  | 'users'
  | 'roles'
  | 'hospital'
  | 'settings'
  | 'flask'
  | 'document';

export interface NavItem {
  path: string;
  label: string;
  module: PermModule; // sidebar shows only modules the role can `read`
  icon: NavIconName;
  /** When true, only the platform super-admin sees this item. */
  superAdminOnly?: boolean;
  /** When true, the super-admin does not see it — it is clinic-side only. */
  doctorOnly?: boolean;
  /**
   * Temporarily hidden from the sidebar. The page, its route and its
   * permissions all stay in place — this only takes it out of the menu, so
   * showing it again is a one-line change.
   */
  hidden?: boolean;
}

/** Sidebar config — rendered dynamically from the user's read permissions. */
export const NAV: NavItem[] = [
  { path: '/doctors', label: 'Doctors', module: 'doctors', icon: 'hospital', superAdminOnly: true },
  { path: '/settings', label: 'Settings', module: 'doctors', icon: 'settings', superAdminOnly: true },
  // Clinic-side screens: the platform super-admin manages doctors, not patients.
  // One screen, one permission: the counters on top of the list are not a
  // separate ability, so the item and the API behind it both ask for
  // `appointments`. `dashboard` stays in the catalogue for old grants only.
  { path: '/dashboard', label: 'Appointments', module: 'appointments', icon: 'calendar', doctorOnly: true },
  // Everyone this clinic has seen, as people rather than as appointments.
  { path: '/patients', label: 'Patients', module: 'patients', icon: 'people', doctorOnly: true },
  // Report upload by mobile number, for the desk and pathlab staff. Doctors
  // still file reports from the appointment itself; this is the route for a
  // report that arrives without a visit open — a role holding `reports`
  // sees it.
  { path: '/reports', label: 'Upload reports', module: 'reports', icon: 'document', doctorOnly: true },
  // Pathlab login accounts. Still hidden from the menu: the page manages
  // logins, not reports, and nobody has asked for it back. Route, page and
  // permissions remain in place.
  { path: '/pathlabs', label: 'Pathlabs', module: 'pathlabs', icon: 'flask', doctorOnly: true, hidden: true },
  { path: '/blocked-numbers', label: 'Blocked', module: 'appointments', icon: 'block', doctorOnly: true },
  // Clinic staff accounts and what each of them may do. Doctor-side only:
  // the super admin manages tenants, not a clinic's own reception desk. The
  // route and the permission module keep the old name; only the words the
  // doctor sees changed.
  { path: '/users', label: 'My Team', module: 'users', icon: 'users', doctorOnly: true },
  // Out of the menu: permissions are ticked straight on the team member now
  // (My Team keeps a role per person behind the scenes), so a separate Roles
  // screen only asked the doctor to name things twice. Route and page stay.
  { path: '/roles', label: 'Roles', module: 'roles', icon: 'roles', doctorOnly: true, hidden: true },
];

/**
 * Modules the clinic's role editor does not offer.
 *
 * Not a permission change — the rows still exist server-side, and a role that
 * already holds them keeps them, because editing a role resubmits what it
 * holds rather than what happens to be on screen. Purely a question of which
 * choices are worth putting in front of a clinic admin:
 *
 *   pathlabs           — its screen is gone from the sidebar, so granting it
 *                        buys nothing.
 *   doctors            — the screens behind it (Doctors, Settings) belong to
 *                        the platform super admin.
 *   opd_schedules      — the doctor's own schedule, reached from My profile.
 *   activity           — the audit log has no screen in this app.
 *   dashboard          — folded into `appointments`: the list and its
 *                        counters are one screen, and asking twice only
 *                        made admins wonder which box the doctor needed.
 *
 * Delete a name from this list to bring its row straight back.
 */
export const MODULES_HIDDEN_FROM_ROLES: PermModule[] = [
  'pathlabs',
  'doctors',
  'opd_schedules',
  'activity',
  'dashboard',
];

/**
 * How the role editor names a module. The sidebar label where there is one,
 * so an admin ticking "Upload reports" can see which menu item they are
 * granting; a plain name for the rest.
 */
export const MODULE_LABEL: Record<PermModule, string> = {
  dashboard: 'Dashboard',
  appointments: 'Appointments',
  patients: 'Patients',
  reports: 'Upload reports',
  users: 'My Team',
  roles: 'Roles',
  pathlabs: 'Pathlabs',
  doctors: 'Doctors',
  opd_schedules: 'OPD schedules',
  activity: 'Activity log',
};

/**
 * The rows of the role editor, top to bottom.
 *
 * Fixed here rather than left to the order the API happens to return, because
 * the order carries meaning: the client asked that a new role start with
 * everything ticked *except the last two rows* — the team and role screens
 * are the ones a receptionist should not get by default, so they sit last.
 */
export const ROLE_MODULE_ORDER: PermModule[] = [
  'appointments',
  'patients',
  'reports',
  'users',
  'roles',
];

/** How many rows at the bottom of the matrix a new role starts *without*. */
export const ROLE_MODULES_UNTICKED_BY_DEFAULT = 2;
