import { useEffect } from 'react';

/**
 * Adds `.is-in` to every `.reveal` element as it scrolls into view — a
 * one-shot, subtle fade-up. Under prefers-reduced-motion everything is shown
 * immediately and no observer is attached, so the final state is what renders.
 *
 * Elements that mount later (the pricing cards arrive after `GET /signup/plans`)
 * are picked up by a MutationObserver; without it they would sit at opacity 0
 * forever, because the initial query ran before they existed.
 */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const pending = (root: ParentNode) => {
      const found = Array.from(root.querySelectorAll<HTMLElement>('.reveal:not(.is-in)'));
      if (root instanceof HTMLElement && root.matches('.reveal:not(.is-in)')) found.push(root);
      return found;
    };

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const show = (el: Element) => el.classList.add('is-in');

    let io: IntersectionObserver | null = null;
    if (!reduce && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              show(e.target);
              io!.unobserve(e.target);
            }
          }
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
      );
    }
    const track = (els: HTMLElement[]) => els.forEach((el) => (io ? io.observe(el) : show(el)));

    track(pending(document));

    const mo = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement) track(pending(n));
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      io?.disconnect();
    };
  }, deps);
}
