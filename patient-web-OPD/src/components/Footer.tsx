import React from 'react';
import { Link } from 'react-router-dom';
import { PhoneCall, ShieldCheck } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="web-footer">
      <div className="web-footer-simple">
        <Link to="/" className="web-brand">
          <span className="brand-icon">+</span>
          <span>OPD Patient Portal</span>
        </Link>
        <p className="footer-tagline">
          Fast & reliable OPD appointment booking platform.
        </p>
        <div className="footer-contact-info">
          <a href="tel:+919876543210" className="footer-phone-link">
            <PhoneCall size={15} />
            <span>24/7 Helpline: +91 98765 43210</span>
          </a>
          <div className="footer-verify-badge">
            <ShieldCheck size={15} color="#10B981" />
            <span>100% Verified OPD Doctors</span>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-bottom-inner">
          <div className="footer-copyright">
            © {new Date().getFullYear()} OPD Patient Portal. All rights reserved.
          </div>
          <div className="footer-bottom-links">
            <Link to="/" className="footer-bottom-link">
              Home
            </Link>
            <span className="footer-divider">•</span>
            <Link to="/privacy-policy" className="footer-bottom-link">
              Privacy Policy
            </Link>
            <span className="footer-divider">•</span>
            <a href="tel:+919876543210" className="footer-bottom-link">
              Support
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
