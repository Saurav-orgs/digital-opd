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
import PatientHistoryPage from './pages/PatientHistoryPage';
import DoctorsPage from './pages/Doctors';
import SettingsPage from './pages/Settings';
import PlansPage from './pages/Plans';
import SubscriptionsPage from './pages/Subscriptions';
import PaymentLogPage from './pages/PaymentLog';
import BillingPage from './pages/Billing';
import BlockedNumbersPage from './pages/BlockedNumbers';
import PatientsPage from './pages/Patients';
import PatientDetailPage from './pages/PatientDetail';
import DoctorRegisterPage from './pages/DoctorRegister';
import LetterheadPage from './pages/Letterhead';
import DoctorDetailPage from './pages/DoctorDetail';
import ForgotPassword from './pages/ForgotPassword';
import ChangePasswordPage from './pages/ChangePassword';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, needsSetup, mustChangePassword } = useAuth();
  if (loading) return <div className="center-screen"><Loading /></div>;
  if (!user) return <Navigate to="/login" replace />;
  // Ahead of the setup form: an account on a mailed password cannot call the
  // API at all, so there is nothing for any other screen to load.
  if (mustChangePassword) return <Navigate to="/change-password" replace />;
  // A paid account with no clinic yet has nothing to show on any screen —
  // no appointments, no schedule, no letterhead — so it goes to the profile
  // form first. Every route inside the shell is behind this.
  if (needsSetup) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

/** The first-login profile form. Only reachable while the clinic is missing. */
function SetupRoute() {
  const { user, loading, needsSetup, mustChangePassword } = useAuth();
  if (loading) return <div className="center-screen"><Loading /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;
  if (!needsSetup) return <Navigate to="/" replace />;
  return <DoctorRegisterPage mode="setup" />;
}

/** The forced password change. Only reachable while the flag is set. */
function ChangePasswordRoute() {
  const { user, loading, mustChangePassword } = useAuth();
  if (loading) return <div className="center-screen"><Loading /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!mustChangePassword) return <Navigate to="/" replace />;
  return <ChangePasswordPage />;
}

/** Landing route: first module the user can see. */
function Home() {
  const { can, isDoctor, isSuperAdmin } = useAuth();
  if (isSuperAdmin) return <Navigate to="/doctors" replace />;
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
      <Route path="/setup" element={<SetupRoute />} />
      <Route path="/change-password" element={<ChangePasswordRoute />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
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
        <Route path="/profile/letterhead" element={<LetterheadPage />} />
        <Route path="/appointments/:id" element={<AppointmentPage />} />
        <Route path="/appointments/:id/history" element={<PatientHistoryPage />} />
        <Route path="/doctors" element={<DoctorsPage />} />
        <Route path="/doctors/:doctorId" element={<DoctorDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/payment-log" element={<PaymentLogPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/blocked-numbers" element={<BlockedNumbersPage />} />
        <Route path="/patients" element={<PatientsPage />} />
        <Route path="/patients/:profileId" element={<PatientDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
