import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CheckCircle, Calendar, Clock, User, Hash, ArrowLeft, ShieldCheck } from 'lucide-react';
import type { BookingResult, Doctor } from '../types';

export const Confirmation: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const state = location.state as {
    result?: BookingResult;
    doctor?: Doctor;
  } | null;

  const result = state?.result;
  const doctor = state?.doctor;

  if (!result) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>No confirmation details found.</p>
        <button
          className="btn-primary"
          style={{ marginTop: '16px', maxWidth: '240px', marginLeft: 'auto', marginRight: 'auto' }}
          onClick={() => navigate('/')}
        >
          Back to Doctors
        </button>
      </div>
    );
  }

  const doctorName = result.doctorName || doctor?.name || 'Doctor';
  const refCode = result.id ? result.id.slice(0, 8).toUpperCase() : '';
  const timeLabel = `${result.startTime} - ${result.endTime}`;

  return (
    <div style={{ maxWidth: '580px', margin: '20px auto 40px', width: '100%' }}>
      <div className="section-card" style={{ textAlign: 'center', padding: '36px 28px' }}>
        <div
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'var(--secondary-tint)',
            color: 'var(--secondary)',
            margin: '0 auto 20px',
            boxShadow: '0 8px 24px rgba(15, 110, 86, 0.18)',
          }}
          className="icon-center-box"
        >
          <CheckCircle size={44} />
        </div>

        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' }}>
          Booking Confirmed
        </div>

        <h2 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 8px 0', color: 'var(--text)' }}>
          Appointment Registered!
        </h2>

        <p style={{ fontSize: '14.5px', color: 'var(--text-secondary)', margin: '0 0 28px 0', lineHeight: 1.5 }}>
          Your OPD consultation with <strong style={{ color: 'var(--text)' }}>{doctorName}</strong> has been successfully booked.
        </p>

        <div
          style={{
            background: 'var(--page)',
            borderRadius: '12px',
            padding: '20px',
            border: '1px solid var(--border)',
            textAlign: 'left',
            marginBottom: '24px',
          }}
        >
          <ReceiptRow icon={<User size={16} color="var(--primary)" />} label="Doctor" value={doctorName} />
          <ReceiptDivider />
          <ReceiptRow icon={<Calendar size={16} color="var(--primary)" />} label="Date" value={result.appointmentDate} />
          <ReceiptDivider />
          <ReceiptRow icon={<Clock size={16} color="var(--primary)" />} label="Time Slot" value={timeLabel} />
          <ReceiptDivider />
          <ReceiptRow icon={<User size={16} color="var(--primary)" />} label="Patient Name" value={result.patientName} />
          {refCode && (
            <>
              <ReceiptDivider />
              <ReceiptRow icon={<Hash size={16} color="var(--primary)" />} label="Booking Reference" value={'#' + refCode} />
            </>
          )}
        </div>

        <div className="icon-center-row" style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '28px' }}>
          <ShieldCheck size={16} color="#10B981" />
          <span>Payment screenshot uploaded. Clinic staff will verify upon arrival.</span>
        </div>

        <button className="btn-primary" onClick={() => navigate('/', { replace: true })}>
          <ArrowLeft size={18} />
          <span>Back to Doctor List</span>
        </button>
      </div>
    </div>
  );
};

const ReceiptRow: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({
  icon,
  label,
  value,
}) => (
  <div className="receipt-row-wrap">
    <div className="receipt-row-left">
      {icon}
      <span>{label}</span>
    </div>
    <span style={{ fontSize: '14.5px', fontWeight: 700, color: 'var(--text)' }}>{value}</span>
  </div>
);

const ReceiptDivider: React.FC = () => (
  <div style={{ height: '1px', background: 'var(--border)', margin: '4px 0' }} />
);
