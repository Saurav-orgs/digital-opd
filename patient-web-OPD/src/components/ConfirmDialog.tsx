import React from 'react';
import type { ReactNode } from 'react';

/**
 * In-app replacement for `window.confirm`.
 *
 * The browser dialog is unstyled, can't be branded, and on a destructive action
 * leaves no room to say what will actually happen — cancelling a visit also
 * removes the reports uploaded against it, and the patient should read that
 * before they commit, not discover it afterwards.
 */
export const ConfirmDialog: React.FC<{
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  busy,
  onConfirm,
  onCancel,
}) => {
  // Escape closes, matching what the native dialog did.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={busy ? undefined : onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface, #fff)',
          borderRadius: 14,
          padding: '22px 22px 18px',
          width: '100%',
          maxWidth: 420,
          boxShadow: '0 18px 48px rgba(15, 23, 42, 0.22)',
        }}
      >
        <h3
          style={{
            margin: '0 0 8px',
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--text)',
          }}
        >
          {title}
        </h3>
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.6,
            color: 'var(--text-secondary)',
          }}
        >
          {message}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            marginTop: 20,
          }}
        >
          <button
            type="button"
            className="btn-outlined"
            onClick={onCancel}
            disabled={busy}
            style={{ padding: '8px 16px' }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: '8px 16px',
              width: 'auto',
              ...(destructive
                ? { background: 'var(--error, #dc2626)', borderColor: 'transparent' }
                : {}),
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
