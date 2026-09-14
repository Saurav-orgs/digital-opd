import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Where `Layout` leaves room in the phone top bar. */
export const TOPBAR_SLOT_ID = 'topbar-slot';

/**
 * Puts a screen's own content into the phone top bar.
 *
 * The bar belongs to the shell, but what sits in it is the screen's to say:
 * the appointment list shows its title and the doctor's initials there, while
 * the consultation screen — which has a back link of its own — leaves it
 * empty. A portal keeps that decision on the page that makes it instead of
 * teaching the shell about every route.
 *
 * The slot is looked up after mount because on the first render nothing has
 * reached the DOM yet, the shell's header included.
 */
export function TopbarPortal({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById(TOPBAR_SLOT_ID));
  }, []);
  if (!slot) return null;
  return createPortal(children, slot);
}
