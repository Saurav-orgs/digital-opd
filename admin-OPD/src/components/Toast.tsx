import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '../api/client';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  msg?: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, title: string, msg?: string) => void;
  success: (title: string, msg?: string) => void;
  /** Show a readable message from any thrown error (uses ApiError.message). */
  error: (err: unknown, fallback?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = (id: number) =>
    setToasts((t) => t.filter((x) => x.id !== id));

  const push = useCallback((kind: ToastKind, title: string, msg?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, title, msg }]);
    setTimeout(() => remove(id), 4500);
  }, []);

  const success = useCallback(
    (title: string, msg?: string) => push('success', title, msg),
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
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => remove(t.id)}>
            <div className="t-title">{t.title}</div>
            {t.msg && <div className="t-msg">{t.msg}</div>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
