import {
  CalendarCheck,
  FileText,
  Mic,
  Sparkles,
  Users,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

interface Feature {
  icon: LucideIcon;
  tone: 'teal' | 'gold' | 'berry' | 'sky';
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: CalendarCheck,
    tone: 'teal',
    title: 'Booking that mirrors your real schedule',
    body:
      'Slots come from your session timings — split sessions like 11–2 and 5–7 included. Leave days blocked, past slots greyed, walk-ins at the desk.',
  },
  {
    icon: Mic,
    tone: 'berry',
    title: 'One prescription, three ways to write it',
    body:
      'Handwrite with a stylus, dictate and let AI draft the rows, or type structured medicines. All three end at the same branded PDF.',
  },
  {
    icon: FileText,
    tone: 'gold',
    title: 'Branded A4 PDF on your letterhead',
    body:
      'Clinic name, logo, address and phone on every page, with a verification QR. Print, share, or issue straight to the patient\'s account.',
  },
  {
    icon: Sparkles,
    tone: 'sky',
    title: 'AI that reads the reports for you',
    body:
      'Every uploaded report gets a summary. Several reports become one Combined summary, and a progress note carries the story to the next visit.',
  },
  {
    icon: Users,
    tone: 'teal',
    title: 'One mobile number, the whole family',
    body:
      'Up to five patient profiles per number — self, spouse, child, parent — each with their own visits, reports and prescriptions.',
  },
  {
    icon: ShieldCheck,
    tone: 'gold',
    title: 'Clinic staff, roles and blocking',
    body:
      'Front-desk accounts with per-module permissions. Block repeat no-show numbers. You decide who sees what.',
  },
];

export function Features() {
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section-head reveal">
          <span className="eyebrow">Everything an OPD needs</span>
          <h2>Built around the consultation, not around billing.</h2>
          <p>
            Every feature sits on the screen a doctor actually lives on — the
            day's appointments and the visit in front of you.
          </p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f, i) => (
            <article
              key={f.title}
              className="card feature-card reveal"
              style={{ transitionDelay: `${(i % 3) * 60}ms` }}
            >
              <span className={`icon-tile icon-tile--${f.tone}`}>
                <f.icon size={22} aria-hidden="true" />
              </span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
