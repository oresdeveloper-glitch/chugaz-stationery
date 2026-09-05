import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmt, fmtDateTime, getUser } from '../lib/api';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';

export default function Sales() {
  const [sales, setSales] = useState([]);
  const [detail, setDetail] = useState(null);
  const [returning, setReturning] = useState(null);
  const [returnItems, setReturnItems] = useState({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [params, setParams] = useSearchParams();
  const statusFilter = params.get('status') || '';
  const toast = useToast();

  const load = async () => {
    try {
      // Cashiers/clerks only ever see their own sales, scoped explicitly to the logged-in user.
      const me = getUser();
      const isSeller = me && (me.role === 'cashier' || me.role === 'clerk');
      const scope = isSeller ? `created_by=${me.id}` : '';
      const q = [statusFilter ? `status=${encodeURIComponent(statusFilter)}` : '', scope].filter(Boolean).join('&');
      setSales(await api(`/sales${q ? '?' + q : ''}`));
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const openDetail = async (id) => {
    try { setDetail(await api(`/sales/${id}`)); } catch (e) { toast(e.message, 'error'); }
  };

  const openReturn = (s) => {
    const initial = {};
    s.items.forEach((i) => { initial[i.id] = 0; });
    setReturnItems(initial);
    setReturning(s);
  };

  const doReturn = async () => {
    const items = Object.entries(returnItems).filter(([, q]) => q > 0).map(([sale_item_id, quantity]) => ({ sale_item_id: Number(sale_item_id), quantity }));
    if (items.length === 0) return toast('Select at least one item and quantity', 'error');
    setSaving(true);
    try {
      await api(`/sales/${returning.id}/return`, { method: 'POST', body: { items, reason } });
      toast('Return recorded, stock restored');
      setReturning(null); setReason('');
      load();
      if (detail) openDetail(detail.id);
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const paymentBadge = (s) => <span className={`badge ${s.payment_status === 'paid' ? 'amber' : s.payment_status === 'partial' ? 'amber' : 'red'}`}>{s.payment_status}</span>;

  return (
    <div>
      <div className="page-header">
        <h1>Sales history</h1>
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
            <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th className="num">Items</th><th className="num">Total</th><th className="num">Paid</th><th>Method</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.invoice_number}</td>
                  <td className="muted">{fmtDateTime(s.sale_date)}</td>
                  <td>{s.customer_name || 'Walk-in'}</td>
                  <td className="num">{s.items ? s.items : <span className="muted">…</span>}</td>
                  <td className="num">{fmt(s.total)}</td>
                  <td className="num">{fmt(s.paid_amount)}</td>
                  <td className="muted">{s.payment_method}</td>
                  <td>{paymentBadge(s)}</td>
                  <td><div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn sm" onClick={() => openDetail(s.id)}>View</button>
                    <button className="btn sm" onClick={() => openReturn({ ...s })}>Return</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={`Sale ${detail?.invoice_number || ''}`} wide>
        {detail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div><b>Customer:</b> {detail.customer_name || 'Walk-in'}</div>
                <div><b>Date:</b> {fmtDateTime(detail.sale_date)}</div>
                <div><b>Status:</b> {paymentBadge(detail)}</div>
              </div>
              <div className="num">
                <div>Total: <b>{fmt(detail.total)}</b></div>
                <div className="muted small">Subtotal {fmt(detail.subtotal)} · Disc {fmt(detail.discount)} · Tax {fmt(detail.tax)}</div>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {detail.items.map((i) => (
                    <tr key={i.id}><td>{i.product_name}</td><td className="num">{fmt(i.quantity)}</td><td className="num">{fmt(i.unit_price)}</td><td className="num">{fmt(i.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.returns.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <h2>Returns on this sale</h2>
                {detail.returns.map((r) => (
                  <div key={r.id} className="small"><b>{fmtDateTime(r.return_date)}</b> refund {fmt(r.refund_amount)} : {r.reason || 'no reason'} (by {r.created_by_name})</div>
                ))}
              </div>
            )}
            {detail.payments.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <h2>Payments</h2>
                {detail.payments.map((p) => (
                  <div key={p.id} className="small">{fmtDateTime(p.payment_date)} : {fmt(p.amount)} ({p.payment_method}) {p.notes}</div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => openReturn({ ...detail })}>Record return</button>
              <button className="btn primary" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!returning} onClose={() => setReturning(null)} title={`Return items : ${returning?.invoice_number || ''}`}>
        {returning && (
          <div>
            {returning.items.map((i) => (
              <div key={i.id} className="cart-line">
                <span className="name">{i.product_name}<div className="muted small">Original qty {fmt(i.quantity)} · {fmt(i.unit_price)}</div></span>
                <input className="qty-input" type="number" min="0" max={i.quantity} value={returnItems[i.id] ?? 0}
                  onChange={(e) => setReturnItems({ ...returnItems, [i.id]: Math.min(Math.max(0, +e.target.value), i.quantity) })} />
              </div>
            ))}
            <div className="field" style={{ marginTop: 12 }}><label>Reason</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="damaged / wrong item / customer changed mind" /></div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setReturning(null)}>Cancel</button>
              <button className="btn danger" disabled={saving} onClick={doReturn}>{saving ? 'Processing...' : 'Record return & restore stock'}</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}