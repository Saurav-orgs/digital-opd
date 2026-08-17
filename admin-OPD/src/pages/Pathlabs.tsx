import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pathlabsApi } from '../api/endpoints';
import type { User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, Empty, Field, Loading, Modal } from '../components/ui';

/** Pathlab login accounts — reports:create + reports:read only (see Reports page). */
export default function Pathlabs() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);

  const labsQ = useQuery({ queryKey: ['pathlabs'], queryFn: pathlabsApi.list });

  const remove = useMutation({
    mutationFn: (id: string) => pathlabsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pathlabs'] });
      toast.success('Pathlab removed');
    },
    onError: (e) => toast.error(e),
  });

  if (labsQ.isLoading) return <Loading />;

  return (
    <>
      <div className="page-head">
        <h1>Pathlabs</h1>
        {can('pathlabs', 'create') && (
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            + Add pathlab
          </button>
        )}
      </div>

      {!labsQ.data?.length ? (
        <Empty>No pathlabs yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th style={{ width: 1, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {labsQ.data.map((lab) => (
                <tr key={lab.id}>
                  <td>{lab.name}</td>
                  <td className="muted">{lab.email}</td>
                  <td>
                    <Badge
                      value={lab.is_active ? 'available' : 'rejected'}
                      label={lab.is_active ? 'Active' : 'Inactive'}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {can('pathlabs', 'update') && (
                      <button className="btn btn-sm" onClick={() => setEditing(lab)}>
                        Edit
                      </button>
                    )}
                    {can('pathlabs', 'delete') && (
                      <button
                        className="btn btn-sm btn-danger"
                        style={{ marginLeft: 8 }}
                        onClick={() => setConfirmDelete(lab)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <Modal title="Delete pathlab" onClose={() => setConfirmDelete(null)}>
          <p style={{ margin: '12px 0 20px', color: 'var(--text)' }}>
            Are you sure you want to delete <strong>{confirmDelete.name}</strong>?
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmDelete(null)}>No</button>
            <button
              className="btn btn-danger"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              {remove.isPending ? 'Deleting…' : 'Yes'}
            </button>
          </div>
        </Modal>
      )}

      {editing && (
        <PathlabModal lab={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function PathlabModal({ lab, onClose }: { lab: User | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: lab?.name ?? '',
    email: lab?.email ?? '',
    password: '',
  });

  const save = useMutation({
    mutationFn: () =>
      lab
        ? pathlabsApi.update(lab.id, {
            name: form.name,
            email: form.email,
            ...(form.password ? { password: form.password } : {}),
          })
        : pathlabsApi.create({ name: form.name, email: form.email, password: form.password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pathlabs'] });
      toast.success(lab ? 'Pathlab updated' : 'Pathlab created');
      onClose();
    },
    onError: (e) => toast.error(e),
  });

  const valid =
    form.name.trim() && form.email.trim() && (lab || form.password.length >= 8);

  return (
    <Modal title={lab ? 'Edit pathlab' : 'Add pathlab'} onClose={onClose}>
      <Field label="Lab name">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label="Email">
        <input
          className="input"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </Field>
      <Field
        label={lab ? 'New password (leave blank to keep)' : 'Password'}
        error={!lab && form.password && form.password.length < 8 ? 'Password must be at least 8 characters.' : undefined}
      >
        <input
          className="input"
          type="password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <span className="hint">Must be at least 8 characters.</span>
      </Field>

      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
