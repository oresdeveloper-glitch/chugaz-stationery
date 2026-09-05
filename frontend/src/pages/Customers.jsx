import { useEffect, useState } from 'react';
import { api, fmt, fmtDateTime, getUser } from '../lib/api';
import { canRole } from '../lib/roles';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';

export default function Customers() {
  const isAdmin = canRole(getUser(), 'admin');
  const [customers, setCustomers] = useState([]);
  const [modal, setModal] = useState(null);
  const [history, setHistory] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    try { setCustomers(await api('/customers')); } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (modal.id) await api(`/customers/${modal.id}`, { method: 'PUT', body: modal });
      else await api('/customers', { method: 'POST', body: modal });
      toast(modal.id ? 'Customer updated' : 'Customer added');
      setModal(null); load();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const openHistory = async (id) => {
    try { setHistory(await api(`/customers/${id}/history`)); } catch (e) { toast(e.message, 'error'); }
  };

  const remove = async (c) => {
    if (!confirm(`Delete customer "${c.name}"?`)) return;
    try { await api(`/customers/${c.id}`, { method: 'DELETE' }); toast('Customer deleted'); load(); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Customers</h1>
        <button className="btn primary" onClick={() => setModal({})}>+ Add customer</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th className="num">Credit limit</th><th className="num">Balance</th><th className="num">Discount %</th><th></th></tr></thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>{c.phone || ':'}</td>
                  <td>{c.email || ':'}</td>
                  <td className="num">{fmt(c.credit_limit)}</td>
                  <td className="num" style={{ color: c.balance > 0 ? 'var(--danger)' : 'inherit', fontWeight: 600 }}>{fmt(c.balance)}</td>
                  <td className="num">{c.discount_rate}%</td>
                  <td><div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn sm" onClick={() => openHistory(c.id)}>History</button>
                    {isAdmin && <button className="btn sm" onClick={() => setModal({ ...c })}>Edit</button>}
                    {isAdmin && <button className="btn sm danger" onClick={() => remove(c)}>Del</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.id ? 'Edit customer' : 'Add customer'}>
        <form onSubmit={save}>
          <div className="field"><label>Name *</label><input required value={modal?.name || ''} onChange={(e) => setModal({ ...modal, name: e.target.value })} /></div>
          <div className="form-row">
            <div className="field"><label>Phone</label><input value={modal?.phone || ''} onChange={(e) => setModal({ ...modal, phone: e.target.value })} /></div>
            <div className="field"><label>Email</label><input value={modal?.email || ''} onChange={(e) => setModal({ ...modal, email: e.target.value })} /></div>
          </div>
          <div className="field"><label>Address</label><input value={modal?.address || ''} onChange={(e) => setModal({ ...modal, address: e.target.value })} /></div>
          <div className="form-row">
            <div className="field"><label>Credit limit</label><input type="number" step="0.01" value={modal?.credit_limit ?? 0} onChange={(e) => setModal({ ...modal, credit_limit: +e.target.value })} /></div>
            <div className="field"><label>Default discount %</label><input type="number" step="0.01" value={modal?.discount_rate ?? 0} onChange={(e) => setModal({ ...modal, discount_rate: +e.target.value })} /></div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!history} onClose={() => setHistory(null)} title={`${history?.customer_name || 'Customer'} : history`} wide>
        {history && (
          <div>
            <div className="card-header"><h3>Sales</h3></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Invoice</th><th>Date</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th></tr></thead>
                <tbody>
                  {history.sales.length === 0 && <tr><td colSpan={5} className="muted">No sales</td></tr>}
                  {history.sales.map((s) => (
                    <tr key={s.id}><td>{s.invoice_number}</td><td className="muted">{fmtDateTime(s.sale_date)}</td><td className="num">{fmt(s.total)}</td><td className="num">{fmt(s.paid_amount)}</td><td><span className={`badge ${s.payment_status === 'paid' ? 'amber' : 'amber'}`}>{s.payment_status}</span></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-header" style={{ marginTop: 14 }}><h3>Payments</h3></div>
            {history.payments.map((p) => <div key={p.id} className="small">{fmtDateTime(p.payment_date)} : {fmt(p.amount)} ({p.payment_method})</div>)}
          </div>
        )}
      </Modal>
    </div>
  );
}