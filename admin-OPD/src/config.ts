/**
 * The other deployables, as this app links to them.
 *
 * The API base lives in `api/client.ts`, beside the axios instance that uses
 * it; this is for the sites we send a doctor *to*. Read from `import.meta.env`
 * with production as the fallback, the same shape `API_BASE` uses, so a deploy
 * that sets nothing behaves exactly as it did before — and so a local run can
 * point at the landing site on :5176 instead of sending the developer to the
 * live pricing page. CLAUDE.md forbids a second hardcoded URL, and the backend
 * already carries this value as `LANDING_WEB_BASE`.
 */
export const AppConfig = {
  /** landing-OPD — the pricing and sign-up site. No trailing slash. */
  landingBaseUrl: import.meta.env.VITE_LANDING_BASE || 'https://mydigitalopd.com',
};

/**
 * Where "Start practice" goes: the landing site's pricing block, which is the
 * same destination its own "Start your practice" button has. A practice is
 * opened by choosing a plan and paying — never from this app — so the link
 * leaves the app rather than going to a registration form here.
 */
export function startPracticeUrl(): string {
  return `${AppConfig.landingBaseUrl}/#pricing`;
}
