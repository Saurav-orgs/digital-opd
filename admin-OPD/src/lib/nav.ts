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
  { path: '/dashboard', label: 'Appointments', module: 'dashboard', icon: 'calendar', doctorOnly: true },
  // Hidden from the menu at the client's request. Reports are filed from the
  // appointment they belong to now, which is where the doctor already is —
  // both pages, their routes and their permissions still work if linked to.
  { path: '/pathlabs', label: 'Pathlabs', module: 'pathlabs', icon: 'flask', doctorOnly: true, hidden: true },
  { path: '/reports', label: 'Reports', module: 'reports', icon: 'document', doctorOnly: true, hidden: true },
  // Everyone this clinic has seen, as people rather than as appointments.
  { path: '/patients', label: 'Patients', module: 'appointments', icon: 'people', doctorOnly: true },
  { path: '/blocked-numbers', label: 'Blocked', module: 'appointments', icon: 'block', doctorOnly: true },
  // Clinic staff accounts and what each of them may do. Doctor-side only:
  // the super admin manages tenants, not a clinic's own reception desk.
  { path: '/users', label: 'Users', module: 'users', icon: 'users', doctorOnly: true },
  { path: '/roles', label: 'Roles', module: 'roles', icon: 'roles', doctorOnly: true },
];

/**
 * Modules the clinic's role editor does not offer.
 *
 * Not a permission change — the rows still exist server-side, and a role that
 * already holds them keeps them, because editing a role resubmits what it
 * holds rather than what happens to be on screen. Purely a question of which
 * choices are worth putting in front of a clinic admin:
 *
 *   pathlabs, reports  — their screens are gone from the sidebar, so granting
 *                        them buys nothing.
 *   doctors            — the screens behind it (Doctors, Settings) belong to
 *                        the platform super admin.
 *   opd_schedules      — the doctor's own schedule, reached from My profile.
 *                        The doctor's login bypasses permission checks anyway,
 *                        so the grant never applied to the one person using it.
 *
 * Delete a name from this list to bring its row straight back.
 */
export const MODULES_HIDDEN_FROM_ROLES: PermModule[] = [
  'pathlabs',
  'reports',
  'doctors',
  'opd_schedules',
];
