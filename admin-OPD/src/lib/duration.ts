/**
 * The duration of a course, the way a doctor writes it.
 *
 * The prescription stores a number of days — the PDF, the catalogue and the
 * AI draft all read `duration_days` — but nobody writes "14" on a pad; they
 * write "2 weeks". So the field is free text, understood here, and what the
 * doctor sees is the phrase rather than the number behind it.
 */

/** Words the field understands, and how many days each one is. */
const UNITS: [RegExp, number][] = [
  [/^(d|day|days|din)$/i, 1],
  [/^(w|wk|wks|week|weeks)$/i, 7],
  [/^(m|mo|mon|month|months)$/i, 30],
];

/** "5 days" → 5, "2 weeks" → 14, "10" → 10, "" → null, "abc" → NaN. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  // "5 days", "5days", "2 wk only", "10". Anything else is not a duration.
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]*)\.?(?:\s+only)?$/.exec(t);
  if (!m) return NaN;
  const n = Number(m[1]);
  const unit = m[2];
  if (!unit) return Number.isInteger(n) ? n : NaN;
  const found = UNITS.find(([re]) => re.test(unit));
  if (!found) return NaN;
  return Math.round(n * found[1]);
}

/**
 * 5 → "5 days", 14 → "2 weeks", null → "". Weeks are shown for whole weeks
 * of a fortnight or more, which is the rule the printed prescription uses —
 * so what the doctor reads back is what the patient will read.
 */
export function formatDuration(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days) || days <= 0) return '';
  if (days % 7 === 0 && days >= 14) {
    const w = days / 7;
    return `${w} week${w === 1 ? '' : 's'}`;
  }
  return `${days} day${days === 1 ? '' : 's'}`;
}
