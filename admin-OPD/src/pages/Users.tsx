import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PermissionMatrix,
  useDefaultGrants,
  usePermissionRows,
} from '../components/PermissionMatrix';
import { usersApi } from '../api/endpoints';
import type { User } from '../api/types';
import { MODULE_LABEL, ROLE_MODULE_ORDER } from '../lib/nav';
import { NARROW, useMediaQuery } from '../lib/useMediaQuery';
import { avatarTone, initials } from '../lib/avatar';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ActionMenuDropdown, Badge, Empty, Field, Loading, Modal, PasswordInput } from '../components/ui';

/** The title the doctor gave them; nothing for a role the server named itself. */
function roleTitle(u: User): string | null {
  const n = u.role?.name;
  return n && !n.endsWith("'s access") ? n : null;
}

/** "Appointments, Patients, Upload reports" — what this person can open. */
function accessSummary(u: User): string {
  const modules = new Set(
    (u.role?.permissions ?? []).filter((p) => p.action === 'read').map((p) => p.module),
  );
  const named = ROLE_MODULE_ORDER.filter((m) => modules.has(m)).map((m) => MODULE_LABEL[m]);
  return named.length ? named.join(', ') : u.role?.name ?? '—';
}

export default function Users() {
  const { can } = useAuth();
  const narrow = useMediaQuery(NARROW);
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);

  const usersQ = useQuery({ queryKey: ['users'], queryFn: usersApi.list });

  const remove = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Team member removed'); },
    onError: (e) => toast.error(e),
  });

  if (usersQ.isLoading) return <Loading />;

  return (
    <>
      <div className="page-head">
        <h1>My Team</h1>
        {can('users', 'create') && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Add team member</button>
        )}
      </div>

      {!usersQ.data?.length ? (
        <Empty>No team members yet.</Empty>
      ) : narrow ? (
        // A phone gets cards, not a table squeezed into a sideways scroll —
        // the same shape the patient list uses.
        <div className="team-cards">
          {usersQ.data.map((u) => (
            <div key={u.id} className="team-card">
              <span className={`appt-avatar ${avatarTone(u.name)}`} aria-hidden>
                {initials(u.name)}
              </span>
              <div className="team-card-body">
                <div className="team-card-top">
                  <span className="team-card-name">{u.name}</span>
                  <Badge value={u.is_active ? 'available' : 'rejected'} label={u.is_active ? 'Active' : 'Inactive'} />
                </div>
                {roleTitle(u) && <div className="team-card-role">{roleTitle(u)}</div>}
                <div className="team-card-email">{u.email}</div>
                <div className="team-card-access">{accessSummary(u)}</div>
              </div>
              <UserActionMenu
                user={u}
                canUpdate={can('users', 'update') && u.type !== 'super_admin'}
                canDelete={can('users', 'delete') && u.type !== 'super_admin'}
                onEdit={() => setEditing(u)}
                onDelete={() => setConfirmDelete(u)}
                isPending={remove.isPending}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Access</th><th>Status</th><th style={{ width: 1, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {usersQ.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.name}
                    {roleTitle(u) && (
                      <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                        {roleTitle(u)}
                      </div>
                    )}
                  </td>
                  <td className="muted">{u.email}</td>
                  {/* The screens they can open, not the name of the role
                      behind them — that role is the server's bookkeeping. */}
                  <td className="muted">{accessSummary(u)}</td>
                  <td><Badge value={u.is_active ? 'available' : 'rejected'} label={u.is_active ? 'Active' : 'Inactive'} /></td>
                  <td style={{ textAlign: 'right' }}>
                    <UserActionMenu
                      user={u}
                      canUpdate={can('users', 'update') && u.type !== 'super_admin'}
                      canDelete={can('users', 'delete') && u.type !== 'super_admin'}
                      onEdit={() => setEditing(u)}
                      onDelete={() => setConfirmDelete(u)}
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
        <Modal title="Remove team member" onClose={() => setConfirmDelete(null)}>
          <p style={{ margin: '12px 0 20px', color: 'var(--text)' }}>
            Are you sure you want to remove <strong>{confirmDelete.name}</strong> from your team?
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

      {editing && (
        <UserModal user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function UserActionMenu({
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
  isPending,
}: {
  user?: User;
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

function UserModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { rows, loading } = usePermissionRows();

  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    // Their title — "Receptionist", "Nurse" — shown beside their name when
    // they sign in. The server names the role behind their permissions after
    // it; a default it made up ("Ravi's access") is not offered back as one.
    role_name: user?.role?.name && !user.role.name.endsWith("'s access") ? user.role.name : '',
    is_active: user?.is_active ?? true,
  });
  // Permissions are ticked right here, not picked from a role — the server
  // keeps a role per person behind the scenes. A new member starts with the
  // day-to-day screens granted; an existing one opens with what they hold.
  const [selected, setSelected] = useState<Set<string>>(
    new Set(user?.role?.permissions?.map((p) => p.id) ?? []),
  );
  useDefaultGrants(rows, !user, setSelected);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const save = useMutation({
    mutationFn: () => {
      // Staff accounts only — the server sets the type and links them to the
      // clinic's doctor, so there is nothing to pick here beyond the role.
      const body: any = {
        name: form.name,
        email: form.email,
        role_name: form.role_name.trim(),
        permissionIds: [...selected],
        is_active: form.is_active,
      };
      if (form.password) body.password = form.password;
      return user ? usersApi.update(user.id, body) : usersApi.create({ ...body, password: form.password });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success(user ? 'Team member updated' : 'Team member added'); onClose(); },
    onError: (e) => toast.error(e),
  });

  const valid =
    form.name.trim() &&
    form.email.trim() &&
    selected.size > 0 &&
    (user || form.password.length >= 8);

  return (
    <Modal title={user ? 'Edit team member' : 'Add team member'} onClose={onClose} large>
      <Field label="Name">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Email">
        <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <Field label="Role name">
        <input
          className="input"
          placeholder="e.g. Receptionist, Nurse, Assistant"
          maxLength={60}
          value={form.role_name}
          onChange={(e) => setForm({ ...form, role_name: e.target.value })}
        />
        <span className="hint">Shown next to their name when they sign in.</span>
      </Field>
      <Field
        label={user ? 'New password (leave blank to keep)' : 'Password'}
        error={
          !user && form.password && form.password.length < 8
            ? 'Password must be at least 8 characters.'
            : undefined
        }
      >
        <PasswordInput
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <span className="hint">Must be at least 8 characters.</span>
      </Field>
      <label className="form-label">What they can do</label>
      <div className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>
        Screens they can <strong>read</strong> appear in their menu. Untick what
        this person should not touch.
      </div>
      <PermissionMatrix rows={rows} loading={loading} selected={selected} onToggle={toggle} />
      {selected.size === 0 && (
        <p className="field-err">Tick at least one permission.</p>
      )}
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
        Active (can sign in)
      </label>

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
