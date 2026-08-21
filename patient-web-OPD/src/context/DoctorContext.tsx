import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'opd_doctor_ctx';

interface DoctorCtxData {
  id: string;
  slug: string;
  name: string;
  specialization: string | null;
}

interface DoctorContextValue {
  doctor: DoctorCtxData | null;
  setDoctor: (d: DoctorCtxData) => void;
  clearDoctor: () => void;
}

const DoctorContext = createContext<DoctorContextValue | null>(null);

export function DoctorProvider({ children }: { children: ReactNode }) {
  const [doctor, setDoctorState] = useState<DoctorCtxData | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    } catch {
      return null;
    }
  });

  const setDoctor = (d: DoctorCtxData) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    setDoctorState(d);
  };

  const clearDoctor = () => {
    localStorage.removeItem(STORAGE_KEY);
    setDoctorState(null);
  };

  const value = useMemo(() => ({ doctor, setDoctor, clearDoctor }), [doctor]);
  return <DoctorContext.Provider value={value}>{children}</DoctorContext.Provider>;
}

export function useDoctorCtx() {
  const ctx = useContext(DoctorContext);
  if (!ctx) throw new Error('useDoctorCtx must be inside DoctorProvider');
  return ctx;
}
