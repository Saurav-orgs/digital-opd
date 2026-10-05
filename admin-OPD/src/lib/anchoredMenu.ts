import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Kept clear of every viewport edge, so a menu never touches the bezel. */
const GUTTER = 12;
/** Between the trigger and the menu. */
const GAP = 4;

/**
 * Places a dropdown against its trigger, in the viewport rather than in the
 * page.
 *
 * There were two mechanisms for this: the row action menus positioned
 * themselves `fixed` from JS, and the dashboard filter panels were
 * `position:absolute` inside their button wrapper. The absolute ones were the
 * date-picker bug — a panel with no stacking context of its own renders under
 * the table it was opened from — and the fixed one only handled running out of
 * room *below*, so a menu opened from the right-hand end of a narrow row hung
 * off the side of the screen. One placement, used by both.
 *
 * Anchors below-right: the menu's right edge lines up with the trigger's, so a
 * "⋮" at the end of a row opens back over the row and not off the edge. Flips
 * above when the space below cannot hold it, and nudges inward when either
 * side would spill.
 */
export function useAnchoredMenu(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;

    const t = trigger.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Right-aligned to the trigger, then pulled back inside whichever edge it
    // crossed. The second Math.max matters on a phone: when the menu is wider
    // than the gutters allow, the inner clamp would otherwise be negative and
    // pin it off the left.
    const wanted = t.right - m.width;
    const left = Math.min(
      Math.max(GUTTER, wanted),
      Math.max(GUTTER, vw - m.width - GUTTER),
    );

    let top = t.bottom + GAP;
    if (top + m.height > vh - GUTTER) {
      const above = t.top - GAP - m.height;
      // Flip above only when it genuinely fits there; a menu taller than the
      // viewport fits nowhere, so sit it as high as it can go and let the
      // stylesheet's max-height scroll it.
      top = above >= GUTTER ? above : Math.max(GUTTER, vh - m.height - GUTTER);
    }

    setPos({ left, top });
  }, [triggerRef]);

  // Layout, not passive: the menu is measured after it is in the DOM but must
  // be placed before it is painted, or it shows for one frame at its
  // off-screen parking spot.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    // Re-anchor rather than close. The menus that closed on scroll did it
    // because a fixed menu placed once drifts away from its row; following the
    // trigger is the fix, and a list that nudges by a pixel under the thumb no
    // longer throws the menu away.
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place, onClose, triggerRef]);

  return {
    menuRef,
    /** Spread onto the menu element. Parked off-screen until measured. */
    style: {
      position: 'fixed' as const,
      left: pos ? pos.left : -9999,
      top: pos ? pos.top : 0,
      visibility: pos ? ('visible' as const) : ('hidden' as const),
    },
  };
}
