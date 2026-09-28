const STEPS = [
  {
    title: 'Share your booking link',
    body:
      'Every doctor gets a page like mydigitalopd.com/d/dr-sharma. Put it on WhatsApp, Google Maps or your visiting card. Patients pick a date and a live slot.',
  },
  {
    title: 'Consult with everything in front of you',
    body:
      'Patient details, previous visits, uploaded reports and the Combined AI summary sit on one screen while you write the prescription.',
  },
  {
    title: 'Issue and follow up',
    body:
      'One tap turns the prescription into a branded A4 PDF on your letterhead. The patient gets it in their account and is notified.',
  },
];

export function HowItWorks() {
  return (
    <section className="section section--tint" id="how">
      <div className="container">
        <div className="section-head reveal">
          <span className="eyebrow">How it works</span>
          <h2>Three steps. Nothing to install at the clinic.</h2>
        </div>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="step reveal"
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <span className="step-num" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
