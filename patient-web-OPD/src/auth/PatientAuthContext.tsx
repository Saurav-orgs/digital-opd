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
import type {
  PatientAuthUser,
  PatientDetailsInput,
  PatientProfile,
} from '../types';

const SELECTED_KEY = 'opd_selected_patient';

interface PatientAuthContextValue {
  /** The account — a phone number. Not a person. */
  patient: PatientAuthUser | null;
  /** Everyone registered on that number. */
  profiles: PatientProfile[];
  /** Whose records are currently being viewed. */
  selected: PatientProfile | null;
  selectProfile: (id: string) => void;
  refreshProfiles: () => Promise<PatientProfile[]>;
  loading: boolean;
  login: (mobile: string, password: string, doctorId?: string | null) => Promise<void>;
  /** Opens an account with just a number and a password; patients come after. */
  signup: (mobile: string, password: string, doctorId?: string | null) => Promise<void>;
  register: (
    mobile: string,
    password: string,
    details: PatientDetailsInput,
    doctorId?: string | null,
  ) => Promise<void>;
  logout: () => void;
}

const PatientAuthContext = createContext<PatientAuthContextValue | null>(null);

export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const [patient, setPatient] = useState<PatientAuthUser | null>(null);
  const [profiles, setProfiles] = useState<PatientProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    localStorage.getItem(SELECTED_KEY),
  );
  const [loading, setLoading] = useState(true);

  /**
   * There is no default patient, so a number with several people on it must be
   * asked. One person is unambiguous, though — selecting it automatically saves
   * a pointless tap on every login.
   */
  const applyProfiles = useCallback(
    (list: PatientProfile[]) => {
      setProfiles(list);
      setSelectedId((current) => {
        if (current && list.some((p) => p.id === current)) return current;
        return list.length === 1 ? list[0].id : null;
      });
      return list;
    },
    [],
  );

  useEffect(() => {
    const token = patientTokenStore.get();
    if (!token) {
      setLoading(false);
      return;
    }
    patientApi
      .me()
      .then((me) => {
        setPatient({ id: me.id, mobile: me.mobile });
        applyProfiles(me.patients ?? []);
      })
      .catch(() => {
        patientTokenStore.clear();
        setPatient(null);
        setProfiles([]);
      })
      .finally(() => setLoading(false));
  }, [applyProfiles]);

  // Survive a reload, so switching patient isn't undone by a refresh.
  useEffect(() => {
    if (selectedId) localStorage.setItem(SELECTED_KEY, selectedId);
    else localStorage.removeItem(SELECTED_KEY);
  }, [selectedId]);

  const login = useCallback(
    async (mobile: string, password: string, doctorId?: string | null) => {
      const res = await patientApi.login(mobile, password, doctorId);
      patientTokenStore.set(res.accessToken);
      setPatient(res.patient);
      applyProfiles(res.patients ?? []);
    },
    [applyProfiles],
  );

  const signup = useCallback(
    async (mobile: string, password: string, doctorId?: string | null) => {
      const res = await patientApi.signup(mobile, password, doctorId);
      patientTokenStore.set(res.accessToken);
      setPatient(res.patient);
      applyProfiles(res.patients ?? []);
    },
    [applyProfiles],
  );

  const register = useCallback(
    async (
      mobile: string,
      password: string,
      details: PatientDetailsInput,
      doctorId?: string | null,
    ) => {
      const res = await patientApi.register(mobile, password, details, doctorId);
      patientTokenStore.set(res.accessToken);
      setPatient(res.patient);
      const list = applyProfiles(res.patients ?? []);
      // Registering created exactly one patient — view them.
      const created = (res as { created_patient_id?: string }).created_patient_id;
      if (created && list.some((p) => p.id === created)) setSelectedId(created);
    },
    [applyProfiles],
  );

  const refreshProfiles = useCallback(async () => {
    const list = await patientApi.profiles();
    return applyProfiles(list);
  }, [applyProfiles]);

  const logout = useCallback(() => {
    patientTokenStore.clear();
    localStorage.removeItem(SELECTED_KEY);
    setPatient(null);
    setProfiles([]);
    setSelectedId(null);
  }, []);

  const value = useMemo(
    () => ({
      patient,
      profiles,
      selected: profiles.find((p) => p.id === selectedId) ?? null,
      selectProfile: setSelectedId,
      refreshProfiles,
      loading,
      login,
      signup,
      register,
      logout,
    }),
    [patient, profiles, selectedId, refreshProfiles, loading, login, signup, register, logout],
  );

  return <PatientAuthContext.Provider value={value}>{children}</PatientAuthContext.Provider>;
}

export function usePatientAuth() {
  const ctx = useContext(PatientAuthContext);
  if (!ctx) throw new Error('usePatientAuth must be used within PatientAuthProvider');
  return ctx;
}
