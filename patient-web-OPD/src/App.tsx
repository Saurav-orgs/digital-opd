import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { PhoneCall } from 'lucide-react';
import { queryClient } from './queryClient';
import { PatientAuthProvider } from './auth/PatientAuthContext';
import { Home } from './pages/Home';
import { BookingForm } from './pages/BookingForm';
import { Confirmation } from './pages/Confirmation';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { Login } from './pages/patient/Login';
import { MyVisits } from './pages/patient/MyVisits';
import { Reports } from './pages/patient/Reports';
import { Notifications } from './pages/patient/Notifications';
import { Footer } from './components/Footer';
import { AccountNav } from './components/AccountNav';
import type { ReactNode } from 'react';
import { usePatientAuth } from './auth/PatientAuthContext';

function RequirePatientAuth({ children }: { children: ReactNode }) {
  const { patient, loading } = usePatientAuth();
  const location = useLocation();
  if (loading) return null;
  if (!patient) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PatientAuthProvider>
        <BrowserRouter>
          <div className="web-app-shell">
            <header className="web-navbar">
              <div className="web-navbar-inner">
                <Link to="/" className="web-brand">
                  <span className="brand-icon">+</span>
                  <span>OPD Patient Portal</span>
                </Link>

                <div className="web-nav-links">
                  <div className="web-contact-pill">
                    <PhoneCall size={14} />
                    <span>24/7 OPD Helpline</span>
                  </div>
                  <AccountNav />
                </div>
              </div>
            </header>

            <main className="web-container">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/book" element={<BookingForm />} />
                <Route path="/confirmation" element={<Confirmation />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                <Route path="/login" element={<Login />} />
                <Route
                  path="/visits"
                  element={
                    <RequirePatientAuth>
                      <MyVisits />
                    </RequirePatientAuth>
                  }
                />
                <Route
                  path="/reports"
                  element={
                    <RequirePatientAuth>
                      <Reports />
                    </RequirePatientAuth>
                  }
                />
                <Route
                  path="/notifications"
                  element={
                    <RequirePatientAuth>
                      <Notifications />
                    </RequirePatientAuth>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>

            <Footer />
          </div>
        </BrowserRouter>
      </PatientAuthProvider>
    </QueryClientProvider>
  );
}
