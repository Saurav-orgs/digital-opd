import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Loading } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DoctorSchedule from './pages/DoctorSchedule';
import Users from './pages/Users';
import Roles from './pages/Roles';
import Profile from './pages/Profile';
import Pathlabs from './pages/Pathlabs';
import Reports from './pages/Reports';
import AppointmentPage from './pages/AppointmentPage';
import DoctorsPage from './pages/Doctors';
import SettingsPage from './pages/Settings';
import BlockedNumbersPage from './pages/BlockedNumbers';
import DoctorRegisterPage from './pages/DoctorRegister';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center-screen"><Loading /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Landing route: first module the user can see. */
function Home() {
  const { can, isDoctor, isSuperAdmin } = useAuth();
  if (isSuperAdmin) return <Navigate to="/doctors" replace />;
  if (can('dashboard', 'read')) return <Navigate to="/dashboard" replace />;
  if (can('appointments', 'read')) return <Navigate to="/dashboard" replace />;
  if (isDoctor) return <Navigate to="/profile" replace />;
  if (can('reports', 'read')) return <Navigate to="/reports" replace />;
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return <div className="center-screen"><Loading /></div>;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<DoctorRegisterPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/pathlabs" element={<Pathlabs />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/users" element={<Users />} />
        <Route path="/roles" element={<Roles />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/profile/schedule" element={<DoctorSchedule />} />
        <Route path="/appointments/:id" element={<AppointmentPage />} />
        <Route path="/doctors" element={<DoctorsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/blocked-numbers" element={<BlockedNumbersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
