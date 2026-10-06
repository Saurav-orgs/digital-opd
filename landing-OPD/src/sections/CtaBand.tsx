import { ArrowRight, Mail } from 'lucide-react';
import { supportMailto } from '../config';

export function CtaBand() {
  return (
    <section className="section">
      <div className="container">
        <div className="cta-band reveal">
          <div>
            <h2>Your booking page can be live today.</h2>
            <p>Pick a plan, verify your email, pay online — then set up your practice on first login.</p>
          </div>
          <div className="cta-band-actions">
            <a href="#pricing" className="btn btn-inverse btn-lg">
              See plans <ArrowRight size={18} />
            </a>
            <a
              href={supportMailto('Question about myDigitalOPD plans')}
              className="btn btn-ghost-inverse btn-lg"
            >
              <Mail size={18} /> Email us
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
