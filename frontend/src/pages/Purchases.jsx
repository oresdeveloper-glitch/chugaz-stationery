import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmt, fmtDateTime } from '../lib/api';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';

export default function Purchases() {
  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);
  const [payModal, setPayModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [params, setParams] = useSearchParams();
  const statusFilter = params.get('status') || '';
  const toast = useToast();

  const [form, setForm] = useState({ supplier_id: '', invoice_number: '', purchase_date: new Date().toISOString().slice(0, 16), items: [{ product_id: '', quantity: 1, unit_cost: 0 }], paid_amount: 0, payment_method: 'cash', discount: 0, notes: '' });

  const load = async () => {
    try {
      const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const [p, s, pr] = await Promise.all([api(`/purchases${q}`), api('/suppliers'), api('/products')]);
      setPurchases(p); setSuppliers(s); setProducts(pr.filter((x) => x.status === 'active'));
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const openDetail = async (id) => {
    try { setDetail(await api(`/purchases/${id}`)); } catch (e) { toast(e.message, 'error'); }
  };

  const lineCost = (it) => (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0);
  const formSubtotal = form.items.reduce((s, it) => s + lineCost(it), 0);
  const formTotal = Math.max(formSubtotal - (Number(form.discount) || 0), 0);

  const savePurchase = async () => {
    const items = form.items.filter((i) => i.product_id).map((i) => ({ product_id: Number(i.product_id), quantity: Number(i.quantity), unit_cost: Number(i.unit_cost) }));
    if (items.length === 0) return toast('Add at least one product', 'error');
    setSaving(true);
    try {
      await api('/purchases', { method: 'POST', body: { ...form, supplier_id: form.supplier_id || null, items, paid_amount: Number(form.paid_amount) || 0 } });
      toast('Purchase recorded, stock increased');
      setCreating(false);
      setForm({ supplier_id: '', invoice_number: '', purchase_date: new Date().toISOString().slice(0, 16), items: [{ product_id: '', quantity: 1, unit_cost: 0 }], paid_amount: 0, payment_method: 'cash', discount: 0, notes: '' });
      load();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const savePayment = async () => {
    setSaving(true);
    try {
      await api(`/purchases/${payModal.id}/payment`, { method: 'POST', body: { amount: Number(payModal.amount), method: payModal.method, notes: payModal.notes } });
      toast('Payment recorded');
      setPayModal(null);
      load();
      if (detail) openDetail(detail.id);
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const statusBadge = (s) => <span className={`badge ${s === 'paid' ? 'amber' : s === 'partial' ? 'amber' : 'red'}`}>{s}</span>;

  return (
    <div>
      <div className="page-header">
        <h1>Purchases</h1>
        <button className="btn primary" onClick={() => setCreating(true)}>+ New purchase</button>
      </div>

      <div className="toolbar">
        <div className="filters">
          {['outstanding', 'paid', 'partial', 'unpaid'].map((f) => (
            <button key={f} className={`btn ${statusFilter === f ? 'active' : ''}`} onClick={() => setParams(statusFilter === f ? {} : { status: f })}>{f}</button>
          ))}
          {statusFilter && <button className="btn" onClick={() => setParams({})}>x clear</button>}
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Date</th><th>Supplier</th><th>Invoice</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th><th>By</th><th></th></tr></thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.id}</td>
                  <td className="muted">{fmtDateTime(p.purchase_date)}</td>
                  <td>{p.supplier_name || ':'}</td>
                  <td className="muted">{p.invoice_number || ':'}</td>
                  <td className="num">{fmt(p.total)}</td>
                  <td className="num">{fmt(p.paid_amount)}</td>
                  <td>{statusBadge(p.payment_status)}</td>
                  <td className="muted">{p.created_by_name}</td>
                  <td><div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn sm" onClick={() => openDetail(p.id)}>View</button>
                    {p.payment_status !== 'paid' && <button className="btn sm" onClick={() => setPayModal({ id: p.id, amount: p.total - p.paid_amount, method: 'cash', notes: '', total: p.total, paid: p.paid_amount })}>Pay</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New purchase (stock-in)" wide>
        <div className="field"><label>Supplier</label>
          <select value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
            <option value="">No supplier (direct)</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="field"><label>Supplier invoice no.</label><input value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} /></div>
          <div className="field"><label>Date</label><input type="datetime-local" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></div>
        </div>
        <h2 style={{ marginTop: 6 }}>Items</h2>
        {form.items.map((it, idx) => (
          <div className="cart-line" key={idx}>
            <select style={{ flex: 1 }} value={it.product_id} onChange={(e) => {
              const p = products.find((x) => x.id == e.target.value);
              const next = [...form.items]; next[idx] = { ...it, product_id: e.target.value, unit_cost: p ? p.purchase_price : it.unit_cost }; setForm({ ...form, items: next });
            }}>
              <option value="">Select product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input style={{ width: 70 }} type="number" min="1" value={it.quantity} onChange={(e) => { const next = [...form.items]; next[idx] = { ...it, quantity: e.target.value }; setForm({ ...form, items: next }); }} />
            <input style={{ width: 90 }} type="number" step="0.01" value={it.unit_cost} onChange={(e) => { const next = [...form.items]; next[idx] = { ...it, unit_cost: e.target.value }; setForm({ ...form, items: next }); }} />
            <span className="num" style={{ width: 70 }}>{fmt(lineCost(it))}</span>
            <button className="btn sm danger" onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}>×</button>
          </div>
        ))}
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setForm({ ...form, items: [...form.items, { product_id: '', quantity: 1, unit_cost: 0 }] })}>+ Add line</button>

        <div className="sep" style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />
        <div className="form-row">
          <div className="field"><label>Discount</label><input type="number" min="0" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} /></div>
          <div className="field"><label>Total</label><input value={fmt(formTotal)} readOnly disabled /></div>
        </div>
        <div className="form-row">
          <div className="field"><label>Pay now</label><input type="number" min="0" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} /></div>
          <div className="field"><label>Payment method</label>
            <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              {['cash', 'card', 'bank_transfer', 'credit'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={() => setCreating(false)}>Cancel</button>
          <button className="btn primary" disabled={saving} onClick={savePurchase}>{saving ? 'Saving...' : 'Confirm purchase'}</button>
        </div>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Purchase #${detail?.id || ''}`} wide>
        {detail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div><b>Supplier:</b> {detail.supplier_name || 'Direct'}</div>
                <div><b>Date:</b> {fmtDateTime(detail.purchase_date)}</div>
                <div><b>Status:</b> {statusBadge(detail.payment_status)}</div>
              </div>
              <div className="num"><div>Total: <b>{fmt(detail.total)}</b></div><div className="muted small">Subtotal {fmt(detail.subtotal)} · Disc {fmt(detail.discount)} · Tax {fmt(detail.tax)}</div></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Cost</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {detail.items.map((i) => (
                    <tr key={i.id}><td>{i.product_name}</td><td className="num">{fmt(i.quantity)}</td><td className="num">{fmt(i.unit_cost)}</td><td className="num">{fmt(i.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.payments.length > 0 && (
              <div style={{ marginTop: 12 }}><h2>Payments</h2>
                {detail.payments.map((p) => <div key={p.id} className="small">{fmtDateTime(p.payment_date)} : {fmt(p.amount)} ({p.payment_method})</div>)}
              </div>
            )}
            <div className="modal-actions">
              {detail.payment_status !== 'paid' && <button className="btn" onClick={() => setPayModal({ id: detail.id, amount: detail.total - detail.paid_amount, method: 'cash', notes: '', total: detail.total, paid: detail.paid_amount })}>Record payment</button>}
              <button className="btn primary" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!payModal} onClose={() => setPayModal(null)} title="Record supplier payment">
        {payModal && (
          <div>
            <div className="field"><label>Remaining balance</label><input value={fmt(payModal.total - payModal.paid)} readOnly disabled /></div>
            <div className="field"><label>Amount</label><input type="number" step="0.01" min="0" value={payModal.amount} onChange={(e) => setPayModal({ ...payModal, amount: e.target.value })} /></div>
            <div className="field"><label>Method</label>
              <select value={payModal.method} onChange={(e) => setPayModal({ ...payModal, method: e.target.value })}>
                {['cash', 'card', 'bank_transfer'].map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="field"><label>Notes</label><input value={payModal.notes || ''} onChange={(e) => setPayModal({ ...payModal, notes: e.target.value })} /></div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setPayModal(null)}>Cancel</button>
              <button className="btn primary" disabled={saving} onClick={savePayment}>{saving ? 'Saving...' : 'Record payment'}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}