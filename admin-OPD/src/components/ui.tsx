import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="row" style={{ padding: 24, color: 'var(--text-secondary)' }}>
      <Spinner /> {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Modal({
  title,
  onClose,
  children,
  large,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  large?: boolean;
  /**
   * Controls pinned to the bottom of the dialog, always on screen.
   *
   * Without this a modal grows as tall as its content and the page scrolls
   * behind it, so anything at the end — the action the dialog exists for —
   * is only found by scrolling past everything else. Passing a footer caps
   * the height and scrolls the body instead. Modals that pass nothing are
   * untouched.
   */
  footer?: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal ${large ? 'modal-lg' : ''} ${footer ? 'modal-pinned' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {footer ? (
          <>
            <div className="modal-body">{children}</div>
            <div className="modal-foot">{footer}</div>
          </>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/**
 * In-app replacement for `window.confirm`.
 *
 * The browser dialog is jarring, unstyled and — on a destructive action — gives
 * no room to spell out what is actually about to happen. This does, and it
 * matches the rest of the admin.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div
        className="modal"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.55 }}>
          {message}
        </div>
        <div className="row" style={{ marginTop: 20, gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  paid_unverified: 'Paid · unverified',
  // The stored values stay `done`/`rejected`; the words the doctor sees follow
  // the outcome buttons, so "Currently …" never disagrees with what was
  // pressed. `on_hold` is legacy — nothing sets it any more, but visits parked
  // before the button was removed still have to render.
  on_hold: 'On hold',
  done: 'Completed',
  rejected: 'Cancelled',
};

/**
 * Semantic badge — colour is reserved per state (plan §15). `value` chooses the
 * colour class; pass `label` to show friendlier text without changing the colour
 * (e.g. an enabled/disabled flag reusing the available/booked palette).
 */
export function Badge({ value, label }: { value: string; label?: string }) {
  const text = label ?? STATUS_LABEL[value] ?? value.replace(/_/g, ' ');
  return <span className={`badge badge-${value}`}>{text}</span>;
}

export function Field({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  /** Extra classes on the wrapper — lets a flex row give a field its width. */
  className?: string;
}) {
  return (
    <div className={`field ${className ?? ''}`.trim()}>
      <label>{label}</label>
      {children}
      {error && <span className="err">{error}</span>}
    </div>
  );
}

/**
 * A password box with a show/hide toggle.
 *
 * Typing a password you cannot see is how people end up locked out of an
 * account they just created — most of these fields set a password rather than
 * check one, so a typo is silent until the first failed sign-in. The toggle is
 * a plain button so it stays out of the tab order's way and never submits a
 * form by accident.
 *
 * Drop-in for `<input className="input" type="password" … />`.
 */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete = 'new-password',
  id,
  autoFocus,
  onKeyDown,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  id?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [shown, setShown] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        className="input"
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        style={{ paddingRight: 40 }}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        title={shown ? 'Hide password' : 'Show password'}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        tabIndex={-1}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: 38,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'var(--text-secondary)',
        }}
      >
        <EyeIcon off={shown} />
      </button>
    </div>
  );
}

/** Open eye while hidden, struck-through eye while shown. */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3.2" />
      {off && <line x1="3.5" y1="20.5" x2="20.5" y2="3.5" />}
    </svg>
  );
}

export function ActionMenuDropdown({
  btnRef,
  onClose,
  children,
}: {
  btnRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; right: number }>({ right: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const right = Math.max(12, window.innerWidth - rect.right);
      const spaceBelow = window.innerHeight - rect.bottom;

      if (spaceBelow < 180) {
        setCoords({
          bottom: Math.max(12, window.innerHeight - rect.top + 4),
          right,
        });
      } else {
        setCoords({
          top: Math.max(12, rect.bottom + 4),
          right,
        });
      }
    }
  }, [btnRef]);

  useEffect(() => {
    const handleScrollOrResize = () => onClose();
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [btnRef, onClose]);

  return (
    <div
      ref={menuRef}
      className="action-menu-dropdown"
      style={{
        position: 'fixed',
        top: coords.top !== undefined ? `${coords.top}px` : 'auto',
        bottom: coords.bottom !== undefined ? `${coords.bottom}px` : 'auto',
        right: `${coords.right}px`,
        zIndex: 9999,
      }}
    >
      {children}
    </div>
  );
}
