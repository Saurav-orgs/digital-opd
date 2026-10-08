import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, addDays, isSameMonth, isToday } from 'date-fns';
import { Info, CalendarDays, Clock, MapPin } from 'lucide-react';
import { api } from '../api';
import { AppConfig } from '../config';
import type { Slot, DaySlots } from '../types';
import { StateView } from '../components/StateView';
import { BookingSteps } from '../components/BookingSteps';
import { useDoctorCtx } from '../context/DoctorContext';

/** "Priya Verma" → "PV". Falls back to one letter, then to a dash. */
function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** "09:00" → "9:00 AM". Left alone if it is not an HH:mm string. */
function pretty(time: string | undefined) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h)) return time;
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m ?? 0).padStart(2, '0')} ${suffix}`;
}

/**
 * "9:00 AM – 1:00 PM · 15 min each" — the shape of the day, read off the grid
 * rather than the schedule, so a doctor with split sessions still gets an
 * honest first and last time.
 */
function sessionSummary(day: DaySlots | undefined) {
  const slots = day?.slots ?? [];
  if (!slots.length) return '';
  const first = slots[0];
  const last = slots[slots.length - 1];
  const span = `${pretty(first.startTime)} – ${pretty(last.endTime)}`;
  const [sh, sm] = first.startTime.split(':').map(Number);
  const [eh, em] = first.endTime.split(':').map(Number);
  const mins = (eh - sh) * 60 + (em - sm);
  return mins > 0 ? `${span} · ${mins} min each` : span;
}

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

  /*
   * The mockup confirms the slot with a Continue button instead of navigating
   * on the tap. That gives the patient a chance to change their mind on a
   * small screen, where a mis-tap used to take them straight into the form.
   */
  const [picked, setPicked] = useState<Slot | null>(null);
  useEffect(() => setPicked(null), [formattedSelectedDate]);

  /*
   * Bookings run three months out now, not a week, so the strip is ninety-odd
   * pills long and the chosen day is routinely off-screen — picking 14 March
   * from the calendar and being left looking at today's pills reads as if the
   * tap was ignored. `block: 'nearest'` keeps the page where it is; only the
   * strip moves.
   */
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current
      ?.querySelector(`[data-date="${formattedSelectedDate}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [formattedSelectedDate]);

  /** The calendar, for jumping weeks ahead instead of scrolling to them. */
  const jumpRef = useRef<HTMLInputElement>(null);
  const openJump = (e: React.MouseEvent) => {
    const el = jumpRef.current;
    // No `showPicker` here means an older browser, where the label's own
    // click-forwarding is the best on offer; leave it be.
    if (!el?.showPicker) return;
    // Otherwise stop it: a click landing on the input right after the picker
    // opens closes it again.
    e.preventDefault();
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

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
      case 'out_of_window': return 'Bookings open only for the next 3 months.';
      default: return 'Not available.';
    }
  };

  const meta = [doctor.qualifications, doctor.specialization].filter(Boolean).join(' · ');
  const clinic = [doctor.clinicName, doctor.clinicAddress].filter(Boolean).join(', ');

  return (
    <div className="booking-screen">
      {/* ── Doctor hero ── */}
      <header className="doc-hero">
        <div className="doc-hero-top">
          {doctor.profilePhotoUrl ? (
            <img className="doc-avatar" src={doctor.profilePhotoUrl} alt="" />
          ) : (
            <span className="doc-avatar" aria-hidden>{initials(doctor.name)}</span>
          )}
          <div style={{ minWidth: 0 }}>
            <h1 className="doc-name">{doctor.name}</h1>
            {meta && <div className="doc-meta">{meta}</div>}
          </div>
        </div>
        {clinic && (
          <div className="clinic-line">
            <MapPin size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{clinic}</span>
          </div>
        )}
      </header>

      <BookingSteps current={1} />

      <div className="screen">
        <div className="date-head">
          <h2 className="section-title">Choose a date</h2>
          {/* The whole chip opens the calendar: a click on a date input's text
              does not open the picker in Chrome, only its icon does. */}
          <label className="date-jump" onClick={openJump}>
            <CalendarDays size={15} aria-hidden />
            <span>{format(selectedDate, 'd MMM yyyy')}</span>
            <input
              ref={jumpRef}
              type="date"
              value={formattedSelectedDate}
              min={format(dates[0], 'yyyy-MM-dd')}
              max={format(dates[dates.length - 1], 'yyyy-MM-dd')}
              aria-label="Pick a date"
              onChange={(e) => {
                if (!e.target.value) return;
                const [y, m, d] = e.target.value.split('-').map(Number);
                setSelectedDate(new Date(y, m - 1, d));
              }}
            />
          </label>
        </div>
        <div className="date-scroll" ref={stripRef}>
          {dates.map((d, i) => {
            const isSelected = format(d, 'yyyy-MM-dd') === formattedSelectedDate;
            return (
              <React.Fragment key={d.toISOString()}>
                {/* Ninety pills cross two month boundaries, and "1" on its own
                    is the one date nobody can read — so each new month names
                    itself once, where it starts. */}
                {i > 0 && !isSameMonth(d, dates[i - 1]) && (
                  <span className="date-month" aria-hidden>
                    {format(d, 'MMM')}
                  </span>
                )}
                <button
                  type="button"
                  data-date={format(d, 'yyyy-MM-dd')}
                  className={'date-pill' + (isSelected ? ' selected' : '')}
                  onClick={() => setSelectedDate(d)}
                  aria-pressed={isSelected}
                  aria-label={format(d, 'EEEE, d MMMM yyyy')}
                >
                  <span className="dow">{isToday(d) ? 'Today' : format(d, 'EEE')}</span>
                  <span className="dnum">{format(d, 'd')}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <section className="box teal-accent">
          <div className="box-head">
            <div style={{ minWidth: 0 }}>
              <h3 className="box-title">Available slots</h3>
              <div className="box-sub">
                {sessionSummary(daySlots) || format(selectedDate, 'EEEE, d MMMM')}
              </div>
            </div>
            <span className="box-icon" aria-hidden><Clock size={16} /></span>
          </div>

          {isSlotsLoading ? (
            <div style={{ padding: '24px 0' }}><StateView loading /></div>
          ) : slotsError ? (
            <Notice message={slotsError instanceof Error ? slotsError.message : 'Could not load slots.'} />
          ) : !daySlots?.available ? (
            <Notice message={getUnavailableLabel(daySlots?.reason)} />
          ) : daySlots.slots.length === 0 ? (
            <Notice message="No slots available for this day." />
          ) : (
            <div className="slot-grid">
              {daySlots.slots.map((slot, idx) => (
                <SlotChip
                  key={`${slot.startTime}-${idx}`}
                  slot={slot}
                  selected={picked?.startTime === slot.startTime}
                  onSelect={() => setPicked(slot)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── Confirm bar ── */}
      <div className="bottom-bar">
        <div className="bottom-inner">
          <div className="bottom-summary">
            <div className="bs-label">Step 1 of 3</div>
            <div className="bs-value">
              {picked ? `${pretty(picked.startTime)} · ${format(selectedDate, 'EEE, d MMM')}` : 'Select a time slot'}
            </div>
          </div>
          <button
            className="btn-primary-lg"
            disabled={!picked}
            onClick={() =>
              navigate('/book', {
                state: { doctor, date: formattedSelectedDate, slot: picked },
              })
            }
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

const SlotChip: React.FC<{
  slot: Slot;
  selected: boolean;
  onSelect: () => void;
}> = ({ slot, selected, onSelect }) => {
  // "taken" covers booked and past alike: both mean "you cannot have this one",
  // and the mockup draws them the same way — struck through and greyed.
  const taken = !slot.selectable;
  return (
    <button
      type="button"
      className={`slot${taken ? ' taken' : ''}${selected ? ' selected' : ''}`}
      disabled={taken}
      aria-pressed={selected}
      onClick={onSelect}
    >
      {pretty(slot.startTime)}
    </button>
  );
};

const Notice: React.FC<{ message: string }> = ({ message }) => (
  <div className="slot-notice">
    <Info size={17} />
    <span>{message}</span>
  </div>
);
