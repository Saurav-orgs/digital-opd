/**
 * Money and dates, formatted the one way this app formats them.
 *
 * `inr` had seven identical definitions across the billing, plans, payment-log
 * and subscription screens, and the date helper five — in two spellings, one
 * printing "September" and one "Sep", picked by whichever file a reader
 * happened to open. A price shown two ways on two screens is a support call,
 * so both live here and the difference is now a named choice rather than an
 * accident.
 */

export const inr = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** "5 September 2026" — for prose, where the month is read rather than scanned. */
export const longDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '—';

/** "5 Sep 2026" — for tables, where the column is narrow. */
export const shortDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';

/** Whole days from now until `iso`, or null when there is no date. */
export const daysLeft = (iso: string | null) =>
  iso === null ? null : Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
