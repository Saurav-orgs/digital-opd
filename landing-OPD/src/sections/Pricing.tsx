import { Link } from 'react-router-dom';
import { AlertCircle, Check, ArrowRight, Loader2 } from 'lucide-react';
import {
  PLAN_FEATURES,
  baseMonthly,
  cycleLabel,
  inr,
  planSaving,
  planSavingPct,
} from '../plans';
import { usePlans } from '../usePlans';

export function Pricing() {
  const { plans, error, loading } = usePlans();
  // Savings are relative to the dearest monthly rate actually on sale, so the
  // badge stays true whatever the super admin has priced the plans at.
  const base = plans ? baseMonthly(plans) : 0;

  return (
    <section className="section" id="pricing">
      <div className="container">
        <div className="section-head section-head--center reveal">
          <span className="eyebrow">Pricing</span>
          <h2>One price per doctor. Pick how long you commit.</h2>
          <p>
            Every plan includes every feature. The longer the cycle, the lower
            the monthly rate — nothing else changes.
          </p>
        </div>

        {loading && (
          <p className="plans-state" role="status">
            <Loader2 size={20} className="spin" aria-hidden="true" /> Loading plans…
          </p>
        )}
        {error && (
          <p className="plans-state plans-state--error" role="alert">
            <AlertCircle size={20} aria-hidden="true" /> {error}
          </p>
        )}

        {plans && (
          <div className="plans">
            {plans.map((p, i) => {
              const saving = planSaving(p, base);
              return (
                <article
                  key={p.code}
                  className={`card plan reveal ${p.isRecommended ? 'plan--recommended' : ''}`}
                  style={{ transitionDelay: `${i * 70}ms` }}
                  aria-label={`${p.name} plan`}
                >
                  {p.isRecommended && <span className="plan-badge">Most popular</span>}
                  <h3>{p.name}</h3>
                  <p className="plan-tagline">{p.tagline}</p>

                  <div className="plan-price">
                    <span className="plan-amount">{inr(p.monthly)}</span>
                    <span className="plan-per">/ month + GST</span>
                  </div>
                  {saving > 0 ? (
                    <span className="plan-save">
                      Save {inr(saving)} ({planSavingPct(p, base)}%) vs monthly
                    </span>
                  ) : (
                    <span className="plan-save plan-save--none">
                      {p.months === 1 ? 'Cancel any month' : `${p.months}-month cycle`}
                    </span>
                  )}

                  <dl className="plan-specs">
                    <div>
                      <dt>Billed as</dt>
                      <dd>
                        {inr(p.price.base)} + GST
                        <span className="plan-specs-sub">
                          {cycleLabel(p).replace('Billed ', '')}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Commitment</dt>
                      <dd>{p.months === 1 ? '1 month' : `${p.months} months`}</dd>
                    </div>
                    <div>
                      <dt>Features</dt>
                      <dd>All included</dd>
                    </div>
                  </dl>

                  <Link
                    to={`/signup?plan=${p.code}`}
                    className={`btn btn-lg ${p.isRecommended ? 'btn-primary' : 'btn-outline'}`}
                  >
                    Choose {p.name} <ArrowRight size={18} />
                  </Link>
                </article>
              );
            })}
          </div>
        )}

        <div className="card included reveal">
          <h3>Included in every plan</h3>
          <ul className="check-grid">
            {PLAN_FEATURES.map((f) => (
              <li key={f}>
                <Check size={16} aria-hidden="true" /> {f}
              </li>
            ))}
          </ul>
        </div>

        <p className="pricing-note">
          Prices are per doctor, in INR, exclusive of GST. Pay securely online — UPI, cards and net
          banking — and start the same day.
        </p>
      </div>
    </section>
  );
}
