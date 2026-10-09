import { ArrowRight, CalendarCheck, Check, FileCheck2, Mail } from 'lucide-react';
import { supportMailto } from '../config';

const TRUST = ['No per-booking fees', 'Phone, tablet & desktop', 'Pay online, start today'];

/** A CSS-only sketch of the doctor booking page: date strip + slot grid. */
function BookingMock() {
  const days = ['Mon 22', 'Tue 23', 'Wed 24', 'Thu 25', 'Fri 26'];
  const slots: Array<'free' | 'taken' | 'past'> = [
    'past', 'past', 'taken', 'free', 'free', 'taken',
    'free', 'free', 'taken', 'free', 'free', 'free',
  ];
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-doctor">
        <span className="mock-avatar" />
        <div>
          <div className="mock-line mock-line--name" />
          <div className="mock-line mock-line--meta" />
        </div>
      </div>
      <div className="mock-label">Pick a date</div>
      <div className="mock-days">
        {days.map((d, i) => (
          <span key={d} className={`mock-day ${i === 2 ? 'is-on' : ''}`}>
            {d}
          </span>
        ))}
      </div>
      <div className="mock-label">Available slots</div>
      <div className="mock-slots">
        {slots.map((s, i) => (
          <span key={i} className={`mock-slot is-${s}`}>
            {`${9 + Math.floor(i / 2)}:${i % 2 ? '30' : '00'}`}
          </span>
        ))}
      </div>
      <div className="mock-toast">
        <span className="mock-toast-icon">
          <FileCheck2 size={16} />
        </span>
        <div>
          <strong>Prescription issued</strong>
          <span>PDF sent to Rakesh Kumar</span>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="hero">
      <div className="container hero-grid">
        <div className="hero-copy">
          <span className="eyebrow">OPD software for Indian clinics</span>
          <h1>
            Run your OPD from booking to prescription,{' '}
            <span className="accent">in one place.</span>
          </h1>
          <p className="lead">
            Patients book a slot from your own link. You consult, write the
            prescription by hand, voice or keyboard, and issue a branded PDF in
            one tap. Reports and AI summaries stay attached to every visit.
          </p>
          <div className="hero-actions">
            <a href="#pricing" className="btn btn-primary btn-lg">
              See plans <ArrowRight size={18} />
            </a>
            <a
              href={supportMailto('Demo request for myDigitalOPD')}
              className="btn btn-outline btn-lg"
            >
              <Mail size={18} /> Email us
            </a>
            {/*
              The patient's way in, beside the doctor's two rather than up in
              the header: this row is where a first-time reader's eye stops,
              and the tinted fill marks it as the one button on the page that
              is not addressed to a doctor.
            */}
            <a href="#book" className="btn btn-outline btn-lg btn-book">
              <CalendarCheck size={18} /> Book a Doctor
            </a>
          </div>
          {/*
            Who that third button is for. The headline, the lead and the other
            two buttons are all addressed to a doctor, so a patient needs one
            line that says they are in the right place.
          */}
          <p className="hero-patient">
            Patients: find your doctor and pick a slot. No app, no account.
          </p>
          <ul className="trust-list" aria-label="Highlights">
            {TRUST.map((t) => (
              <li key={t}>
                <Check size={16} /> {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="hero-visual">
          <BookingMock />
        </div>
      </div>
    </section>
  );
}
