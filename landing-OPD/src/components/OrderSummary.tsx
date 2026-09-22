import { baseMonthly, cycleLabel, inr, planSaving, type Plan } from '../plans';

/**
 * The plan, its GST and the total — the server's own figures, not a sum
 * computed here, so what the doctor reads is what Cashfree will charge.
 */
export function OrderSummary({ plan, allPlans }: { plan: Plan; allPlans: Plan[] }) {
  const saving = planSaving(plan, baseMonthly(allPlans));
  return (
    <aside className="card order-summary" aria-label="Order summary">
      <h2>Order summary</h2>
      <dl>
        <div>
          <dt>Plan</dt>
          <dd>{plan.name}</dd>
        </div>
        <div>
          <dt>Rate</dt>
          <dd>{inr(plan.monthly)} / month</dd>
        </div>
        <div>
          <dt>Cycle</dt>
          <dd>{cycleLabel(plan).replace('Billed ', '')}</dd>
        </div>
        <div>
          <dt>Subtotal</dt>
          <dd>{inr(plan.price.base)}</dd>
        </div>
        <div>
          <dt>GST ({plan.price.gstRate}%)</dt>
          <dd>{inr(plan.price.gst)}</dd>
        </div>
        {saving > 0 && (
          <div>
            <dt>You save</dt>
            <dd className="order-save">{inr(saving)}</dd>
          </div>
        )}
        <div className="order-total">
          <dt>Due today</dt>
          <dd>{inr(plan.price.total)}</dd>
        </div>
      </dl>
      <p className="muted small">
        Per doctor, in INR. Renews at the same rate unless cancelled.
      </p>
    </aside>
  );
}
