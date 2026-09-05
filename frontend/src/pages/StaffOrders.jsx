import { useEffect, useState } from 'react';
import { api, fmt, fmtDateTime, getUser } from '../lib/api';
import { canRole } from '../lib/roles';
import { useToast } from '../components/Toast';
import I from '../components/icons';

const STATUSES = ['pending', 'confirmed', 'processing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'cancelled', 'rejected', 'returned', 'refunded'];
const FLOW = ['pending', 'confirmed', 'processing', 'ready_for_pickup', 'out_for_delivery', 'completed'];
const LABEL = (s) => String(s || '').replace(/_/g, ' ');
const COLOR = (s) => ({ pending: 'amber', verifying: 'amber', confirmed: 'amber', processing: 'amber', ready_for_pickup: 'amber', out_for_delivery: 'amber', completed: 'amber', cancelled: 'red', rejected: 'red', returned: 'gray', refunded: 'gray' }[s] || 'gray');

export default function StaffOrders() {
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState({});
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [refundAmt, setRefundAmt] = useState('');
  const [retAmt, setRetAmt] = useState('');
  const toast = useToast();
  const me = getUser();
  const isAdminView = canRole(me, 'manager');

  const load = async () => {
    const query = new URLSearchParams();
    if (filter !== 'all') query.set('status', filter);
    if (q) query.set('q', q);
    try {
      setOrders(await api(`/orders?${query.toString()}`));
      setStats(await api('/orders/stats'));
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, [filter]);

  const refreshSelected = async () => {
    if (selected) setSelected(await api(`/orders/${selected.id}`));
    load();
  };

  const setStatus = async (status) => {
    try {
      const updated = await api(`/orders/${selected.id}/status`, { method: 'PUT', body: { status } });
      setSelected(updated);
      toast(`Order ${LABEL(status)}`);
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const reject = async () => {
    try {
      const updated = await api(`/orders/${selected.id}/reject`, { method: 'POST', body: { reason: rejectReason } });
      setSelected(updated); setRejectReason('');
      toast('Order rejected, stock released');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const refund = async () => {
    try {
      const updated = await api(`/orders/${selected.id}/refund`, { method: 'POST', body: { amount: refundAmt } });
      setSelected(updated); setRefundAmt('');
      toast('Refund recorded');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const approveReturn = async (ret) => {
    const amt = prompt('Refund amount for this return:', ret.refund_amount || selected.total);
    if (amt === null) return;
    try {
      const updated = await api(`/orders/${selected.id}/returns/${ret.id}/approve`, { method: 'POST', body: { refund_amount: amt } });
      setSelected(updated);
      toast('Return approved, stock restored');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const verifyPayment = async () => {
    try {
      const updated = await api(`/orders/${selected.id}/verify-payment`, { method: 'POST' });
      setSelected(updated);
      toast('Payment verified and marked as paid');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const tabs = [
    ['all', `All (${Object.values(stats).reduce((a, b) => a + b, 0)})`],
    ['pending', `Pending (${stats.pending || 0})`],
    ['confirmed', `Confirmed (${stats.confirmed || 0})`],
    ['processing', `Processing (${stats.processing || 0})`],
    ['ready_for_pickup', `Ready (${stats.ready_for_pickup || 0})`],
    ['out_for_delivery', `Out for delivery (${stats.out_for_delivery || 0})`],
    ['completed', `Completed (${stats.completed || 0})`],
    ['unpaid', `Unpaid (${stats.unpaid || 0})`],
    ['cancelled', `Cancelled (${stats.cancelled || 0})`],
    ['rejected', `Rejected (${stats.rejected || 0})`],
    ['returned', `Returns (${stats.returned || 0})`],
  ];

  const print = async () => {
    let shop = {};
    try { shop = await (await fetch('/api/shop/info')).json(); } catch {}
    const cur = 'TSh';
    const rows = (selected.items || [])
      .map((i, ix) => `<tr><td style="text-align:center;color:#666">${ix + 1}</td><td>${i.product_name}</td><td style="text-align:right">${fmt(i.quantity)}${i.unit ? ` ${i.unit}` : ''}</td><td style="text-align:right">${fmt(i.unit_price)}</td><td style="text-align:right"><b>${fmt(i.total)}</b></td></tr>`)
      .join('');
    const historyRows = (selected.history || []).map(h => `<tr><td style="font-size:11px">${fmtDateTime(h.created_at)}</td><td style="text-transform:capitalize">${String(h.action||'status_change').replace(/_/g,' ')} </td><td>${h.from_status||'—'} → ${h.to_status||'—'}</td><td>${h.changed_by_name||'System'} <span style="color:#666">(${h.changed_by_role||'—'}${h.office_name? ' · '+h.office_name : ''})</span></td></tr>`).join('');
    const historySection = historyRows ? `<div style="margin-top:18px"><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px;color:#0a4a6b">Handler trail — who verified / confirmed / processed</div><table class="items"><thead><tr><th>Time</th><th>Action</th><th>Status</th><th>By (Role · Office)</th></tr></thead><tbody>${historyRows}</tbody></table></div>` : '';
    const payHtml = `<div class="pay">
          <div class="pay-title">Jinsi ya kufanya malipo — Lipa kwa simu</div>
          <div class="pay-lipa">Lipa Namba ya Vodacom (M-Pesa): <span class="num">\${(shop.payment_instructions || shop.shop_phone || '— Uliza dukani')}</span> <span style="margin-left:8px;color:#666">Malipo yote yanaenda Vodacom M-Pesa</span></div>
          <div class="pay-grid">
            <div class="pay-card"><h4>1. Vodacom — M-Pesa</h4><div>Piga: <span class="ussd">*150*00#</span></div><ol><li>Chagua 4 — Lipa kwa M-Pesa</li><li>Chagua Lipa Namba</li><li>Weka Lipa Namba ya Vodacom</li><li>Weka kiasi: <b>\${fmt(selected.total)} ${cur}</b></li><li>Hakikisha taarifa za mpokeaji ni sahihi</li><li>Weka PIN ya M-Pesa</li><li>Thibitisha malipo</li></ol></div>
            <div class="pay-card"><h4>2. Yas — Mixx by Yas</h4><div>Piga: <span class="ussd">*150*01#</span></div><ol><li>Chagua Lipa kwa Simu</li><li>Chagua mitandao mingine</li><li>Chagua M-Pesa</li><li>Weka Lipa Namba ya Vodacom</li><li>Weka kiasi: <b>\${fmt(selected.total)} ${cur}</b></li><li>Hakikisha jina la biashara</li><li>Weka PIN ya Mixx</li><li>Thibitisha</li></ol></div>
            <div class="pay-card"><h4>3. Airtel — Airtel Money</h4><div>Piga: <span class="ussd">*150*60#</span></div><ol><li>Chagua 5 — Lipa Bili</li><li>Chagua Lipa kwa Simu — Mitandao yote</li><li>Chagua M-Pesa</li><li>Weka Lipa Namba ya Vodacom</li><li>Weka kiasi: <b>\${fmt(selected.total)} ${cur}</b></li><li>Hakikisha taarifa za mfanyabiashara</li><li>Weka PIN ya Airtel Money</li><li>Thibitisha</li></ol></div>
            <div class="pay-card"><h4>4. Halotel — HaloPesa</h4><div>Piga: <span class="ussd">*150*88#</span></div><ol><li>Chagua Lipa</li><li>Chagua Lipa kwa Simu</li><li>Chagua M-Pesa</li><li>Weka Lipa Namba ya Vodacom</li><li>Weka kiasi: <b>\${fmt(selected.total)} ${cur}</b></li><li>Hakikisha jina la M-Pesa</li><li>Weka PIN ya HaloPesa</li><li>Thibitisha</li></ol></div>
          </div>
        </div>`;
    const paySection = selected.order_status === 'pending' ? payHtml : '';
    const w = window.open('', '_blank');
    w.document.write(`<!doctype html><html><head><title>${selected.order_number}</title>    <style>
      @page { size: A4 portrait; margin: 14mm 12mm 18mm 12mm; @bottom-right { content: "Page " counter(page); font-size: 7.5px; color: #5a7286; } }
      * { box-sizing: border-box; }
      body { font-family: inherit; color: #17191c; padding: 0 0 30px; margin: 0; }
      .band { height: 6px; background: #0e6ea8; }
      .wrap { padding: 26px 34px 0; }
      .head { display: flex; justify-content: space-between; align-items: flex-start; }
      .brand { display: flex; gap: 14px; align-items: center; }
      .brand img { width: 58px; height: 58px; object-fit: contain; border-radius: 8px; }
      .brand .nm { font-size: 19px; font-weight: 700; color: #0a4a6b; }
      .brand .mt { font-size: 11px; color: #666; line-height: 1.5; margin-top: 2px; }
      .doc { text-align: right; }
      .doc .t { font-size: 23px; font-weight: 700; letter-spacing: .12em; color: #0e6ea8; }
      .doc .n { font-size: 11.5px; color: #555; margin-top: 6px; }
      .chip { display: inline-block; padding: 3px 12px; border-radius: 6px; font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; background: #e0eef7; color: #0e6ea8; margin-top: 8px; }
      hr { border: none; border-top: 2px solid #0e6ea8; margin: 18px 0 0; }
      .meta { display: flex; justify-content: space-between; gap: 22px; padding: 13px 0 16px; font-size: 12.5px; line-height: 1.6; }
      .lbl { font-size: 9.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #999; margin-bottom: 4px; }
      table.items { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      table.items th { text-align: left; font-size: 10px; letter-spacing: .11em; text-transform: uppercase; color: #fff; background: #0e6ea8; padding: 8px 10px; }
      table.items td { padding: 9px 10px; border-bottom: 1px solid #b9d6ea; vertical-align: top; }
      table.items tr:nth-child(even) td { background: #eef6fb; }
      .totals { display: flex; justify-content: flex-end; margin-top: 8px; }
      .box { min-width: 270px; font-size: 12.5px; background: #eef6fb; border: 1px solid #b9d6ea; border-radius: 8px; padding: 10px 14px 12px; }
      .row { display: flex; justify-content: space-between; padding: 3.5px 0; color: #3c4045; }
      .grand { display: flex; justify-content: space-between; margin-top: 8px; padding-top: 9px; border-top: 2px solid #0e6ea8; border-left: 3px solid #0e6ea8; font-weight: 700; font-size: 15px; }
      .pay { margin-top: 20px; border: 1px solid #b9d6ea; border-radius: 6px; overflow: hidden; }
      .pay-title { background: #0e6ea8; color: #fff; padding: 8px 14px; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; text-align: center; }
      .pay-lipa { background: #eef6fb; border-bottom: 1px solid #b9d6ea; padding: 8px 14px; text-align: center; font-size: 12px; }
      .pay-lipa b { color: #0a4a6b; }
      .pay-lipa .num { display:inline-block; background:#fff; border:1px solid #b9d6ea; padding:2px 10px; border-radius:6px; font-weight:700; color:#0e6ea8; margin-left:6px; }
      .pay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
      .pay-card { padding: 10px 12px; border-right: 1px solid #d0e6f5; border-bottom: 1px solid #d0e6f5; font-size: 11px; line-height: 1.55; }
      .pay-card:nth-child(2n) { border-right: none; }
      .pay-card:nth-last-child(-n+2) { border-bottom: none; }
      .pay-card h4 { margin: 0 0 5px; font-size: 11.5px; font-weight: 700; color: #0a4a6b; }
      .pay-card .ussd { display:inline-block; font-family: monospace; background:#fff; border:1px solid #b9d6ea; padding:1px 6px; border-radius:4px; font-weight:700; color:#0e6ea8; }
      .pay-card ol { margin: 6px 0 0; padding-left: 16px; }
      .pay-card li { margin: 1.5px 0; }
      .foot { margin-top: 22px; text-align: center; color: #666; font-size: 11px; line-height: 1.7; }
      .foot b { color: #0e6ea8; }
      .print-footer { display: none; }
      @media print {
        @page { size: A4 portrait; margin: 14mm 12mm 18mm 12mm; @bottom-right { content: "Page " counter(page); font-size: 7.5px; color: #5a7286; } }
        .band { background: #0e6ea8 !important; }
        table.items th { background: #0e6ea8 !important; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .print-footer {
          display: flex !important;
          position: fixed !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
          justify-content: space-between !important;
          align-items: center !important;
          font-size: 8.5px !important;
          color: #5a7286 !important;
          padding: 6px 0 !important;
          border-top: 1px solid #b9d6ea !important;
          background: #fff !important;
        }
        .print-footer .page-num::after { content: ""; }
        .wrap { padding-bottom: 10mm !important; }
        table.items { page-break-inside: auto !important; }
        tr { page-break-inside: avoid !important; }
      }
    </style></head><body>
      <div class="band"></div>
      <div class="wrap">
        <div class="head">
          <div class="brand">
            <img src="${location.origin}/logo-doc.png?v=3" />
            <div>
              <div class="nm">${shop.shop_name || ''}</div>
              <div class="mt">${shop.shop_address || ''}<br/>${shop.shop_phone || ''}${shop.shop_email ? ' · ' + shop.shop_email : ''}</div>
            </div>
          </div>
          <div class="doc">
            <div class="t">ORDER</div>
            <span class="chip">${LABEL(selected.order_status)}</span>
            <div class="n">No. ${selected.order_number}<br/>${fmtDateTime(selected.order_date)}</div>
          </div>
        </div>
        <hr/>
        <div class="meta">
          <div><div class="lbl">Customer</div><b>${selected.user_name}</b><br/>${selected.user_phone || selected.user_email || ''}</div>
          <div><div class="lbl">Deliver to</div>${selected.fulfillment_type === 'pickup' ? 'Pickup at shop' : `${selected.addr_recipient || ''}<br/>${selected.addr_address || ''}, ${selected.addr_city || ''}`}${selected.notes ? `<br/><i>Note: ${selected.notes}</i>` : ''}</div>
          <div style="text-align:right"><div class="lbl">Payment</div><span style="text-transform:capitalize">${String(selected.payment_method).replace(/_/g, ' ')}</span><br/>${selected.payment_status} · Paid ${fmt(selected.paid_amount)} ${cur}</div>
        </div>
        <table class="items">
          <thead><tr><th>#</th><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit price</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="totals"><div class="box">
          <div class="row"><span>Subtotal</span><span>${fmt(selected.subtotal)} ${cur}</span></div>
          <div class="row"><span>Tax</span><span>${fmt(selected.tax)} ${cur}</span></div>
          <div class="row"><span>Delivery</span><span>${Number(selected.delivery_fee) > 0 ? fmt(selected.delivery_fee) + ' ' + cur : 'Free'}</span></div>
          <div class="grand"><span>TOTAL</span><span>${fmt(selected.total)} ${cur}</span></div>
        </div></div>
        ${paySection}
        ${historySection}
        <div class="foot"><b>${shop.shop_name || ''}</b> · ${shop.shop_phone || ''}<br/>This document was generated automatically : no signature required.</div>
        <div class="print-footer"><span>Designed by CHUGAZ ICT SERVICES</span><span class="page-num"></span></div>
      </div>
    </body></html>`);
    w.document.close();
    w.print();
  };

  return (
    <div>
      <div className="page-header">
        <h1>Customer orders</h1>
      </div>

      <div className="toolbar">
        <div className="filters">
          {tabs.map(([k, label]) => (
            <button key={k} className={`btn ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
        <div className="spacer" />
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="search-input" placeholder="Search order #, customer..." value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <button className="btn" onClick={load}>Search</button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th className="num">Items</th><th className="num">Total</th><th>Status</th><th>Payment</th><th className="num">Return req</th>{isAdminView && <th>Last handled by</th>}<th></th></tr></thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan={isAdminView ? 9 : 8} className="muted" style={{ textAlign: 'center' }}>No orders.</td></tr>}
              {orders.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{o.order_number}</td>
                  <td>{o.user_name}<div className="muted small">{o.fulfillment_type}</div></td>
                  <td className="num">{o.items}</td>
                  <td className="num">{fmt(o.total)}</td>
                  <td><span className={`badge ${COLOR(o.order_status)}`}>{LABEL(o.order_status)}</span></td>
                  <td><span className={`badge ${o.payment_status === 'paid' ? 'amber' : o.payment_status === 'refunded' || o.payment_status === 'partial_refund' ? 'gray' : 'red'}`}>{o.payment_status}</span></td>
                  <td className="num">{o.return_requests > 0 ? <span className="badge red">{o.return_requests}</span> : ':'}</td>
                  {isAdminView && <td className="muted small" style={{maxWidth:160, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}} title={o.last_handler || '—'}>{o.last_handler || <span className="muted">—</span>}</td>}
                  <td><button className="btn sm" onClick={async () => {
                    try {
                      const full = await api(`/orders/${o.id}`);
                      setSelected(full);
                      setRefundAmt(full.total);
                      setRetAmt(full.total);
                    } catch (e) { toast(e.message, 'error'); }
                  }}>Manage</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSelected(null)}>
          <div className="modal" style={{ maxWidth: 760, maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header">
                <div>
                  <h3>Order {selected.order_number}</h3>
                  <div className="muted small">{fmtDateTime(selected.order_date)} · {selected.user_name} ({selected.user_email}) · phone {selected.user_phone || ':'}</div>
                </div>
                <button className="btn sm" onClick={print}><I name="printer" size={14} /> Print</button>
              </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className={`badge ${COLOR(selected.order_status)}`}>{LABEL(selected.order_status)}</span>
              <span className={`badge ${selected.payment_status === 'paid' ? 'amber' : selected.payment_status === 'verifying' ? 'amber' : 'red'}`}>{String(selected.payment_status).replace(/_/g, ' ')}</span>
              <span className="badge gray">{selected.fulfillment_type}</span>
              <span className="badge gray">{selected.payment_method.replace(/_/g, ' ')}</span>
              <span className="badge amber">Paid {fmt(selected.paid_amount)}</span>
            </div>

            {selected.order_status === 'pending' && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={() => setStatus('confirmed')}><I name="check" size={14} /> Confirm (deduct stock)</button>
                <button className="btn danger" onClick={reject}><I name="x" size={14} /> Reject</button>
                <input placeholder="Reject reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
              </div>
            )}
            {selected.order_status !== 'pending' && FLOW.includes(selected.order_status) && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <b className="small">Advance status:</b>
                {FLOW.map((s, i) => (
                  <button key={s} className="btn sm" disabled={i <= FLOW.indexOf(selected.order_status) || selected.order_status !== FLOW[i - 1]} onClick={() => setStatus(s)}>
                    {LABEL(s)}
                  </button>
                ))}
              </div>
            )}
            {selected.order_status === 'pending' && selected.payment_status === 'paid' && (
              <p className="small amber-bg" style={{ padding: 8, borderRadius: 6 }}>This order is already paid online : only reject it if you cannot fulfill it.</p>
            )}
            {(selected.payment_status === 'paid' || selected.payment_status === 'partial_refund') && ['cancelled', 'rejected'].includes(selected.order_status) && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                <b className="small">Refund:</b>
                <input type="number" value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} style={{ width: 120 }} />
                <button className="btn" onClick={refund}>Record refund</button>
              </div>
            )}

            <div className="grid grid-2" style={{ gap: 12 }}>
              <div className="card">
                <h3 className="small">Items</h3>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Amt</th></tr></thead>
                    <tbody>
                      {(selected.items || []).map((i) => (
                        <tr key={i.id}><td>{i.product_name}</td><td className="num">{fmt(i.quantity)} {i.unit || ''}</td><td className="num">{fmt(i.total)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="small" style={{ textAlign: 'right', marginTop: 6, lineHeight: 1.7 }}>
                  Subtotal {fmt(selected.subtotal)} · Tax {fmt(selected.tax)} · Delivery {fmt(selected.delivery_fee)}<br />
                  <b>Total {fmt(selected.total)}</b>
                </div>
              </div>
              <div>
                <div className="card" style={{ marginBottom: 12 }}>
                  <h3 className="small">Shipping</h3>
                  <div className="small muted">
                    {selected.fulfillment_type === 'pickup' ? 'Pickup at shop' : (
                      <>
                        {selected.addr_recipient} · {selected.addr_phone}<br />
                        {selected.addr_address}, {selected.addr_city}
                      </>
                    )}
                    {selected.notes && <><br />Notes: {selected.notes}</>}
                  </div>
                </div>
                <div className="card">
                  <h3 className="small">Payments</h3>
                  {(selected.payments || []).length === 0 && <div className="muted small">None</div>}
                  {(selected.payments || []).map((p) => (
                    <div key={p.id} className="small" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', padding: '4px 0', gap: 8 }}>
                      <span style={{ minWidth: 0 }}>
                        {p.payment_method} {p.transaction_reference && `· ${p.transaction_reference}`}
                        {p.payment_status === 'pending' && <span className="badge amber" style={{ marginLeft: 6 }}>awaiting verification</span>}
                      </span>
                      <b style={{ flexShrink: 0 }}>{fmt(p.amount)}</b>
                    </div>
                  ))}
                  {selected.payment_status === 'verifying' && (
                    <button className="btn primary sm" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} onClick={verifyPayment}>
                      <I name="check" size={14} /> Verify payment received
                    </button>
                  )}
                  {selected.payment_method === 'cash_on_delivery' && selected.payment_status !== 'paid' && !['cancelled','rejected','refunded'].includes(selected.order_status) && (
                    <button className="btn primary sm" style={{ marginTop: 8, width: '100%', justifyContent: 'center', background: '#0e6ea8', borderColor: '#0e6ea8' }} onClick={verifyPayment}>
                      <I name="check" size={14} /> Confirm cash received — COD
                    </button>
                  )}
                  {selected.payment_status !== 'paid' && selected.payment_status !== 'verifying' && selected.payment_method !== 'cash_on_delivery' && (
                    <div className="muted small" style={{ marginTop: 6 }}>
                      Outstanding: <b style={{ color: 'var(--danger)' }}>{fmt(Math.max(selected.total - (selected.paid_amount || 0), 0))}</b>
                    </div>
                  )}
                  {selected.payment_method === 'cash_on_delivery' && selected.payment_status === 'unpaid' && (
                    <div className="muted small" style={{ marginTop: 6 }}>
                      COD — cash to collect: <b style={{ color: '#0e6ea8' }}>{fmt(selected.total)}</b> at {selected.fulfillment_type === 'pickup' ? 'pickup' : 'delivery'}
                    </div>
                  )}
                </div>
                {(selected.returns || []).length > 0 && (
                  <div className="card" style={{ marginTop: 12 }}>
                    <h3 className="small">Returns</h3>
                    {(selected.returns || []).map((r) => (
                      <div key={r.id} className="small" style={{ marginBottom: 6 }}>
                        <span className={`badge ${r.status === 'requested' ? 'amber' : 'blue'}`}>{r.status}</span> {r.reason || ':'}
                        {r.status === 'requested' && <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => approveReturn(r)}>Approve</button>}
                      </div>
                    ))}
                  </div>
                )}
                {(selected.history || []).length > 0 && (
                  <div className="card" style={{ marginTop: 12, border: '1px solid var(--border)' }}>
                    <h3 className="small">Handler trail</h3>
                    <div className="muted small" style={{marginBottom:8}}>Who confirmed / verified / processed this order — office A/B or Admin</div>
                    <div>
                      {(selected.history || []).map((h) => (
                        <div key={h.id} style={{ display:'flex', justifyContent:'space-between', gap:8, padding:'7px 0', borderBottom:'1px solid var(--border)', fontSize:12.5 }}>
                          <div style={{minWidth:0}}>
                            <span style={{fontWeight:700, textTransform:'capitalize'}}>{String(h.action||'status_change').replace(/_/g,' ')}</span>
                            {h.from_status || h.to_status ? <span className="muted"> — {h.from_status || '—'} → {h.to_status || '—'}</span> : null}
                            <div className="muted small" style={{marginTop:2}}>
                              by <b style={{color:'var(--text)'}}>{h.changed_by_name || 'System'}</b> <span className="badge gray" style={{marginLeft:4}}>{h.changed_by_role || '—'}</span>
                              {h.office_name ? <span className="badge amber" style={{marginLeft:4}}>{h.office_name}</span> : (h.office_id ? <span className="badge amber" style={{marginLeft:4}}>Office {h.office_id}</span> : <span className="badge gray" style={{marginLeft:4}}>HQ / Admin</span>)}
                              {h.notes ? <span> · {h.notes}</span> : null}
                            </div>
                          </div>
                          <span className="muted small" style={{whiteSpace:'nowrap', flexShrink:0}}>{fmtDateTime(h.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}