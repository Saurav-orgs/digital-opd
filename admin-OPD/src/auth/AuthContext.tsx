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
import type { AuthUser, PermAction, PermModule } from '../api/types';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (module: PermModule, action: PermAction) => boolean;
  /** The clinic's doctor — the SuperAdmin seeded from env, not their staff. */
  isDoctor: boolean;
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

  // The SuperAdmin *is* the doctor (seeded from env and linked to the clinic's
  // doctor profile). Staff accounts are linked to the same profile for data
  // scope, so the link alone doesn't make an account the doctor.
  const isDoctor =
    !!user?.doctorId && (user.type === 'super_admin' || user.type === 'doctor');

  const value = useMemo(
    () => ({ user, loading, login, logout, can, isDoctor }),
    [user, loading, login, logout, can, isDoctor],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
