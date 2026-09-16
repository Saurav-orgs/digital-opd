/*
 * Small inline SVG icons.
 *
 * The admin app has no icon dependency and used emoji, which is fine where the
 * glyph sits alone in its own box. It is not fine inline next to text: an emoji
 * is drawn from a colour font at its own metrics, so at 12px it comes out
 * visibly larger than the line it sits on and its advance width runs under the
 * first character or two of whatever follows. That is what was clipping the
 * leading digits of the phone number.
 *
 * The redesign's collapsed sidebar makes that worse rather than better: at 72px
 * the icon *is* the menu item, with no label beside it to carry the meaning, so
 * seven emoji at seven different optical weights read as a jumble. These are
 * one stroke weight on one grid, and they take `currentColor`, so an active
 * item tints its icon by inheritance.
 *
 * All are sized in `em`, so they scale with whatever they sit beside.
 */

interface IconProps {
  size?: string | number;
}

/** Shared frame: one viewBox, one stroke weight, colour by inheritance. */
function Icon({
  size = '1em',
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

export function PhoneIcon({ size = '1em' }: { size?: string | number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export function PinIcon({ size = '1em' }: { size?: string | number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

// ── Sidebar ────────────────────────────────────────────────

export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Icon>
  );
}

export function PeopleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
      <circle cx="9" cy="7" r="3.2" />
      <path d="M22 20v-1.5a4 4 0 0 0-3-3.87M16.5 4.2a4 4 0 0 1 0 7.6" />
    </Icon>
  );
}

export function BlockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </Icon>
  );
}

export function UserCogIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="7.5" r="3.5" />
      <path d="M3.5 20v-1.5a4 4 0 0 1 4-4h4" />
      <circle cx="17.5" cy="17.5" r="2.5" />
      <path d="M17.5 13.4v1.1M17.5 20.5v1.1M21.1 15.5l-1 .6M14.9 19l-1 .6M21.1 19.5l-1-.6M14.9 16l-1-.6" />
    </Icon>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2.8l7.5 3v5.4c0 4.4-3 8.4-7.5 10-4.5-1.6-7.5-5.6-7.5-10V5.8z" />
      <path d="M9.2 12.2l2 2 3.6-3.8" />
    </Icon>
  );
}

export function AccountIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3.2" />
      <path d="M5.8 18.6a7.3 7.3 0 0 1 12.4 0" />
    </Icon>
  );
}

export function HospitalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 21V8.5L12 4l8 4.5V21" />
      <path d="M9.6 11.4h4.8M12 9v4.8" />
      <path d="M9.5 21v-4.2h5V21" />
    </Icon>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3" />
    </Icon>
  );
}

export function FlaskIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 3v6.2L4.8 18a2 2 0 0 0 1.7 3h11a2 2 0 0 0 1.7-3L14 9.2V3" />
      <path d="M8.6 3h6.8M7.2 14.5h9.6" />
    </Icon>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Icon>
  );
}

/** A prescription pad: a sheet with a ruled header band. */
export function LetterheadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M5 8.5h14M8 12.5h8M8 16h5" />
    </Icon>
  );
}

// ── Sidebar rail ───────────────────────────────────────────

export function ChevronIcon({
  size = '1em',
  direction = 'right',
}: IconProps & { direction?: 'left' | 'right' }) {
  return (
    <Icon size={size}>
      <path d={direction === 'left' ? 'M14.5 5.5L8 12l6.5 6.5' : 'M9.5 5.5L16 12l-6.5 6.5'} />
    </Icon>
  );
}

// ── Consultation ───────────────────────────────────────────

export function SparkleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.2l1.9 4.9 4.9 1.9-4.9 1.9L12 16.8l-1.9-4.9-4.9-1.9 4.9-1.9z" />
      <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </Icon>
  );
}

export function PrinterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 9V3h10v6" />
      <path d="M7 19H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <path d="M7 15h10v6H7z" />
    </Icon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5v11M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 17v1.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V17" />
    </Icon>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="17.5" cy="6" r="2.6" />
      <circle cx="6.5" cy="12" r="2.6" />
      <circle cx="17.5" cy="18" r="2.6" />
      <path d="M8.8 10.8l6.4-3.5M8.8 13.2l6.4 3.5" />
    </Icon>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15.5v-11M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4 17v1.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V17" />
    </Icon>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8.5h3.2L8 6h8l1.8 2.5H21v11H3z" />
      <circle cx="12" cy="13.5" r="3.4" />
    </Icon>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V21.5M9 21.5h6" />
    </Icon>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" />
    </Icon>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 13h.01M16.5 13h.01M9 16h6" />
    </Icon>
  );
}

export function PenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15.5 4.5l4 4L8 20H4v-4z" />
      <path d="M13.5 6.5l4 4" />
    </Icon>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.2l2.7 2.7L16 9.6" />
    </Icon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </Icon>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.5h16M7 12h10M10 17.5h4" />
    </Icon>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.2 4.5v4.8h4.8" />
    </Icon>
  );
}

export function PlusPersonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="7.5" r="3.5" />
      <path d="M3.5 20v-1.5a4 4 0 0 1 4-4H12" />
      <path d="M17.5 14v6M14.5 17h6" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </Icon>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function QrIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3M21 14v3M14 21h3M21 21h-1" />
    </Icon>
  );
}

/** Four corners pulling outward: open this bigger. */
export function MaximizeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

export function PdfIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 17v-4h1.2a1.2 1.2 0 0 1 0 2.4H8.5M13 17v-4h1a2 2 0 0 1 0 4z" />
    </Icon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9" />
      <path d="M10.3 19a2 2 0 0 0 3.4 0" />
    </Icon>
  );
}

export function PersonOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="7.5" r="3.5" />
      <path d="M4.5 20v-1.5a4 4 0 0 1 4-4h5" />
      <path d="M15 15.5l5 5M20 15.5l-5 5" />
    </Icon>
  );
}
