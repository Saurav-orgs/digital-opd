import { useCallback, useState } from 'react';

const PREFIX = 'opd_admin_collapsed:';

/**
 * A collapsed/expanded panel that remembers the doctor's choice.
 *
 * Remembering matters more than it looks. A doctor who does not read the AI
 * card is not making a decision about *this* patient — they are saying they do
 * not want it in the way, and re-collapsing it on every appointment would be a
 * worse tax than the card itself. The choice is per browser and per panel, so
 * one can be folded away while another stays open.
 *
 * Storage can throw outright (Safari private mode) or simply be absent, so
 * every access is guarded and the default is the answer whenever it is.
 */
export function useCollapsible(
  key: string,
  defaultCollapsed = false,
): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(PREFIX + key);
      return stored === null ? defaultCollapsed : stored === '1';
    } catch {
      return defaultCollapsed;
    }
  });

  const toggle = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(PREFIX + key, next ? '1' : '0');
      } catch {
        // A preference that cannot be saved still applies to this session.
      }
      return next;
    });
  }, [key]);

  return [collapsed, toggle];
}
