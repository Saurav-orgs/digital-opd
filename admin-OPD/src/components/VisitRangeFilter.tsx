import { useMemo, useState } from 'react';
import type { Appointment } from '../api/types';

function prettyDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Narrow a patient's visits to a span of dates, and say what is left.
 *
 * The record grows for years; a doctor asking "what happened over the
 * monsoon" should not have to scroll past everything since. Filtered in the
 * browser — the history endpoint already returns every visit for the profile,
 * and a second request for a subset of the same rows buys nothing.
 *
 * `useVisitRange` holds the state and does the filtering; `VisitRangeFilter`
 * is the From/To pair plus the "N visits · first – last" line, which reads
 * as a summary of the record whether or not a span is set.
 */
export function useVisitRange(visits: Appointment[]) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filtered = useMemo(
    () =>
      visits.filter(
        (v) =>
          (!from || v.appointment_date >= from) && (!to || v.appointment_date <= to),
      ),
    [visits, from, to],
  );

  return { from, to, setFrom, setTo, filtered, active: !!from || !!to };
}

export function VisitRangeFilter({
  range,
  total,
}: {
  range: ReturnType<typeof useVisitRange>;
  /** Every visit on the record, so the summary can say "of N". */
  total: number;
}) {
  const { from, to, setFrom, setTo, filtered, active } = range;
  // Visits arrive newest first, so the span reads from the last row to the first.
  const first = filtered[filtered.length - 1]?.appointment_date;
  const last = filtered[0]?.appointment_date;

  return (
    <div className="visit-range">
      <div className="visit-range-inputs">
        <label className="visit-range-field">
          <span className="form-label">From</span>
          <input
            className="input"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="visit-range-field">
          <span className="form-label">To</span>
          <input
            className="input"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        {active && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            Clear
          </button>
        )}
      </div>
      <div className="visit-range-summary muted">
        {filtered.length === 0
          ? active
            ? `No visits between these dates (${total} on record).`
            : 'No visits on record.'
          : `${filtered.length}${active ? ` of ${total}` : ''} visit${
              filtered.length === 1 ? '' : 's'
            } · ${first === last ? prettyDate(first!) : `${prettyDate(first!)} – ${prettyDate(last!)}`}`}
      </div>
    </div>
  );
}
