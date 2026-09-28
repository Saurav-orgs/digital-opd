import { Logo, PoweredByIttitude } from './Brand';
import { AppConfig, whatsappUrl } from '../config';

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Logo size={34} tone="inverse" />
          <p className="footer-tagline">
            OPD appointment & prescription software for clinics in India.
          </p>
        </div>

        <nav className="footer-col" aria-label="Product">
          <h4>Product</h4>
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>

        <nav className="footer-col" aria-label="Sign in">
          <h4>Sign in</h4>
          <a href={AppConfig.links.doctorLogin}>Doctor login</a>
          <a href={AppConfig.links.patientPortal}>Patient portal</a>
          <a
            href={whatsappUrl('Hi, I would like to know more about myDigitalOPD for my clinic.')}
            target="_blank"
            rel="noopener"
          >
            Chat on WhatsApp
          </a>
        </nav>
      </div>

      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} myDigitalOPD. All rights reserved.</span>
        <PoweredByIttitude tone="inverse" />
      </div>
    </footer>
  );
}
