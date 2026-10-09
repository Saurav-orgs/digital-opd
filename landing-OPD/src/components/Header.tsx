import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, Menu, X } from 'lucide-react';
import { Logo } from './Brand';
import { AppConfig } from '../config';

/*
 * Section anchors only — everything a doctor reads on the way to a plan.
 *
 * "Book an appointment" used to be the first of these, and it disappeared: a
 * patient's one task on this page, set in the same weight, colour and shape as
 * four marketing anchors, and wrapping onto two lines at 1024px. It is an
 * action, not a section, and it belongs with the other actions on the right —
 * see `site-header-actions` below.
 */
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

        {/*
          The doctor's two, and only those. Booking is a patient's action and
          it now sits in the hero beside See plans and Email us, where it is
          read rather than scanned past — a third button up here crowded the
          row and pushed the whole header into a layout it did not want.
        */}
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
            {/* First in the drawer too: a patient who opened the menu is
                looking for this, not for the pricing table. */}
            {/* <a
              href="#book"
              className="btn btn-outline btn-book"
              onClick={() => setOpen(false)}
            >
              <CalendarCheck size={17} aria-hidden /> Book a Doctor
            </a> */}
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
