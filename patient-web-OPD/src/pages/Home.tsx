import React from 'react';
import { Navigate } from 'react-router-dom';
import { QrCode } from 'lucide-react';
import { useDoctorCtx } from '../context/DoctorContext';

/**
 * Root landing page in multi-tenant mode.
 * If the patient already has a doctor context (scanned a QR before), send them
 * straight to that doctor's booking portal. Otherwise show a prompt to scan
 * their doctor's QR code.
 */
export const Home: React.FC = () => {
  const { doctor } = useDoctorCtx();

  if (doctor) {
    return <Navigate to={`/d/${doctor.slug}`} replace />;
  }

  return (
    <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center', padding: '0 24px' }}>
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: 'var(--primary, #2563EB)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px',
        }}
      >
        <QrCode size={40} color="#fff" />
      </div>

      <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text)', margin: '0 0 10px' }}>
        Scan your doctor's QR code
      </h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: 1.6, margin: 0 }}>
        Your doctor has a unique QR code for their OPD. Scan it to open their booking
        portal, then book and manage your appointments here.
      </p>

      <div
        style={{
          marginTop: 32,
          padding: '16px 20px',
          background: 'var(--surface-2, #F4F4F5)',
          borderRadius: 12,
          fontSize: '13.5px',
          color: 'var(--text-secondary)',
        }}
      >
        Ask your doctor or the clinic reception for the QR link.
      </div>
    </div>
  );
};
