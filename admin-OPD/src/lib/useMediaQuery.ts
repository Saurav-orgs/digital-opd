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

/** The width below which the appointment table stops fitting. */
export const NARROW = '(max-width: 759px)';
