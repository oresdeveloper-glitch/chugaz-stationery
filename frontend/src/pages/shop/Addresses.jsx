import { useEffect, useState } from 'react';
import { shopApi } from '../../lib/api';
import RequireShopAuth from '../../shop/RequireShopAuth';
import { useToast } from '../../components/Toast';

function AddressesInner() {
  const [addresses, setAddresses] = useState([]);
  const [editing, setEditing] = useState(null);
  const toast = useToast();

  const load = async () => {
    try { setAddresses(await shopApi('/addresses')); } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    try {
      const body = { ...editing, is_default: !!editing.is_default };
      if (editing.id) await shopApi(`/addresses/${editing.id}`, { method: 'PUT', body });
      else await shopApi('/addresses', { method: 'POST', body });
      toast('Address saved');
      setEditing(null);
      load();
    } catch (err) { toast(err.message, 'error'); }
  };

  const remove = async (a) => {
    if (!confirm('Delete this address?')) return;
    await shopApi(`/addresses/${a.id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div style={{ maxWidth: 620 }}>
      <div className="page-header">
        <h1>Saved addresses</h1>
        <button className="btn primary" onClick={() => setEditing({ address_name: '', recipient_name: '', phone: '', address: '', city: '', postal_code: '', is_default: false })}>+ Add address</button>
      </div>

      {addresses.map((a) => (
        <div className="card" key={a.id} style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <b>{a.recipient_name}</b> {a.is_default && <span className="badge blue">default</span>}<br />
            <span className="muted small">{a.address_name} · {a.phone}<br />{a.address}, {a.city} {a.postal_code}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm" onClick={() => setEditing(a)}>Edit</button>
            <button className="btn sm danger" onClick={() => remove(a)}>Del</button>
          </div>
        </div>
      ))}
      {addresses.length === 0 && <div className="card muted">No saved addresses yet.</div>}

      {editing && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="modal">
            <h2>{editing.id ? 'Edit address' : 'Add address'}</h2>
            <form onSubmit={save}>
              <div className="form-row">
                <div className="field"><label>Label</label><input value={editing.address_name} onChange={(e) => setEditing({ ...editing, address_name: e.target.value })} placeholder="Home / Office" /></div>
                <div className="field"><label>Recipient name</label><input value={editing.recipient_name} onChange={(e) => setEditing({ ...editing, recipient_name: e.target.value })} /></div>
              </div>
              <div className="form-row">
                <div className="field"><label>Phone</label><input value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></div>
                <div className="field"><label>City *</label><input value={editing.city} onChange={(e) => setEditing({ ...editing, city: e.target.value })} required /></div>
              </div>
              <div className="field"><label>Street address *</label><input value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} required /></div>
              <div className="field"><label>Postal code</label><input value={editing.postal_code} onChange={(e) => setEditing({ ...editing, postal_code: e.target.value })} /></div>
              <div className="field"><label><input type="checkbox" checked={!!editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} /> Set as default</label></div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit" className="btn primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Addresses() {
  return <RequireShopAuth><AddressesInner /></RequireShopAuth>;
}