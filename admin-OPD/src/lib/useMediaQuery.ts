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
 * The design has two: at 700px the mobile drawer becomes a persistent icon
 * rail, and at 1024px the phone-shaped column becomes a real desktop layout —
 * lists turn into tables, the consultation splits into two columns.
 */

/** Below this the appointment list is cards, not a table. */
export const NARROW = '(max-width: 1023px)';

/** At and above this the sidebar is a persistent rail, not a drawer. */
export const RAIL = '(min-width: 700px)';

/** At and above this the desktop layouts apply. */
export const DESKTOP = '(min-width: 1024px)';
