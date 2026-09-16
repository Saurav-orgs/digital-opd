import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { rolesApi } from '../api/endpoints';
import type { PermModule, Permission } from '../api/types';
import {
  MODULES_HIDDEN_FROM_ROLES,
  MODULE_LABEL,
  ROLE_MODULES_UNTICKED_BY_DEFAULT,
  ROLE_MODULE_ORDER,
} from '../lib/nav';
import { Loading } from './ui';

const ACTIONS = ['create', 'read', 'update', 'delete'] as const;

type ModuleRow = [string, Record<string, Permission>];

/**
 * The permission catalogue as rows of modules, in the order the editors show
 * them, minus the modules a clinic cannot reach. Shared by the role editor
 * and the team screen so both grids read the same and default the same.
 */
export function usePermissionRows() {
  const permsQ = useQuery({ queryKey: ['permissions'], queryFn: rolesApi.permissions });

  // Skips modules with no screen a clinic role can reach — a row nobody can
  // act on is only a question the admin has to answer wrongly. Rows come out
  // in `ROLE_MODULE_ORDER`; a module the catalogue has that the order does
  // not is appended rather than lost.
  const rows = useMemo<ModuleRow[]>(() => {
    const map: Record<string, Record<string, Permission>> = {};
    for (const p of permsQ.data ?? []) {
      if ((MODULES_HIDDEN_FROM_ROLES as string[]).includes(p.module)) continue;
      (map[p.module] ??= {})[p.action] = p;
    }
    const ordered: ModuleRow[] = [];
    for (const m of ROLE_MODULE_ORDER) if (map[m]) ordered.push([m, map[m]]);
    for (const [m, actions] of Object.entries(map)) {
      if (!(ROLE_MODULE_ORDER as string[]).includes(m)) ordered.push([m, actions]);
    }
    return ordered;
  }, [permsQ.data]);

  return { rows, loading: permsQ.isLoading };
}

/**
 * What a new role or team member starts with: the day-to-day screens fully
 * granted, and only the last rows — the team and role admin — left for the
 * doctor to decide.
 */
export function defaultGrants(rows: ModuleRow[]): Set<string> {
  const granted = rows.slice(0, Math.max(0, rows.length - ROLE_MODULES_UNTICKED_BY_DEFAULT));
  return new Set(granted.flatMap(([, actions]) => Object.values(actions).map((p) => p.id)));
}

/**
 * Seed a selection with the defaults exactly once, after the catalogue lands.
 *
 * The catalogue arrives after the dialog opens, so the defaults cannot be
 * computed in the initial state. `enabled` is false when editing something
 * that already holds permissions — those open with exactly what they hold.
 */
export function useDefaultGrants(
  rows: ModuleRow[],
  enabled: boolean,
  setSelected: (next: Set<string>) => void,
) {
  const [seeded, setSeeded] = useState(!enabled);
  useEffect(() => {
    if (seeded || !rows.length) return;
    setSelected(defaultGrants(rows));
    setSeeded(true);
  }, [rows, seeded, setSelected]);
}

/** The checkbox grid: one row per module, one column per action. */
export function PermissionMatrix({
  rows,
  loading,
  selected,
  onToggle,
}: {
  rows: ModuleRow[];
  loading: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (loading) return <Loading />;
  return (
    <div className="matrix-scroll">
      <div className="checkbox-grid">
        <div />
        {ACTIONS.map((a) => (
          <div key={a} className="muted" style={{ textAlign: 'center', fontSize: 12 }}>
            {a}
          </div>
        ))}
        {rows.map(([module, actions]) => (
          <MatrixRow
            key={module}
            module={module}
            actions={actions}
            selected={selected}
            toggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function MatrixRow({
  module,
  actions,
  selected,
  toggle,
}: {
  module: string;
  actions: Record<string, Permission>;
  selected: Set<string>;
  toggle: (id: string) => void;
}) {
  return (
    <>
      <div className="mod">
        {MODULE_LABEL[module as PermModule] ?? module.replace('_', ' ')}
      </div>
      {ACTIONS.map((a) => {
        const perm = actions[a];
        return (
          <div key={a} style={{ textAlign: 'center' }}>
            {perm ? (
              <input
                type="checkbox"
                checked={selected.has(perm.id)}
                onChange={() => toggle(perm.id)}
              />
            ) : (
              <span className="muted">—</span>
            )}
          </div>
        );
      })}
    </>
  );
}
