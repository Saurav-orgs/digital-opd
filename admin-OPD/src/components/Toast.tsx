import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '../api/client';

type ToastKind = 'success' | 'error' | 'info';

/**
 * One button on the toast — "Undo", and nothing else so far.
 *
 * A toast that reports a write is the only place the user is still thinking
 * about that write, so it is where taking it back belongs. The toast lives
 * longer when it carries one: four and a half seconds is enough to read
 * "Marked as completed" and not nearly enough to decide it was the wrong
 * patient and reach for the button.
 */
interface ToastAction {
  label: string;
  run: () => void;
}

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  msg?: string;
  action?: ToastAction;
}

interface ToastContextValue {
  push: (kind: ToastKind, title: string, msg?: string, action?: ToastAction) => void;
  success: (title: string, msg?: string, action?: ToastAction) => void;
  /** Show a readable message from any thrown error (uses ApiError.message). */
  error: (err: unknown, fallback?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = (id: number) =>
    setToasts((t) => t.filter((x) => x.id !== id));

  const push = useCallback(
    (kind: ToastKind, title: string, msg?: string, action?: ToastAction) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, kind, title, msg, action }]);
      setTimeout(() => remove(id), action ? 10000 : 4500);
    },
    [],
  );

  const success = useCallback(
    (title: string, msg?: string, action?: ToastAction) =>
      push('success', title, msg, action),
    [push],
  );

  const error = useCallback(
    (err: unknown, fallback = 'Something went wrong.') => {
      const message = err instanceof ApiError ? err.message : fallback;
      push('error', 'Error', message);
    },
    [push],
  );

  return (
    <ToastContext.Provider value={{ push, success, error }}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => {
          // Held in a local so the handler below narrows it — `t.action` inside
          // a closure does not.
          const action = t.action;
          return (
            <div key={t.id} className={`toast ${t.kind}`} onClick={() => remove(t.id)}>
              <div className="t-title">{t.title}</div>
              {t.msg && <div className="t-msg">{t.msg}</div>}
              {action && (
                <button
                  type="button"
                  className="t-action"
                  onClick={(e) => {
                    // The toast dismisses on click, so the action has to stop
                    // the press reaching it — otherwise the toast is gone
                    // whether or not the action ran.
                    e.stopPropagation();
                    remove(t.id);
                    action.run();
                  }}
                >
                  {action.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
