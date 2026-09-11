import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { LogoMark, PoweredByIttitude } from './Brand';

export const Footer: React.FC = () => {
  return (
    <footer className="web-footer">
      <div className="web-footer-simple">
        <Link to="/" className="web-brand web-brand-footer">
          {/* The footer ground is the darkest ink in the system, so the mark
              flips to a white tile rather than sitting as a teal square on it. */}
          <LogoMark size={34} tone="inverse" />
          <span className="brand-lockup">
            <span className="brand-name">
              <span className="brand-my">my</span>
              <span className="brand-digital">Digital</span>
              <span className="brand-opd">OPD</span>
            </span>
            <span className="brand-by">digitally connected</span>
          </span>
        </Link>
        <p className="footer-tagline">
          Fast &amp; reliable OPD appointment booking platform.
        </p>
        <div className="footer-contact-info">
          <div className="footer-verify-badge">
            <ShieldCheck size={15} color="var(--teal)" />
            <span>100% Verified OPD Doctors</span>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-bottom-inner">
          <div className="footer-copyright">
            © {new Date().getFullYear()} myDigitalOPD. All rights reserved.
          </div>
          <PoweredByIttitude tone="inverse" />
          <div className="footer-bottom-links">
            <Link to="/" className="footer-bottom-link">
              Home
            </Link>
            <span className="footer-divider">•</span>
            {/* <Link to="/privacy-policy" className="footer-bottom-link"> */}
            <Link to="" className="footer-bottom-link">
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
