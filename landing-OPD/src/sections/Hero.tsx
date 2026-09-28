import { ArrowRight, Check, FileCheck2, MessageCircle } from 'lucide-react';
import { whatsappUrl } from '../config';

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
            Run your OPD from booking to prescription —{' '}
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
              href={whatsappUrl('Hi, I would like a demo of myDigitalOPD for my clinic.')}
              className="btn btn-outline btn-lg"
              target="_blank"
              rel="noopener"
            >
              <MessageCircle size={18} /> Chat on WhatsApp
            </a>
          </div>
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
