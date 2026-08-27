import type { Appointment, ProgressSummary } from '../api/types';

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
    // The across-visits summary is built *after* the per-visit one finishes, so
    // there is a window where every other status reads "ready" and only this is
    // still working. Leaving it out stopped the polling one step early and left
    // the card saying "Building…" until the page was reloaded by hand.
    running(a.progress_summary_status) ||
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

/**
 * Whether an across-visits summary actually says anything about a trajectory.
 *
 * The model still returns a well-formed object when the two visits share no
 * comparable measurement — correctly, with `status: "unclear"` and every list
 * empty. Rendering that is worse than rendering nothing: it occupies the one
 * slot the doctor reads first, and pushes the visit's own summary (which may
 * carry dozens of abnormal values) out of view behind a card whose entire
 * content is "no trends can be reported".
 */
export function hasTrajectory(p: ProgressSummary | null | undefined): boolean {
  if (!p) return false;
  return (
    (p.trends?.length ?? 0) > 0 ||
    (p.improvements?.length ?? 0) > 0 ||
    (p.deteriorations?.length ?? 0) > 0 ||
    (p.unchanged?.length ?? 0) > 0
  );
}
