import { useEffect, useState } from 'react';
import { signupApi } from './api';
import type { Plan } from './plans';

/**
 * The price list, fetched once per page load.
 *
 * No cache and no client-side store: a visitor sees the prices as they are
 * when they arrive, and the checkout re-reads them on the server anyway, so a
 * stale card can never become a wrong charge.
 */
export function usePlans() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    signupApi
      .plans()
      .then((res) => live && setPlans(res))
      .catch(() => live && setError('Could not load the plans. Please refresh the page.'));
    return () => {
      live = false;
    };
  }, []);

  return { plans, error, loading: plans === null && error === null };
}
