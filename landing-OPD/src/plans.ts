/**
 * Plans, as the server describes them.
 *
 * The three tiers used to be a constant in this file, which meant a price
 * change was a deploy. They now come from `GET /signup/plans`, so the super
 * admin's price list is what the pricing section shows and what the checkout
 * charges. Only the shape, the formatting and the "what you save" arithmetic
 * live here.
 */
export interface Plan {
  id: string;
  /** The plan's stable code — what travels in `/signup?plan=…`. */
  code: string;
  name: string;
  tagline: string | null;
  /** Rupees per month, before GST. */
  monthly: number;
  /** Billing cycle length in months. */
  months: number;
  isRecommended: boolean;
  price: { base: number; gstRate: number; gst: number; total: number };
}

export const inr = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** "Billed every month" / "Billed every 3 months" / "Billed once a year". */
export function cycleLabel(plan: Plan): string {
  if (plan.months === 1) return 'Billed every month';
  if (plan.months === 12) return 'Billed once a year';
  return `Billed every ${plan.months} months`;
}

/**
 * What a saving is measured against: the dearest monthly rate on sale, which
 * is the pay-as-you-go one. If every plan costs the same per month there is
 * no saving to claim, and this returns that same figure so all of them read
 * as zero.
 */
export const baseMonthly = (plans: Plan[]) =>
  plans.reduce((max, p) => Math.max(max, p.monthly), 0);

export const planSaving = (plan: Plan, base: number) =>
  Math.max(0, Math.round((base - plan.monthly) * plan.months * 100) / 100);

export const planSavingPct = (plan: Plan, base: number) =>
  base > 0 ? Math.round(((base - plan.monthly) / base) * 100) : 0;

export const findPlan = (plans: Plan[], code: string | null | undefined) =>
  plans.find((p) => p.code === code);

/** Everything a subscription includes — the same list on every plan. */
export const PLAN_FEATURES = [
  'Personal booking page & live slot grid',
  'Handwrite, voice or type prescriptions',
  'Branded A4 PDF on your letterhead',
  'AI report & progress summaries',
  'Family profiles on one number',
  'Walk-in, reschedule, no-show',
  'Clinic staff accounts & roles',
  'Works on phone, tablet & desktop',
];
