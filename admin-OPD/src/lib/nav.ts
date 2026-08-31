import type { PermModule } from '../api/types';

export interface NavItem {
  path: string;
  label: string;
  module: PermModule; // sidebar shows only modules the role can `read`
  icon: string;
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
  { path: '/doctors', label: 'Doctors', module: 'doctors', icon: '🏥', superAdminOnly: true },
  { path: '/settings', label: 'Settings', module: 'doctors', icon: '⚙️', superAdminOnly: true },
  // Clinic-side screens: the platform super-admin manages doctors, not patients.
  { path: '/dashboard', label: 'Appointments', module: 'dashboard', icon: '🗓', doctorOnly: true },
  { path: '/pathlabs', label: 'Pathlabs', module: 'pathlabs', icon: '🧪', doctorOnly: true },
  { path: '/reports', label: 'Reports', module: 'reports', icon: '📄', doctorOnly: true },
  { path: '/blocked-numbers', label: 'Blocked Patients', module: 'appointments', icon: '🚫', doctorOnly: true },
  // Hidden for now at the client's request; routes and permissions still work.
  { path: '/users', label: 'Users', module: 'users', icon: '👤', hidden: true },
  { path: '/roles', label: 'Roles', module: 'roles', icon: '🔑', hidden: true },
];
