import { useEffect, useState } from 'react';
import { api, fmtDateTime } from '../lib/api';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import { getUser } from '../lib/api';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [offices, setOffices] = useState([]);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const me = getUser();

  const load = async () => {
    try {
      const [u, r, o] = await Promise.all([api('/users'), api('/users/roles'), api('/offices')]);
      setUsers(u); setRoles(r); setOffices(o);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (modal.id) await api(`/users/${modal.id}`, { method: 'PUT', body: modal });
      else await api('/users', { method: 'POST', body: modal });
      toast(modal.id ? 'User updated' : 'User created');
      setModal(null); load();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const remove = async (u) => {
    if (!confirm(`Delete user "${u.name}"?`)) return;
    try { await api(`/users/${u.id}`, { method: 'DELETE' }); toast('User deleted'); load(); }
    catch (err) { toast(err.message, 'error'); }
  };

  const roleBadge = (r) => <span className={`badge ${r === 'admin' ? 'red' : r === 'manager' ? 'blue' : r === 'cashier' ? 'amber' : 'gray'}`}>{r}</span>;

  return (
    <div>
      <div className="page-header">
        <h1>Users & permissions</h1>
        <button className="btn primary" onClick={() => setModal({ name: '', email: '', password: '', role_id: roles.find((r) => r.name === 'cashier')?.id || 3 })}>+ Add user</button>
      </div>
      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Office</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.name}{u.id === me?.id && <span className="muted small"> (you)</span>}</td>
                <td>{u.email}</td>
                <td>{roleBadge(u.role)}</td>
                <td>{u.office ? <span className="badge blue">{u.office}</span> : <span className="muted">:</span>}</td>
                <td><span className={`badge ${u.status === 'active' ? 'amber' : 'gray'}`}>{u.status}</span></td>
                <td className="muted">{fmtDateTime(u.created_at)}</td>
                <td><div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn sm" onClick={() => setModal({ ...u, password: '' })}>Edit</button>
                  <button className="btn sm danger" onClick={() => remove(u)}>Del</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Edit user' : 'Add user'}>
        <form onSubmit={save}>
          <div className="field"><label>Name *</label><input required value={modal?.name || ''} onChange={(e) => setModal({ ...modal, name: e.target.value })} /></div>
          <div className="field"><label>Email *</label><input type="email" required value={modal?.email || ''} onChange={(e) => setModal({ ...modal, email: e.target.value })} /></div>
          <div className="field"><label>Role *</label>
            <select value={modal?.role_id || ''} onChange={(e) => setModal({ ...modal, role_id: +e.target.value })} required>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Office</label>
            <select value={modal?.office_id || ''} onChange={(e) => setModal({ ...modal, office_id: e.target.value ? +e.target.value : null })}>
              <option value="">No office</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="field"><label>{modal?.id ? 'New password (leave blank to keep)' : 'Password *'}</label>
            <input type="password" autoComplete="new-password" required={!modal?.id} minLength={modal?.id ? 0 : 8} value={modal?.password || ''} onChange={(e) => setModal({ ...modal, password: e.target.value })} />
            <p className="small muted" style={{ marginTop: 4 }}>8+ characters with letters and numbers.</p>
          </div>
          <div className="field"><label>Status</label>
            <select value={modal?.status || 'active'} onChange={(e) => setModal({ ...modal, status: e.target.value })}>
              <option value="active">Active</option><option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}