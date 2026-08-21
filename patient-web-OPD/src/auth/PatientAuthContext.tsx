import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { patientApi, patientTokenStore } from '../patientApi';
import type { PatientAuthUser } from '../types';

interface PatientAuthContextValue {
  patient: PatientAuthUser | null;
  loading: boolean;
  login: (mobile: string, doctorId?: string | null) => Promise<void>;
  register: (mobile: string, name: string, doctorId?: string | null) => Promise<void>;
  logout: () => void;
}

const PatientAuthContext = createContext<PatientAuthContextValue | null>(null);

export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const [patient, setPatient] = useState<PatientAuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = patientTokenStore.get();
    if (!token) {
      setLoading(false);
      return;
    }
    patientApi
      .me()
      .then(setPatient)
      .catch(() => {
        patientTokenStore.clear();
        setPatient(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (mobile: string, doctorId?: string | null) => {
    const res = await patientApi.login(mobile, doctorId);
    patientTokenStore.set(res.accessToken);
    setPatient(res.patient);
  }, []);

  const register = useCallback(async (mobile: string, name: string, doctorId?: string | null) => {
    const res = await patientApi.register(mobile, name, doctorId);
    patientTokenStore.set(res.accessToken);
    setPatient(res.patient);
  }, []);

  const logout = useCallback(() => {
    patientTokenStore.clear();
    setPatient(null);
  }, []);

  const value = useMemo(
    () => ({ patient, loading, login, register, logout }),
    [patient, loading, login, register, logout],
  );

  return <PatientAuthContext.Provider value={value}>{children}</PatientAuthContext.Provider>;
}

export function usePatientAuth() {
  const ctx = useContext(PatientAuthContext);
  if (!ctx) throw new Error('usePatientAuth must be used within PatientAuthProvider');
  return ctx;
}
