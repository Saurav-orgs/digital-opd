import type { ReactNode } from 'react';

/**
 * The clickable heading of a foldable card.
 *
 * The whole heading is the control, not just the caret — a 12px triangle is a
 * poor target, and the title is what the doctor is already looking at. It stays
 * a real `<button>` so it carries keyboard focus and `aria-expanded` for free,
 * and the card's own actions stay outside it so pressing Refresh does not fold
 * the card away.
 */
export function CollapseToggle({
  collapsed,
  onToggle,
  label,
  children,
}: {
  collapsed: boolean;
  onToggle: () => void;
  /** What is being folded, for screen readers: "Hide the combined summary". */
  label: string;
  /** The heading itself — title, status pill, counts. */
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={collapsed ? `Show ${label}` : `Hide ${label}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        // Reset: this is a heading that happens to be pressable, so it must not
        // arrive wearing the button styles the rest of the app uses.
        background: 'none',
        border: 0,
        padding: 0,
        margin: 0,
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          fontSize: 9,
          lineHeight: 1,
          color: 'var(--muted, #666)',
          transform: collapsed ? 'rotate(-90deg)' : 'none',
          transition: 'transform 120ms ease',
          flexShrink: 0,
        }}
      >
        ▼
      </span>
      {children}
    </button>
  );
}
