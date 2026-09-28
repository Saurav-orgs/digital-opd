import { ArrowRight, MessageCircle } from 'lucide-react';
import { whatsappUrl } from '../config';

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
              href={whatsappUrl('Hi, I have a question about myDigitalOPD plans.')}
              className="btn btn-ghost-inverse btn-lg"
              target="_blank"
              rel="noopener"
            >
              <MessageCircle size={18} /> Ask on WhatsApp
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
