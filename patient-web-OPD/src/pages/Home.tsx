import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, addDays } from 'date-fns';
import { Info, Calendar } from 'lucide-react';
import { api } from '../api';
import { AppConfig } from '../config';
import type { Slot } from '../types';
import { NetworkAvatar } from '../components/NetworkAvatar';
import { StateView } from '../components/StateView';

/**
 * Single-doctor home: loads the clinic's doctor and shows the booking flow
 * (doctor info + date + slots) directly — no doctor list, no search. The web
 * equivalent of the Flutter patient app's `HomeScreen`.
 */
export const Home: React.FC = () => {
  const navigate = useNavigate();

  const {
    data: doctors,
    isLoading: isDoctorLoading,
    error: doctorError,
    refetch,
  } = useQuery({
    queryKey: ['doctors'],
    queryFn: api.listDoctors,
  });

  const doctor = doctors?.[0];

  const dates = useMemo(() => {
    const today = new Date();
    return Array.from({ length: AppConfig.bookingWindowDays + 1 }, (_, i) => addDays(today, i));
  }, []);

  const [selectedDate, setSelectedDate] = useState<Date>(dates[0]);
  const formattedSelectedDate = format(selectedDate, 'yyyy-MM-dd');

  const {
    data: daySlots,
    isLoading: isSlotsLoading,
    error: slotsError,
  } = useQuery({
    queryKey: ['slots', doctor?.id, formattedSelectedDate],
    queryFn: () => api.getSlots(doctor!.id, formattedSelectedDate),
    enabled: !!doctor?.id,
  });

  if (isDoctorLoading) {
    return (
      <div>
        <Hero />
        <StateView loading />
      </div>
    );
  }

  if (doctorError || !doctor) {
    return (
      <div>
        <Hero />
        <StateView
          error={doctorError ? 'Could not load the clinic. Please try again.' : undefined}
          empty={!doctorError ? 'No doctor is available right now.' : undefined}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const getUnavailableLabel = (reason?: string | null) => {
    switch (reason) {
      case 'leave':
        return 'The doctor is on leave this day.';
      case 'no_opd':
        return 'No OPD hours on this day.';
      case 'out_of_window':
        return 'Bookings open only for the next 7 days.';
      default:
        return 'Not available.';
    }
  };

  return (
    <div>
      <Hero />

      <div className="detail-grid" style={{ marginTop: '10px' }}>
        <div className="section-card">
          <div className="doctor-detail-header-flex">
            <NetworkAvatar url={doctor.profilePhotoUrl} size={64} alt={doctor.name} />

            <div style={{ flex: 1, minWidth: '200px' }}>
              <div style={{ fontWeight: 800, fontSize: '22px', color: 'var(--text)' }}>
                {doctor.name}
              </div>
              {doctor.specialization && (
                <div style={{ fontSize: '15px', color: 'var(--primary)', fontWeight: 700, marginTop: '2px' }}>
                  {doctor.specialization}
                </div>
              )}
              {doctor.qualifications && (
                <div style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {doctor.qualifications}
                </div>
              )}
            </div>

            {doctor.consultationFee && (
              <div>
                <div style={{ fontWeight: 800, fontSize: '20px', color: 'var(--secondary)' }}>
                  ₹{doctor.consultationFee}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>Fee</div>
              </div>
            )}
          </div>

          {doctor.bio && (
            <div
              style={{
                marginTop: '20px',
                paddingTop: '18px',
                borderTop: '1px solid var(--border)',
                fontSize: '14.5px',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: '6px', fontSize: '15px' }}>About Doctor</div>
              {doctor.bio}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="section-card">
            <div
              style={{
                fontWeight: 700,
                fontSize: '16px',
                color: 'var(--text)',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Calendar size={20} color="var(--primary)" />
              <span>Select Date</span>
            </div>

            <div className="date-strip">
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
          </div>

          <div className="section-card">
            <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--text)', marginBottom: '16px' }}>
              Available Time Slots
            </div>

            {isSlotsLoading ? (
              <div style={{ padding: '24px' }}>
                <StateView loading />
              </div>
            ) : slotsError ? (
              <NoticeCard message={slotsError instanceof Error ? slotsError.message : 'Could not load slots.'} />
            ) : !daySlots?.available ? (
              <NoticeCard message={getUnavailableLabel(daySlots?.reason)} />
            ) : daySlots.slots.length === 0 ? (
              <NoticeCard message="No slots available for this day." />
            ) : (
              <div>
                <div className="legend-row">
                  <div className="legend-item">
                    <div className="legend-dot" style={{ background: 'var(--primary)' }} />
                    <span>Available</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-dot" style={{ background: '#D3D1C7' }} />
                    <span>Booked</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-dot" style={{ background: '#9AA1AB' }} />
                    <span>Past</span>
                  </div>
                </div>

                <div className="slots-wrap">
                  {daySlots.slots.map((slot, idx) => (
                    <SlotChip
                      key={`${slot.startTime}-${idx}`}
                      slot={slot}
                      onSelect={() =>
                        navigate('/book', {
                          state: { doctor, date: formattedSelectedDate, slot },
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Hero: React.FC = () => (
  <div className="top-header-row">
    <div>
      <div className="step-badge-text">OPD Appointments</div>
      <h2 style={{ fontSize: '26px', fontWeight: 800, margin: 0, color: 'var(--text)' }}>
        Book your OPD
      </h2>
      <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '14.5px' }}>
        Pick a date and time that works for you.
      </p>
    </div>
  </div>
);

const SlotChip: React.FC<{ slot: Slot; onSelect: () => void }> = ({ slot, onSelect }) => {
  let className = 'slot-chip ';
  if (slot.status === 'booked') className += 'booked';
  else if (slot.status === 'past') className += 'past';
  else className += 'available';

  return (
    <div
      className={className}
      onClick={() => {
        if (slot.selectable) onSelect();
      }}
    >
      {slot.startTime}
    </div>
  );
};

const NoticeCard: React.FC<{ message: string }> = ({ message }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', padding: '12px 0' }}>
    <Info size={18} />
    <span style={{ fontSize: '14px' }}>{message}</span>
  </div>
);
