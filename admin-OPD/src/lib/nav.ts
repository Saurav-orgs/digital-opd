import type { PermModule } from '../api/types';

/**
 * Which icon a menu item draws. A name rather than a component so this stays a
 * plain config module with no JSX in it; `Layout` maps the name to the glyph.
 */
export type NavIconName =
  | 'calendar'
  | 'wallet'
  | 'receipt'
  | 'people'
  | 'block'
  | 'users'
  | 'roles'
  | 'hospital'
  | 'settings'
  | 'flask'
  | 'clock'
  | 'template'
  | 'document';

/**
 * Which group a menu item sits under.
 *
 * The design splits the menu into "Main menu" — the screens a doctor is in
 * all day — and "Practice", the ones they visit when something about the
 * business changes. Settings sits on its own at the bottom, away from both,
 * because it is where you go when nothing is going wrong.
 *
 * The order of this type is the order the groups render in.
 */
export type NavSection = 'main' | 'practice' | 'bottom';

export const NAV_SECTION_LABEL: Record<NavSection, string | null> = {
  main: 'Main menu',
  practice: 'Practice',
  // No heading: it is one item, pinned to the foot of the sidebar, and a
  // heading over a single row is furniture.
  bottom: null,
};

export interface NavItem {
  path: string;
  label: string;
  module: PermModule; // sidebar shows only modules the role can `read`
  icon: NavIconName;
  /** Which group this sits under. Super-admin items have no group. */
  section?: NavSection;
  /**
   * The screen is about the signed-in person rather than about a module, so
   * being that person is the permission. Settings is the only one: a doctor
   * can always reach their own profile and letterhead, whatever `doctors`
   * their role happens to hold. This is how "My profile" already behaved —
   * `Layout` rendered it outside the permission filter — written down rather
   * than special-cased in the component.
   */
  selfService?: boolean;
  /** When true, only the platform super-admin sees this item. */
  superAdminOnly?: boolean;
  /** When true, the super-admin does not see it — it is clinic-side only. */
  doctorOnly?: boolean;
  /**
   * When true, only the doctor who owns the clinic sees it — not the staff
   * they added. What the clinic pays for is the doctor's own business.
   */
  ownerOnly?: boolean;
  /**
   * Temporarily hidden from the sidebar. The page, its route and its
   * permissions all stay in place — this only takes it out of the menu, so
   * showing it again is a one-line change.
   */
  hidden?: boolean;
  /**
   * Extra route prefixes that belong to this item, for the lit state.
   *
   * `Layout` lights an item for its own `path` and anything nested under it,
   * which covers `/patients` → `/patients/:id` but not a screen that lives
   * somewhere else entirely: Appointments is `/dashboard`, and opening a visit
   * goes to `/appointments/:id`, so the sidebar used to go dark on the screen
   * the doctor spends the consultation on — nothing lit, and no way to tell
   * where you were.
   */
  match?: string[];
}

/**
 * Sidebar config — rendered dynamically from the user's read permissions.
 *
 * Clinic-side items carry a `section`; the super admin's do not, because that
 * menu is short and ungrouped. Items are rendered in the order of
 * `NAV_SECTION_LABEL`, not the order of this array, so a new item can go
 * wherever it reads best here.
 */
export const NAV: NavItem[] = [
  { path: '/doctors', label: 'Doctors', module: 'doctors', icon: 'hospital', superAdminOnly: true },
  // Billing — the platform's own business, so super-admin only, next to the
  // tenants it bills. `doctors` is the permission behind them; the controller
  // narrows to the super admin, the same way Settings does.
  { path: '/plans', label: 'Plans', module: 'doctors', icon: 'wallet', superAdminOnly: true },
  { path: '/subscriptions', label: 'Subscriptions', module: 'doctors', icon: 'receipt', superAdminOnly: true },
  { path: '/payment-log', label: 'Payment log', module: 'doctors', icon: 'receipt', superAdminOnly: true },
  { path: '/settings', label: 'Settings', module: 'doctors', icon: 'settings', superAdminOnly: true },
  // Clinic-side screens: the platform super-admin manages doctors, not patients.
  // One screen, one permission: the counters on top of the list are not a
  // separate ability, so the item and the API behind it both ask for
  // `appointments`. `dashboard` stays in the catalogue for old grants only.
  {
    path: '/dashboard',
    label: 'Appointments',
    module: 'appointments',
    icon: 'calendar',
    doctorOnly: true,
    section: 'main',
    // The visit and the patient-history screen behind it are this item's own.
    match: ['/appointments'],
  },
  // Everyone this clinic has seen, as people rather than as appointments.
  { path: '/patients', label: 'Patients', module: 'patients', icon: 'people', doctorOnly: true, section: 'main' },
  // The doctor's own consulting hours. It lived at /profile/schedule, two
  // clicks deep behind a button on the profile form, which is a strange place
  // for the screen that decides whether anybody can book at all. The old path
  // redirects here.
  {
    path: '/time-slots',
    label: 'My time slots',
    module: 'opd_schedules',
    icon: 'clock',
    doctorOnly: true,
    section: 'main',
  },
  // Saved prescriptions the doctor applies to a visit. Clinical, used during
  // a consultation rather than between them, so it belongs in Main menu with
  // the screens the doctor is in all day.
  {
    path: '/templates',
    label: 'My templates',
    module: 'appointments',
    icon: 'template',
    doctorOnly: true,
    section: 'main',
  },
  // Out of the menu, as the design has it. Filing a report now happens inside
  // the appointment, and that upload is gated on `reports:create` rather than
  // on `appointments:update` — so a pathlab desk reaches its work through the
  // visit instead of through a screen of its own.
  //
  // Route and page stay, `hidden` like Pathlabs and Blocked: putting the
  // standalone screen back for a clinic that files reports with no visit open
  // is a one-line change, not a rebuild.
  { path: '/reports', label: 'Upload reports', module: 'reports', icon: 'document', doctorOnly: true, hidden: true },
  // Pathlab login accounts. Still hidden from the menu: the page manages
  // logins, not reports, and nobody has asked for it back. Route, page and
  // permissions remain in place.
  { path: '/pathlabs', label: 'Pathlabs', module: 'pathlabs', icon: 'flask', doctorOnly: true, hidden: true },
  // Out of the menu: blocking belongs next to the people it affects, so it is
  // reached from Patients now. Route and page stay exactly where they were.
  { path: '/blocked-numbers', label: 'Blocked', module: 'appointments', icon: 'block', doctorOnly: true, hidden: true },
  // Clinic staff accounts and what each of them may do. Doctor-side only:
  // the super admin manages tenants, not a clinic's own reception desk. The
  // route and the permission module keep the old name; only the words the
  // doctor sees changed.
  { path: '/users', label: 'My team', module: 'users', icon: 'users', doctorOnly: true, section: 'practice' },
  // The doctor's own plan and invoices. Clinic-side, but not for the team:
  // `ownerOnly` keeps it to the account the subscription belongs to. The
  // permission is `users` only because every item needs one the role can
  // read — the API behind it is scoped to the caller, not to a module.
  // Named for what the doctor came to do — look at their plan — rather than
  // for the department that files it. /billing redirects here.
  {
    path: '/subscription',
    label: 'Subscription',
    module: 'users',
    icon: 'wallet',
    doctorOnly: true,
    ownerOnly: true,
    section: 'practice',
  },
  // Out of the menu: permissions are ticked straight on the team member now
  // (My Team keeps a role per person behind the scenes), so a separate Roles
  // screen only asked the doctor to name things twice. Route and page stay.
  { path: '/roles', label: 'Roles', module: 'roles', icon: 'roles', doctorOnly: true, hidden: true },
  // The doctor's own settings — profile, letterhead, notifications — as tabs
  // on one screen. Deliberately not `/settings`: that is the platform super
  // admin's screen and has been for a while. Two audiences, two paths, rather
  // than one component asking who is looking at it.
  {
    path: '/my-settings',
    label: 'Settings',
    module: 'doctors',
    icon: 'settings',
    doctorOnly: true,
    section: 'bottom',
    selfService: true,
  },
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
