import { useEffect, useState } from 'react';
import { api, fmt } from '../lib/api';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    try { setSuppliers(await api('/suppliers')); } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (modal.id) await api(`/suppliers/${modal.id}`, { method: 'PUT', body: modal });
      else await api('/suppliers', { method: 'POST', body: modal });
      toast(modal.id ? 'Supplier updated' : 'Supplier added');
      setModal(null); load();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const remove = async (s) => {
    if (!confirm(`Delete supplier "${s.name}"?`)) return;
    try { await api(`/suppliers/${s.id}`, { method: 'DELETE' }); toast('Supplier deleted'); load(); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Suppliers</h1>
        <button className="btn primary" onClick={() => setModal({})}>+ Add supplier</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Tax number</th><th className="num">Balance</th><th></th></tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>{s.phone || ':'}</td>
                  <td>{s.email || ':'}</td>
                  <td className="muted">{s.tax_number || ':'}</td>
                  <td className="num" style={{ color: s.balance > 0 ? 'var(--danger)' : 'inherit' }}>{fmt(s.balance)}</td>
                  <td><div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn sm" onClick={() => setModal({ ...s })}>Edit</button>
                    <button className="btn sm danger" onClick={() => remove(s)}>Del</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Edit supplier' : 'Add supplier'}>
        <form onSubmit={save}>
          <div className="field"><label>Name *</label><input required value={modal?.name || ''} onChange={(e) => setModal({ ...modal, name: e.target.value })} /></div>
          <div className="form-row">
            <div className="field"><label>Phone</label><input value={modal?.phone || ''} onChange={(e) => setModal({ ...modal, phone: e.target.value })} /></div>
            <div className="field"><label>Email</label><input value={modal?.email || ''} onChange={(e) => setModal({ ...modal, email: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Tax number</label><input value={modal?.tax_number || ''} onChange={(e) => setModal({ ...modal, tax_number: e.target.value })} /></div>
          </div>
          <div className="field"><label>Address</label><input value={modal?.address || ''} onChange={(e) => setModal({ ...modal, address: e.target.value })} /></div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}