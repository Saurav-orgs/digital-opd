import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Search, Stethoscope } from 'lucide-react';
import { doctorsApi, type PublicDoctor } from '../api';

/** Long enough that a name is not searched letter by letter, short enough to feel live. */
const DEBOUNCE_MS = 250;
/** One letter matches most of the directory; two is where a search starts to mean something. */
const MIN_CHARS = 2;

/**
 * Open a doctor's booking page.
 *
 * A full page load, not a route change: the booking page is the patient app,
 * deployed separately from this site.
 */
function go(d: PublicDoctor) {
  window.location.assign(d.bookingUrl);
}

/** "Priya Verma" → "PV". One letter if that is all there is. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** The line under the name: speciality, then where they sit. */
function subtitle(d: PublicDoctor): string {
  return [d.specialization, d.clinicName, d.clinicAddress]
    .filter(Boolean)
    .join(' · ');
}

/**
 * "Find your doctor" — the patient's way in.
 *
 * Every doctor has a booking link, and until now a patient had to have been
 * given it: scan the clinic's QR, or be sent the URL. Someone who simply knows
 * their doctor's name arrived at the front door of the product and found only
 * a sales page. They type the name here, pick the doctor out of the dropdown
 * and land on that doctor's own booking page — the patient app's, not a second
 * copy of it living on the marketing site.
 */
export function FindDoctor() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  /** Which row the keyboard is on; -1 is "none, the input has it". */
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  const term = query.trim();
  const ready = term.length >= MIN_CHARS;

  /**
   * The last finished search, and what it was for.
   *
   * Held as one value rather than as rows + loading + error, because the term
   * is what makes the other two meaningful: anything whose `term` is not the
   * one in the box describes a search the patient has already typed past, so
   * "are we still waiting" is read off it instead of being tracked separately
   * and left behind by an aborted request.
   */
  const [done, setDone] = useState<{
    term: string;
    rows: PublicDoctor[];
    error: string | null;
  }>({ term: '', rows: [], error: null });

  const fresh = done.term === term;
  const results = fresh ? done.rows : [];
  const error = fresh ? done.error : null;
  const loading = ready && !fresh;

  useEffect(() => {
    if (!ready) return;
    // Abort rather than ignore: a patient typing a name fires a request per
    // keystroke otherwise, and the slowest one would land last and win.
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      doctorsApi
        .search(term, ctrl.signal)
        .then((rows) => setDone({ term, rows, error: null }))
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          setDone({
            term,
            rows: [],
            error:
              err instanceof Error
                ? err.message
                : 'Could not search right now. Please try again.',
          });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [term, ready]);

  // A dropdown that outlives a click elsewhere on the page covers the content
  // under it, so the page itself closes it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        // Wraps, so holding either arrow never dead-ends.
        return ((next % results.length) + results.length) % results.length;
      });
      return;
    }
    if (e.key === 'Enter') {
      // Enter on a highlighted row books that doctor; Enter with nothing
      // highlighted takes the only match, because that is plainly what was
      // meant when the list has one row.
      const pick = results[active] ?? (results.length === 1 ? results[0] : null);
      if (pick) {
        e.preventDefault();
        go(pick);
      }
    }
  };

  // Open from two characters in, whatever the state: "Searching…", the error
  // and "no match" all belong in the same panel as the results.
  const showDropdown = open && ready;

  return (
    <section className="section find-doctor" id="book">
      <div className="container">
        <div className="section-head section-head--center reveal">
          <span className="eyebrow">For patients</span>
          <h2>Find your doctor and book a slot</h2>
          <p>
            Type your doctor’s name, their speciality or their clinic. Pick them
            from the list and choose a time. No app to install, no account
            needed to start.
          </p>
        </div>

        <div className="finder reveal" ref={boxRef}>
          <div className="finder-anchor">
            <div className="finder-field">
              <Search size={18} className="finder-icon" aria-hidden />
              <input
                className="input finder-input"
                type="search"
                value={query}
                placeholder="e.g. Dr. Sharma, dentist, Apollo Clinic"
                aria-label="Search for a doctor by name, speciality or clinic"
                aria-autocomplete="list"
                aria-expanded={showDropdown}
                aria-controls="doctor-results"
                autoComplete="off"
                onChange={(e) => {
                  setQuery(e.target.value);
                  // A highlighted row belongs to the list it was highlighted in.
                  setActive(-1);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
              />
            </div>

            {showDropdown && (
              <ul className="finder-list" id="doctor-results" role="listbox">
                {loading ? (
                  <li className="finder-note">Searching…</li>
                ) : error ? (
                  <li className="finder-note is-error">{error}</li>
                ) : results.length === 0 ? (
                  <li className="finder-note">
                    No doctor on myDigitalOPD matches “{term}”. Ask your clinic for
                    their booking link.
                  </li>
                ) : (
                  results.map((d, i) => (
                    <li key={d.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        className={`finder-row ${i === active ? 'is-active' : ''}`}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(d)}
                      >
                        {d.photoUrl ? (
                          <img className="finder-avatar" src={d.photoUrl} alt="" />
                        ) : (
                          <span className="finder-avatar" aria-hidden>
                            {initials(d.name)}
                          </span>
                        )}
                        <span className="finder-who">
                          <strong>{d.name}</strong>
                          {subtitle(d) && <span>{subtitle(d)}</span>}
                        </span>
                        <span className="finder-go" aria-hidden>
                          Book <ArrowRight size={15} />
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          <p className="finder-hint">
            <Stethoscope size={15} aria-hidden /> Only doctors who use
            myDigitalOPD appear here. Bookings are open for the next three
            months.
          </p>
        </div>
      </div>
    </section>
  );
}
