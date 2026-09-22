import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi } from '../api/endpoints';
import { tokenStore } from '../api/client';
import type { AuthUser, LoginResponse, PermAction, PermModule } from '../api/types';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** Adopt a session the server already minted — after registering. */
  setSession: (session: LoginResponse) => void;
  logout: () => void;
  can: (module: PermModule, action: PermAction) => boolean;
  /** True when the logged-in account is a doctor user (has a doctorId). */
  isDoctor: boolean;
  /** True when the logged-in account is the platform super-admin. */
  isSuperAdmin: boolean;
  /**
   * A paid account that has not built its clinic yet — it signed in, but
   * `doctorId` is still null. Every screen is gated on this until the
   * profile form has run.
   */
  needsSetup: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Re-hydrate the session from a stored token on load.
  useEffect(() => {
    const token = tokenStore.get();
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then(setUser)
      .catch(() => {
        tokenStore.clear();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    tokenStore.set(res.accessToken);
    setUser(res.user);
  }, []);

  const setSession = useCallback((res: LoginResponse) => {
    tokenStore.set(res.accessToken);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const can = useCallback(
    (module: PermModule, action: PermAction) => {
      if (!user) return false;
      if (user.type === 'super_admin') return true;
      return user.permissions.includes(`${module}:${action}`);
    },
    [user],
  );

  // Doctor: has a doctorId and type=doctor (or legacy super_admin with doctorId).
  const isDoctor = !!user?.doctorId && (user.type === 'doctor' || user.type === 'super_admin');
  const isSuperAdmin = user?.type === 'super_admin';
  // A doctor account bought through the landing page has no tenant until the
  // first-login profile form creates one.
  const needsSetup = !!user && user.type === 'doctor' && !user.doctorId;

  const value = useMemo(
    () => ({ user, loading, login, setSession, logout, can, isDoctor, isSuperAdmin, needsSetup }),
    [user, loading, login, setSession, logout, can, isDoctor, isSuperAdmin, needsSetup],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
