import type { PermModule } from '../api/types';

export interface NavItem {
  path: string;
  label: string;
  module: PermModule; // sidebar shows only modules the role can `read`
  icon: string;
  /** When true, only the platform super-admin sees this item. */
  superAdminOnly?: boolean;
}

/** Sidebar config — rendered dynamically from the user's read permissions. */
export const NAV: NavItem[] = [
  { path: '/doctors', label: 'Doctors', module: 'doctors', icon: '🏥', superAdminOnly: true },
  { path: '/dashboard', label: 'Appointments', module: 'dashboard', icon: '🗓' },
  { path: '/pathlabs', label: 'Pathlabs', module: 'pathlabs', icon: '🧪' },
  { path: '/reports', label: 'Reports', module: 'reports', icon: '📄' },
  { path: '/users', label: 'Users', module: 'users', icon: '👤' },
  { path: '/roles', label: 'Roles', module: 'roles', icon: '🔑' },
];
