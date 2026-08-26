import type { Appointment } from '../api/types';

/** How often to re-fetch an appointment whose AI summaries are still running. */
export const SUMMARY_POLL_MS = 3000;

/**
 * True while any report summary — per-report or the combined visit one — is
 * still queued or running on the AI service.
 *
 * Summaries are produced in the background, so without re-fetching the
 * appointment the UI stays stuck on "Summarising…" until the page is reloaded.
 */
export function summariesInFlight(a: Appointment | null | undefined): boolean {
  if (!a) return false;
  const running = (s?: string | null) => s === 'pending' || s === 'processing';
  return (
    running(a.reports_summary_status) ||
    (a.reports ?? []).some((r) => running(r.ai_summary_status))
  );
}

/** `refetchInterval` for an appointment query: poll only while work is in flight. */
export function appointmentRefetchInterval(q: {
  state: { data: unknown };
}): number | false {
  return summariesInFlight(q.state.data as Appointment | undefined)
    ? SUMMARY_POLL_MS
    : false;
}
