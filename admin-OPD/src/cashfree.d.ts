/**
 * `@cashfreepayments/cashfree-js` ships no type declarations — it is a small
 * loader that injects Cashfree's hosted v3 script and hands back the object
 * it defines. This declares the slice of it the sign-up uses.
 */
declare module '@cashfreepayments/cashfree-js' {
  export interface CheckoutOptions {
    paymentSessionId: string;
    /** '_self' navigates this tab to the gateway; '_blank' or a modal element are the alternatives. */
    redirectTarget?: '_self' | '_blank' | '_top' | '_modal' | HTMLElement;
    returnUrl?: string;
  }

  export interface CheckoutResult {
    error?: { message?: string; code?: string };
    redirect?: boolean;
    paymentDetails?: { paymentMessage?: string };
  }

  export interface Cashfree {
    checkout(options: CheckoutOptions): Promise<CheckoutResult>;
  }

  export function load(options: { mode: 'sandbox' | 'production' }): Promise<Cashfree>;
}
