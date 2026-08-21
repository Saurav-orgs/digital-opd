import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, addDays } from 'date-fns';
import { Info, Stethoscope } from 'lucide-react';
import { api } from '../api';
import { AppConfig } from '../config';
import type { Slot } from '../types';
import { NetworkAvatar } from '../components/NetworkAvatar';
import { StateView } from '../components/StateView';
import { useDoctorCtx } from '../context/DoctorContext';

export const DoctorLanding: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { setDoctor } = useDoctorCtx();

  const { data: doctor, isLoading, error, refetch } = useQuery({
    queryKey: ['doctor-by-slug', slug],
    queryFn: () => api.doctorByIdOrSlug(slug!),
    enabled: !!slug,
  });

  useEffect(() => {
    if (doctor) {
      setDoctor({
        id: doctor.id,
        slug: doctor.publicSlug,
        name: doctor.name,
        specialization: doctor.specialization ?? null,
      });
    }
  }, [doctor]); // eslint-disable-line react-hooks/exhaustive-deps

  const dates = useMemo(() => {
    const today = new Date();
    return Array.from({ length: AppConfig.bookingWindowDays + 1 }, (_, i) => addDays(today, i));
  }, []);

  const [selectedDate, setSelectedDate] = useState<Date>(dates[0]);
  const formattedSelectedDate = format(selectedDate, 'yyyy-MM-dd');

  const { data: daySlots, isLoading: isSlotsLoading, error: slotsError } = useQuery({
    queryKey: ['slots', doctor?.id, formattedSelectedDate],
    queryFn: () => api.getSlots(doctor!.id, formattedSelectedDate),
    enabled: !!doctor?.id,
  });

  if (isLoading) return <StateView loading />;

  if (error || !doctor) {
    return (
      <StateView
        error={error ? 'Could not load the doctor. The link may be invalid.' : undefined}
        empty={!error ? 'Doctor not found.' : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  const getUnavailableLabel = (reason?: string | null) => {
    switch (reason) {
      case 'leave': return 'The doctor is on leave this day.';
      case 'no_opd': return 'No OPD hours on this day.';
      case 'out_of_window': return 'Bookings open only for the next 7 days.';
      default: return 'Not available.';
    }
  };

  return (
    <div className="doctor-landing-wrap">
      {/* ── Gradient hero ── */}
      <div className="doctor-hero-gradient">
        <div className="doctor-hero-tag">
          <Stethoscope size={13} />
          <span>OPD Appointment</span>
        </div>

        <div className="doctor-hero-info">
          <div className="doctor-hero-text">
            <div className="doctor-hero-name">{doctor.name}</div>
            {doctor.specialization && (
              <div className="doctor-hero-spec">{doctor.specialization}</div>
            )}
            {doctor.qualifications && (
              <div className="doctor-hero-qual">{doctor.qualifications}</div>
            )}
            {doctor.bio && (
              <div className="doctor-hero-bio">{doctor.bio}</div>
            )}
          </div>
          <NetworkAvatar url={doctor.profilePhotoUrl} size={96} alt={doctor.name} />
        </div>
      </div>

      {/* ── Body ── */}
      <div className="doctor-landing-body">
        {/* Date strip */}
        <span className="landing-section-label">Pick a date</span>
        <div className="date-strip" style={{ marginBottom: 24 }}>
          {dates.map((d) => {
            const isSelected = format(d, 'yyyy-MM-dd') === formattedSelectedDate;
            return (
              <div
                key={d.toISOString()}
                className={'date-chip' + (isSelected ? ' selected' : '')}
                onClick={() => setSelectedDate(d)}
              >
                <span className="day-name">{format(d, 'EEE')}</span>
                <span className="day-num">{format(d, 'd')}</span>
                <span className="month-name">{format(d, 'MMM')}</span>
              </div>
            );
          })}
        </div>

        {/* Slots */}
        <div className="landing-slots-header">
          <span className="landing-section-label" style={{ marginBottom: 0 }}>
            Available slots
          </span>
          <div className="landing-legend">
            <LegendDot color="var(--primary)" label="Open" />
            <LegendDot color="#D3D1C7" label="Booked" />
            <LegendDot color="#9AA1AB" label="Past" />
          </div>
        </div>

        {isSlotsLoading ? (
          <div style={{ padding: '24px 0' }}><StateView loading /></div>
        ) : slotsError ? (
          <NoticeCard message={slotsError instanceof Error ? slotsError.message : 'Could not load slots.'} />
        ) : !daySlots?.available ? (
          <NoticeCard message={getUnavailableLabel(daySlots?.reason)} />
        ) : daySlots.slots.length === 0 ? (
          <NoticeCard message="No slots available for this day." />
        ) : (
          <div className="slots-wrap" style={{ marginTop: 12 }}>
            {daySlots.slots.map((slot, idx) => (
              <SlotChip
                key={`${slot.startTime}-${idx}`}
                slot={slot}
                onSelect={() =>
                  navigate('/book', { state: { doctor, date: formattedSelectedDate, slot } })
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const SlotChip: React.FC<{ slot: Slot; onSelect: () => void }> = ({ slot, onSelect }) => {
  let className = 'slot-chip ';
  if (slot.status === 'booked') className += 'booked';
  else if (slot.status === 'past') className += 'past';
  else className += 'available';

  return (
    <div className={className} onClick={() => { if (slot.selectable) onSelect(); }}>
      {slot.startTime}
    </div>
  );
};

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div className="landing-legend-item">
    <div className="landing-legend-dot" style={{ background: color }} />
    <span>{label}</span>
  </div>
);

const NoticeCard: React.FC<{ message: string }> = ({ message }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    color: 'var(--text-secondary)', padding: '14px 0',
  }}>
    <Info size={17} />
    <span style={{ fontSize: 14 }}>{message}</span>
  </div>
);
