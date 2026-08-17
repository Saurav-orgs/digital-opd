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
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  large?: boolean;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal ${large ? 'modal-lg' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  paid_unverified: 'Paid · unverified',
  on_hold: 'On hold',
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
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error && <span className="err">{error}</span>}
    </div>
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
