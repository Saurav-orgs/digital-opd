/**
 * How long a report name is allowed to be on a list row.
 *
 * The desk asked for a hard limit rather than a CSS ellipsis: a row whose
 * name was "Complete Blood Count with Differential — 14 Oct.pdf" pushed View
 * and Delete off the card on the Reports page, and on the visit page the
 * elided name still took the whole row from the date beside it. Fifteen is
 * the number they asked for, and it is enough to tell two of a patient's
 * reports apart at a glance; the full name is always one hover or one click
 * away.
 */
export const REPORT_TITLE_MAX = 15;

/**
 * A report name cut to `max` characters, with an ellipsis when it was cut.
 *
 * The ellipsis is the single character "…", not three dots, so it costs one
 * column rather than three in a row that is short of them. Trailing spaces go
 * before it — "Blood test  …" reads as a mistake.
 *
 * Always render the full name as the element's `title` beside this, or the
 * doctor has no way back to it.
 */
export function shortReportTitle(title: string, max = REPORT_TITLE_MAX): string {
  const t = title.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}
