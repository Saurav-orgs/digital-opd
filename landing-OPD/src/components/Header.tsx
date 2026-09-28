import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { Logo } from './Brand';
import { AppConfig } from '../config';

const NAV = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The drawer is the only thing that scrolls while it is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header className={`site-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="container site-header-row">
        <Link to="/" className="site-logo" aria-label="myDigitalOPD home">
          <Logo size={34} />
        </Link>

        <nav className="site-nav" aria-label="Primary">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="site-nav-link">
              {n.label}
            </a>
          ))}
        </nav>

        <div className="site-header-actions">
          <a href={AppConfig.links.doctorLogin} className="btn btn-ghost">
            Doctor login
          </a>
          <a href="#pricing" className="btn btn-primary">
            Start your practice
          </a>
        </div>

        <button
          type="button"
          className="menu-btn"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {open && (
        <div id="mobile-nav" className="mobile-nav" role="dialog" aria-label="Menu">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="mobile-nav-link"
              onClick={() => setOpen(false)}
            >
              {n.label}
            </a>
          ))}
          <div className="mobile-nav-actions">
            <a href={AppConfig.links.doctorLogin} className="btn btn-ghost">
              Doctor login
            </a>
            <a href="#pricing" className="btn btn-primary" onClick={() => setOpen(false)}>
              Start your practice
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
