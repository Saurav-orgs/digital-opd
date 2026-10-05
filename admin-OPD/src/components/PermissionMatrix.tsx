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

/**
 * Three columns, not four.
 *
 * The grid rendered `create · read · update · delete`, which is the API's
 * vocabulary rather than the doctor's. The design asks three questions — can
 * this person *see* it, *add* to it, *change* it — and leaves deletion out
 * entirely, because deleting a patient or a role is the account owner's to do
 * and not something to hand around on a checkbox grid.
 *
 * `delete` is not rendered and never newly granted. A role that already holds
 * it keeps it: the editor resubmits the ids it is holding, so an existing
 * grant survives an edit it is not shown in — the same rule `nav.ts` records
 * for modules hidden from this grid.
 */
const COLUMNS = [
  { action: 'read', label: 'View' },
  { action: 'create', label: 'Create' },
  { action: 'update', label: 'Edit' },
] as const;

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

/**
 * Apply a tick, keeping the module's three boxes coherent.
 *
 * Create and Edit imply View: a role that may add a patient but not see the
 * list holds a permission that does nothing, and the grid should not let the
 * doctor build one by accident. So ticking Create or Edit turns View on too,
 * and clearing View clears all three.
 *
 * `delete` is never touched here. It has no column, and whatever a role
 * already holds rides along untouched in `selected`.
 */
export function applyToggle(
  rows: ModuleRow[],
  selected: Set<string>,
  id: string,
  action: string,
): Set<string> {
  const next = new Set(selected);
  const module = rows.find(([, actions]) =>
    Object.values(actions).some((p) => p.id === id),
  );
  const actions = module?.[1] ?? {};
  const idOf = (a: string) => actions[a]?.id;
  const turningOn = !next.has(id);

  if (turningOn) {
    next.add(id);
    if (action === 'create' || action === 'update') {
      const read = idOf('read');
      if (read) next.add(read);
    }
    return next;
  }

  next.delete(id);
  if (action === 'read') {
    for (const a of ['create', 'update']) {
      const other = idOf(a);
      if (other) next.delete(other);
    }
  }
  return next;
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
  /** `action` lets the caller apply the View-implied-by-Create/Edit rule. */
  onToggle: (id: string, action: string) => void;
}) {
  if (loading) return <Loading />;
  return (
    <div className="matrix-scroll">
      <div className="checkbox-grid">
        <div />
        {COLUMNS.map((c) => (
          <div key={c.action} className="muted" style={{ textAlign: 'center', fontSize: 12 }}>
            {c.label}
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
  toggle: (id: string, action: string) => void;
}) {
  return (
    <>
      <div className="mod">
        {MODULE_LABEL[module as PermModule] ?? module.replace('_', ' ')}
      </div>
      {COLUMNS.map((c) => {
        const perm = actions[c.action];
        const checked = !!perm && selected.has(perm.id);
        return (
          <div key={c.action} style={{ textAlign: 'center' }}>
            {perm ? (
              <input
                type="checkbox"
                aria-label={`${c.label} ${MODULE_LABEL[module as PermModule] ?? module}`}
                checked={checked}
                /*
                 * Create and Edit imply View. Someone who can add a patient
                 * but cannot see the list has a permission that does nothing,
                 * and the grid should not let the doctor build one by
                 * accident — so ticking either turns View on with it, and
                 * untickng View turns both off.
                 */
                onChange={() => toggle(perm.id, c.action)}
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
