import { useEffect, useState } from 'react';

/**
 * Live answer to a CSS media query.
 *
 * Used where a layout change is structural rather than cosmetic — a table
 * becoming a list of cards is different markup, not different CSS, and
 * rendering both and hiding one would double the DOM for every row.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (!window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/**
 * Breakpoints, taken from the client's design rather than chosen here.
 *
 * The doctor-panel prototype uses exactly four — 400 / 767 / 900 / 1180 — and
 * these mirror them. This app had accumulated about twenty-six distinct
 * widths, which meant a change at "the phone breakpoint" had to be made in
 * several places and was reliably made in only some of them. Anything in a
 * stylesheet that is not one of these four is a leftover, not a decision.
 *
 * The rail moved 700 → 768. It was 700 because an earlier design said so;
 * the current one splits at 767/768, and a 68px window where the shell and
 * the page disagreed about which layout they were in is how the consultation
 * ended up with two columns inside a drawer.
 */

/** Below this the appointment list is cards, not a table. */
export const NARROW = '(max-width: 899px)';

/** At and above this the sidebar is a persistent rail, not a drawer. */
export const RAIL = '(min-width: 768px)';

/** At and above this the desktop layouts apply. */
export const DESKTOP = '(min-width: 900px)';

/** The phone layer: cards, sheets, the floating primary action. */
export const PHONE = '(max-width: 767px)';
