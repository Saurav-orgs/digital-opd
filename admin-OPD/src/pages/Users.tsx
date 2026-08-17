import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doctorsApi, rolesApi, usersApi } from '../api/endpoints';
import type { User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { ActionMenuDropdown, Badge, Empty, Field, Loading, Modal } from '../components/ui';

export default function Users() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);

  const usersQ = useQuery({ queryKey: ['users'], queryFn: usersApi.list });

  const remove = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('User removed'); },
    onError: (e) => toast.error(e),
  });

  if (usersQ.isLoading) return <Loading />;

  return (
    <>
      <div className="page-head">
        <h1>Users</h1>
        {can('users', 'create') && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Add user</button>
        )}
      </div>

      {!usersQ.data?.length ? (
        <Empty>No users yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Type</th><th>Role</th><th>Status</th><th style={{ width: 1, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {usersQ.data.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="muted">{u.email}</td>
                  <td style={{ textTransform: 'capitalize' }}>{u.type.replace('_', ' ')}</td>
                  <td className="muted">{u.role?.name ?? '—'}</td>
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
        <Modal title="Delete user" onClose={() => setConfirmDelete(null)}>
          <p style={{ margin: '12px 0 20px', color: 'var(--text)' }}>
            Are you sure you want to delete user <strong>{confirmDelete.name}</strong>?
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
  const rolesQ = useQuery({ queryKey: ['roles'], queryFn: rolesApi.list });
  const doctorsQ = useQuery({ queryKey: ['doctors'], queryFn: doctorsApi.list });

  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    type: (user?.type ?? 'admin') as 'admin' | 'doctor',
    role_id: user?.role_id ?? '',
    doctor_id: user?.doctor_id ?? '',
    is_active: user?.is_active ?? true,
  });

  const save = useMutation({
    mutationFn: () => {
      const body: any = {
        name: form.name,
        email: form.email,
        type: form.type,
        role_id: form.role_id,
        is_active: form.is_active,
      };
      if (form.type === 'doctor') body.doctor_id = form.doctor_id;
      if (form.password) body.password = form.password;
      return user ? usersApi.update(user.id, body) : usersApi.create({ ...body, password: form.password });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success(user ? 'User updated' : 'User created'); onClose(); },
    onError: (e) => toast.error(e),
  });

  const valid =
    form.name.trim() &&
    form.email.trim() &&
    form.role_id &&
    (user || form.password.length >= 8) &&
    (form.type !== 'doctor' || form.doctor_id);

  return (
    <Modal title={user ? 'Edit user' : 'Add user'} onClose={onClose}>
      <Field label="Name">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Email">
        <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <Field
        label={user ? 'New password (leave blank to keep)' : 'Password'}
        error={
          !user && form.password && form.password.length < 8
            ? 'Password must be at least 8 characters.'
            : undefined
        }
      >
        <input
          className="input"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <span className="hint">Must be at least 8 characters.</span>
      </Field>
      <div className="grid cols-2">
        <Field label="Type">
          <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
            <option value="admin">Admin</option>
            <option value="doctor">Doctor</option>
          </select>
        </Field>
        <Field label="Role">
          <select className="select" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}>
            <option value="">Select role…</option>
            {rolesQ.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
      </div>
      {form.type === 'doctor' && (
        <Field label="Linked doctor profile">
          <select className="select" value={form.doctor_id} onChange={(e) => setForm({ ...form, doctor_id: e.target.value })}>
            <option value="">Select doctor…</option>
            {doctorsQ.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
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
