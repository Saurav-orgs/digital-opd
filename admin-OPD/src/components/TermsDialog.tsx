import {
  PROVIDER_TERMS,
  PROVIDER_TERMS_EFFECTIVE,
  PROVIDER_TERMS_PREAMBLE,
  PROVIDER_TERMS_TITLE,
} from '../content/providerTerms';

/**
 * The provider terms, in full, over the registration form.
 *
 * The full text rather than a link: a doctor is asked to accept these before
 * an account exists, so there is no signed-in page to send them to, and
 * accepting something you were never shown is not acceptance. The whole
 * document scrolls inside the dialog and the form stays behind it, so nothing
 * typed is lost by opening this.
 */
export function TermsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={PROVIDER_TERMS_TITLE}
        style={{ display: 'flex', flexDirection: 'column', maxHeight: '86vh' }}
      >
        <h3 style={{ marginBottom: 2 }}>{PROVIDER_TERMS_TITLE}</h3>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
          {PROVIDER_TERMS_EFFECTIVE}
        </p>

        <div
          style={{
            overflowY: 'auto',
            paddingRight: 6,
            marginTop: 8,
            borderTop: 'var(--hairline)',
            fontSize: 13.5,
            lineHeight: 1.65,
          }}
        >
          {PROVIDER_TERMS_PREAMBLE.map((p, i) => (
            <p key={`pre-${i}`} style={{ marginTop: 12 }}>
              {p}
            </p>
          ))}

          {PROVIDER_TERMS.map((section) => (
            <section key={section.n} style={{ marginTop: 18 }}>
              <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>
                {section.n}. {section.title}
              </h4>
              {section.items.map((item, i) => (
                <p key={i} style={{ margin: '0 0 6px' }}>
                  {item}
                </p>
              ))}
            </section>
          ))}
        </div>

        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
