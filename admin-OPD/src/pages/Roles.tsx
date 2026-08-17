import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rolesApi } from '../api/endpoints';
import type { Permission, Role } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ActionMenuDropdown, Empty, Field, Loading, Modal } from '../components/ui';

const ACTIONS = ['create', 'read', 'update', 'delete'] as const;

export default function Roles() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Role | null>(null);

  const rolesQ = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });

  const remove = useMutation({
    mutationFn: (id: string) => rolesApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); toast.success('Role deleted'); },
    onError: (e) => toast.error(e),
  });

  if (rolesQ.isLoading) return <Loading />;

  return (
    <>
      <div className="page-head">
        <h1>Roles &amp; permissions</h1>
        {can('roles', 'create') && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Add role</button>
        )}
      </div>

      {!rolesQ.data?.length ? (
        <Empty>No roles.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Description</th><th>Permissions</th><th style={{ width: 1, textAlign: 'right' }}>Actions</th></tr>
            </thead>
            <tbody>
              {rolesQ.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name} {r.is_system && <span className="badge badge-available">system</span>}
                  </td>
                  <td className="muted">{r.description || '—'}</td>
                  <td className="muted">{r.permissions?.length ?? 0} granted</td>
                  <td style={{ textAlign: 'right' }}>
                    <RoleActionMenu
                      role={r}
                      canUpdate={can('roles', 'update') && !r.is_system}
                      canDelete={can('roles', 'delete') && !r.is_system}
                      onEdit={() => setEditing(r)}
                      onDelete={() => setConfirmDelete(r)}
                      isPending={remove.isPending}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <Modal title="Delete role" onClose={() => setConfirmDelete(null)}>
          <p style={{ margin: '12px 0 20px', color: 'var(--text)' }}>
            Are you sure you want to delete role <strong>{confirmDelete.name}</strong>?
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmDelete(null)}>No</button>
            <button
              className="btn btn-danger"
              onClick={() => {
                remove.mutate(confirmDelete.id);
                setConfirmDelete(null);
              }}
              disabled={remove.isPending}
            >
              {remove.isPending ? 'Deleting…' : 'Yes'}
            </button>
          </div>
        </Modal>
      )}

      {editing && <RoleModal role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RoleActionMenu({
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
  isPending,
}: {
  role?: Role;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  isPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  if (!canUpdate && !canDelete) return null;

  return (
    <div className="action-menu-container">
      <button
        ref={btnRef}
        type="button"
        className="btn-dots"
        aria-label="Actions"
        onClick={() => setOpen((v) => !v)}
      >
        ⋮
      </button>
      {open && (
        <ActionMenuDropdown btnRef={btnRef} onClose={() => setOpen(false)}>
          {canUpdate && (
            <button
              type="button"
              className="action-menu-item"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="action-menu-item danger"
              disabled={isPending}
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Delete
            </button>
          )}
        </ActionMenuDropdown>
      )}
    </div>
  );
}

function RoleModal({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const permsQ = useQuery({ queryKey: ['permissions'], queryFn: rolesApi.permissions });

  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(
    new Set(role?.permissions?.map((p) => p.id) ?? []),
  );

  // Group permissions by module for the checkbox grid.
  const byModule = useMemo(() => {
    const map: Record<string, Record<string, Permission>> = {};
    for (const p of permsQ.data ?? []) {
      (map[p.module] ??= {})[p.action] = p;
    }
    return map;
  }, [permsQ.data]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const save = useMutation({
    mutationFn: () => {
      const permissionIds = [...selected];
      return role
        ? rolesApi.update(role.id, { name, description, permissionIds })
        : rolesApi.create({ name, description, permissionIds });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); toast.success(role ? 'Role updated' : 'Role created'); onClose(); },
    onError: (e) => toast.error(e),
  });

  if (permsQ.isLoading) return <Modal title="Role" onClose={onClose}><Loading /></Modal>;

  return (
    <Modal title={role ? 'Edit role' : 'Add role'} onClose={onClose} large>
      <div className="grid cols-2">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>

      <div className="muted" style={{ fontSize: 12, margin: '4px 0 10px' }}>
        Modules a role can <strong>read</strong> appear in that user’s sidebar.
      </div>
      <div className="matrix-scroll">
        <div className="checkbox-grid">
          <div />
          {ACTIONS.map((a) => <div key={a} className="muted" style={{ textAlign: 'center', fontSize: 12 }}>{a}</div>)}
          {Object.entries(byModule).map(([module, actions]) => (
            <RoleRow key={module} module={module} actions={actions} selected={selected} toggle={toggle} />
          ))}
        </div>
      </div>

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

function RoleRow({
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
      <div className="mod">{module.replace('_', ' ')}</div>
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
