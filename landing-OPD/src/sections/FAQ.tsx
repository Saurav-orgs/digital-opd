import { ChevronDown } from 'lucide-react';

const FAQS = [
  {
    q: 'Is the price per doctor or per clinic?',
    a: 'Per doctor. A clinic with three consulting doctors needs three subscriptions; front-desk and staff accounts are included at no extra cost.',
  },
  {
    q: 'What happens after I pay?',
    a: 'You get access to the doctor login right away. On your first login we ask for your practice details — name, registration number, specialisation, qualifications and OPD timings — and your booking page goes live.',
  },
  {
    q: 'Do patients pay anything?',
    a: 'No. Booking is free for patients and there is no per-booking fee to you. Consultation fees are between you and the patient; the platform can show your QR and verify a payment screenshot.',
  },
  {
    q: 'Can I switch plans later?',
    a: 'Yes. You can move to a longer cycle at any renewal. Moving from yearly to monthly takes effect when the current year ends.',
  },
  {
    q: 'Does it work on a tablet for handwriting?',
    a: 'Yes. Open it in the browser on any tablet with a stylus — the strokes are composited onto your letterhead so the prescription looks handwritten.',
  },
  {
    q: 'Is my patient data safe?',
    a: 'Each clinic is a separate tenant, so no other clinic can see your patients. Access inside the clinic is permission-driven per role, and every issued prescription carries a verification QR.',
  },
];

export function FAQ() {
  return (
    <section className="section" id="faq">
      <div className="container container--narrow">
        <div className="section-head section-head--center reveal">
          <span className="eyebrow">FAQ</span>
          <h2>Questions doctors ask before signing up</h2>
        </div>
        <div className="faq-list reveal">
          {FAQS.map((f) => (
            <details key={f.q} className="faq">
              <summary>
                <span>{f.q}</span>
                <ChevronDown size={20} aria-hidden="true" />
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
