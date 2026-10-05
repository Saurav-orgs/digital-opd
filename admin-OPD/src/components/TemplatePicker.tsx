import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Star, Zap } from 'lucide-react';
import { templatesApi } from '../api/endpoints';
import type { PrescriptionTemplate } from '../api/types';
import { useAnchoredMenu } from '../lib/anchoredMenu';

/**
 * "Use a template ▾" — the menu the doctor picks one from mid-consultation.
 *
 * Grouped by category, because that is how a doctor looks for one ("something
 * for fever"), and each row carries its medicine count so an advice-only
 * template is recognisable before it is applied rather than after.
 *
 * Placement goes through the shared anchored-menu hook, so this behaves like
 * every other dropdown and is capped and scrollable on a phone.
 */
export function TemplatePicker({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (t: PrescriptionTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  const { menuRef, style } = useAnchoredMenu(open, btnRef, close);

  const templatesQ = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.list(),
    staleTime: 60 * 1000,
  });

  const grouped = useMemo(() => {
    const byCat = new Map<string, PrescriptionTemplate[]>();
    for (const t of templatesQ.data ?? []) {
      const list = byCat.get(t.category) ?? [];
      list.push(t);
      byCat.set(t.category, list);
    }
    // The doctor's own first inside each category: a template they wrote is
    // more likely the one they are reaching for than one that shipped.
    for (const list of byCat.values()) {
      list.sort((a, b) => {
        if (a.is_builtin !== b.is_builtin) return a.is_builtin ? 1 : -1;
        if (a.usage_count !== b.usage_count) return b.usage_count - a.usage_count;
        return a.name.localeCompare(b.name);
      });
    }
    return [...byCat.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [templatesQ.data]);

  const empty = !templatesQ.isLoading && grouped.length === 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="tpl-use-btn"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Zap size={15} />
        Use a template
        <ChevronDown size={15} />
      </button>

      {open && (
        <div ref={menuRef} className="tpl-menu action-menu-dropdown" style={style}>
          {templatesQ.isLoading && <div className="tpl-menu-note">Loading…</div>}
          {empty && (
            <div className="tpl-menu-note">
              No templates yet. Save one from a prescription you have written.
            </div>
          )}
          {grouped.map(([category, list]) => (
            <div key={category}>
              <div className="tpl-menu-group">{category}</div>
              {list.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="tpl-menu-item"
                  onClick={() => {
                    close();
                    onPick(t);
                  }}
                >
                  <span className="tpl-menu-icon" aria-hidden>
                    {t.is_builtin ? <Zap size={13} /> : <Star size={13} />}
                  </span>
                  <span className="tpl-menu-name">{t.name}</span>
                  <span className="tpl-menu-sub">
                    {t.medicines.length === 0
                      ? 'advice only'
                      : `${t.medicines.length} med${t.medicines.length === 1 ? '' : 's'}`}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
