/**
 * The two things every payment screen in this app does: open Cashfree's
 * hosted checkout, and then watch the order it sends the payer back with.
 *
 * Both were written out by hand on each screen — the sign-in activation
 * panel, the renewal card and the Billing page — and the copies had already
 * drifted. The order watcher on Billing retried a failing request every five
 * seconds forever, because only the sign-up copy ever learned to give up;
 * the sign-up copy alone knew that a 404 is final and says nothing about
 * anybody's payment. One implementation gets both.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { load, type Cashfree } from '@cashfreepayments/cashfree-js';
import { ApiError } from '../api/client';
import type { CheckoutSession, OrderStatus } from '../api/types';

/** Long enough for a bank redirect to settle, short enough that nobody waits forever. */
const POLL_MS = 2500;
const GIVE_UP_AFTER_MS = 90_000;

export type OrderWatch = {
  status: OrderStatus | null;
  /** The order is still pending and we have stopped asking. */
  timedOut: boolean;
  /** The id names no order of ours — a stale bookmark, or a mangled link. */
  unknown: boolean;
};

/**
 * Poll an order until it settles.
 *
 * Everything shown comes from the server: a browser that came back
 * "successful" proves nothing until the API says the payment landed. A
 * `pending` row is re-checked against Cashfree on every ask, so a webhook
 * that never arrived cannot leave a doctor who has paid looking at a spinner.
 *
 * `fetchOrder` is the caller's, because the two screens ask different
 * endpoints: the sign-in panel has no session yet and uses the public
 * `/signup/orders/:id`, while Billing uses the caller-scoped one.
 */
export function useOrderWatch(
  orderId: string | null,
  fetchOrder: (orderId: string) => Promise<OrderStatus>,
  onSettled?: () => void,
): OrderWatch {
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [unknown, setUnknown] = useState(false);

  // Held in refs so a caller passing an inline arrow function does not restart
  // the poll on every render.
  const fetchRef = useRef(fetchOrder);
  const settledRef = useRef(onSettled);
  fetchRef.current = fetchOrder;
  settledRef.current = onSettled;

  useEffect(() => {
    if (!orderId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    let announced = false;
    const startedAt = Date.now();
    setStatus(null);
    setTimedOut(false);
    setUnknown(false);

    const expired = () => Date.now() - startedAt > GIVE_UP_AFTER_MS;

    const tick = async () => {
      try {
        const res = await fetchRef.current(orderId);
        if (!live) return;
        setStatus(res);
        if (res.status === 'pending') {
          if (expired()) setTimedOut(true);
          else timer = setTimeout(tick, POLL_MS);
          return;
        }
        if (!announced) {
          announced = true;
          settledRef.current?.();
        }
      } catch (err) {
        if (!live) return;
        // A 404 is final and says nothing about anybody's payment, so it is
        // not dressed up as one — there is no point polling it or worrying
        // the doctor about a bank that was never involved.
        if (err instanceof ApiError && err.statusCode === 404) {
          setUnknown(true);
          return;
        }
        // Backing off to twice the interval, and still bounded: a request
        // that keeps failing used to be retried here forever.
        if (expired()) setTimedOut(true);
        else timer = setTimeout(tick, POLL_MS * 2);
      }
    };

    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [orderId]);

  return { status, timedOut, unknown };
}

/**
 * Hand a checkout session to Cashfree's hosted page.
 *
 * `open` takes whatever opened the order — `signupApi.resume`,
 * `billingApi.renew` — runs it, and navigates this tab to the gateway.
 * Cashfree returns the payer to the `return_url` the server set, which is the
 * screen that called this, and `useOrderWatch` takes over from there.
 *
 * `busy` stays true through a successful redirect on purpose: the tab is on
 * its way to the gateway, and a button that springs back to "Pay" while the
 * page is leaving invites a second click and a second order.
 */
export function useCashfreeCheckout() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sdk = useRef<Cashfree | null>(null);

  const open = useCallback(async (start: () => Promise<CheckoutSession>) => {
    setBusy(true);
    setError(null);
    try {
      const session = await start();
      sdk.current ??= await load({ mode: session.env });
      if (!sdk.current) throw new Error('checkout unavailable');
      // '_self' navigates this tab to the gateway rather than opening a popup
      // a blocker can eat.
      await sdk.current.checkout({
        paymentSessionId: session.paymentSessionId,
        redirectTarget: '_self',
      });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not open the payment. Please try again.',
      );
      setBusy(false);
    }
  }, []);

  return { open, busy, error };
}
