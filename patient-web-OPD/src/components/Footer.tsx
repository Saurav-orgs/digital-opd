import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="web-footer">
      <div className="web-footer-simple">
        <Link to="/" className="web-brand web-brand-footer">
          <span className="brand-icon">+</span>
          <span className="brand-lockup">
            <span className="brand-name">Digital OPD</span>
            <span className="brand-by">by Ittitude</span>
          </span>
        </Link>
        <p className="footer-tagline">
          Fast & reliable OPD appointment booking platform.
        </p>
        <div className="footer-contact-info">
          <div className="footer-verify-badge">
            <ShieldCheck size={15} color="#10B981" />
            <span>100% Verified OPD Doctors</span>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-bottom-inner">
          <div className="footer-copyright">
            © {new Date().getFullYear()} Digital OPD. All rights reserved.
          </div>
          <div className="footer-bottom-links">
            <Link to="/" className="footer-bottom-link">
              Home
            </Link>
            <span className="footer-divider">•</span>
            <Link to="/privacy-policy" className="footer-bottom-link">
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
