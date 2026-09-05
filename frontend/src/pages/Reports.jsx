import { useEffect, useRef, useState } from 'react';
import { api, fmt, fmtDate, getUser } from '../lib/api';
import { useToast } from '../components/Toast';
import { canRole } from '../lib/roles';

export default function Reports() {
  const isAdmin = canRole(getUser(), 'admin');
  const [tab, setTab] = useState('pnl');
  const [data, setData] = useState(null);
  const [range, setRange] = useState({ from: new Date(new Date().setDate(1)).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
  const toast = useToast();
  const seqRef = useRef(0);

  const [cashierDate, setCashierDate] = useState(new Date().toISOString().slice(0, 10));
  const [cashierId, setCashierId] = useState('');
  const [cashiersList, setCashiersList] = useState([]);
  const [receipt, setReceipt] = useState(null);

  const load = async () => {
    const seq = ++seqRef.current;
    setData(null);
    try {
      let res;
      if (tab === 'pnl') res = await api(`/reports/profit-loss?from=${range.from}&to=${range.to}`);
      else if (tab === 'sales') res = await api(`/reports/sales-summary?from=${range.from}&to=${range.to}`);
      else if (tab === 'best') res = await api(`/reports/best-sellers?from=${range.from}&to=${range.to}`);
      else if (tab === 'valuation') res = await api('/reports/inventory-valuation');
      else if (tab === 'suppliers') res = await api('/reports/supplier-balances');
      else if (tab === 'customers') res = await api('/reports/customer-credit');
      else if (tab === 'cashiers') res = await api('/reports/cashier-performance');
      else if (tab === 'cashierDaily') {
        const q = new URLSearchParams({ from: cashierDate, to: cashierDate });
        if (cashierId) q.set('cashier_id', cashierId);
        res = await api(`/reports/cashier-daily-detail?${q.toString()}`);
      }
      else if (tab === 'tax') res = await api(`/reports/tax?from=${range.from}&to=${range.to}`);
      else if (tab === 'audit') res = await api('/reports/audit?limit=300');
      if (seq === seqRef.current) setData(res);
    } catch (e) { if (seq === seqRef.current) toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, [tab, range.from, range.to, cashierDate, cashierId]);
  useEffect(() => {
    if (tab === 'cashierDaily' && cashiersList.length === 0) {
      api('/reports/cashier-performance').then((rows) => {
        // also fetch users for filter (cashiers list)
        api('/users').then((users) => {
          const cashiers = users.filter((u) => ['cashier','clerk','manager'].includes(u.role));
          setCashiersList(cashiers);
        }).catch(() => setCashiersList(rows.map((r,i)=>({id:i, name:r.name}))));
      }).catch(()=>{});
    }
  }, [tab]);

  const tabs = [
    ['pnl', 'Profit & Loss'], ['sales', 'Sales summary'], ['best', 'Best sellers'],
    ...(isAdmin ? [['valuation', 'Inventory value']] : []),
    ['suppliers', 'Supplier balances'], ['customers', 'Customer credit'],
    ['cashiers', 'Cashier performance'],
    ...(isAdmin ? [['cashierDaily', 'Cashier daily (detailed)']] : []),
    ['tax', 'Tax report'], ['audit', 'Audit log'],
  ];
  const isRange = ['pnl', 'sales', 'best', 'tax'].includes(tab);
  const tabLabel = (tabs.find(([t]) => t === tab) || ['', 'Report'])[1];
  const stamp = new Date().toLocaleString();
  const me = getUser();

  return (
    <div>
      <div className="doc-head">
        <img src="/logo-doc.png?v=2" alt="" />
        <div className="doc-head-meta">
          <h2>{tabLabel}</h2>
          <div className="muted small">
            {isRange ? `Period: ${range.from} to ${range.to} · ` : ''}
            Generated {stamp}{me?.name ? ` · Prepared by ${me.name}` : ''}
          </div>
        </div>
        <button className="btn primary no-print" style={{ marginLeft: 'auto' }} onClick={() => window.print()}>Print / Save PDF</button>
      </div>
      <div className="doc-rule" />

      <div className="page-header no-print">
        <h1>Reports</h1>
      </div>

      <div className="toolbar">
        <div className="filters">
          {tabs.map(([t, l]) => (
            <button key={t} className={`btn ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{l}</button>
          ))}
        </div>
        {isRange && (
          <>
            <div className="spacer" />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              <span className="muted">to</span>
              <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </div>
          </>
        )}
      </div>

      {tab === 'pnl' && data && (
        <>
          <div className="stats-grid cols-3 print-hide">
            <div className="card stat-card"><div className="label">Revenue</div><div className="value">{fmt(data.revenue)}</div><div className="sub">Sales total</div></div>
            <div className="card stat-card"><div className="label">Cost of goods sold</div><div className="value" style={{ color: 'var(--danger)' }}>{fmt(data.cost_of_goods)}</div><div className="sub">At purchase cost</div></div>
            <div className="card stat-card"><div className="label">Gross profit</div><div className="value" style={{ color: 'var(--primary)' }}>{fmt(data.gross_profit)}</div><div className="sub">Before expenses</div></div>
            <div className="card stat-card"><div className="label">Tax collected</div><div className="value">{fmt(data.tax_collected)}</div><div className="sub">Output VAT</div></div>
            <div className="card stat-card"><div className="label">Expenses</div><div className="value" style={{ color: 'var(--danger)' }}>{fmt(data.expenses)}</div><div className="sub">Operating costs</div></div>
            <div className="card stat-card"><div className="label">Net profit</div><div className="value" style={{ color: data.net_profit >= 0 ? 'var(--primary)' : 'var(--danger)' }}>{fmt(data.net_profit)}</div><div className="sub">{data.net_profit >= 0 ? 'Profitable' : 'Loss'}</div></div>
          </div>
          <div className="doc-ledger">
            <div className="doc-note">Profit &amp; Loss Statement · all amounts in TSh</div>
            <table className="ledger">
              <tbody>
                <tr><td>Sales revenue</td><td className="num">{fmt(data.revenue)}</td></tr>
                <tr><td>Less: Cost of goods sold</td><td className="num">({fmt(Math.abs(data.cost_of_goods))})</td></tr>
                <tr className="sub"><td>Gross profit</td><td className="num">{fmt(data.gross_profit)}</td></tr>
                <tr><td>Less: Operating expenses</td><td className="num">({fmt(Math.abs(data.expenses))})</td></tr>
                <tr className="net"><td>{data.net_profit >= 0 ? 'Net profit' : 'Net loss'}</td><td className="num">{fmt(data.net_profit)}</td></tr>
              </tbody>
            </table>
            <table className="ledger ledger-note">
              <tbody>
                <tr><td><i>Memorandum : output VAT collected on sales (not an expense):</i></td><td className="num"><i>{fmt(data.tax_collected)}</i></td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'sales' && Array.isArray(data) && (
        <div className="card">
          <div className="table-wrap"><table>
            <thead><tr><th>Period</th><th className="num">Sales</th><th className="num">Received</th><th className="num">Tax</th><th className="num">Transactions</th></tr></thead>
            <tbody>
              {data.map((d) => <tr key={d.period}><td>{d.period}</td><td className="num">{fmt(d.sales)}</td><td className="num">{fmt(d.received)}</td><td className="num">{fmt(d.tax)}</td><td className="num">{d.count}</td></tr>)}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === 'best' && Array.isArray(data) && (
        <div className="card">
          <div className="table-wrap"><table>
            <thead><tr><th>Product</th><th>SKU</th><th className="num">Qty sold</th><th className="num">Revenue</th></tr></thead>
            <tbody>
              {data.map((p) => <tr key={p.id}><td style={{ fontWeight: 600 }}>{p.name}</td><td className="muted">{p.sku}</td><td className="num">{fmt(p.qty)}</td><td className="num">{fmt(p.revenue)}</td></tr>)}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === 'valuation' && Array.isArray(data) && (
        <div className="card">
          <p className="muted">Current stock valued at purchase cost and retail price, by category.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Category</th><th className="num">Products</th><th className="num">Cost value</th><th className="num">Retail value</th></tr></thead>
            <tbody>
              {data.map((c) => <tr key={c.category || 'none'}><td>{c.category || 'Uncategorized'}</td><td className="num">{c.products}</td><td className="num">{fmt(c.cost_value)}</td><td className="num">{fmt(c.retail_value)}</td></tr>)}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === 'suppliers' && Array.isArray(data) && (
        <div className="card">
          <div className="table-wrap"><table>
            <thead><tr><th>Supplier</th><th>Phone</th><th className="num">Ledger balance</th><th className="num">Outstanding</th></tr></thead>
            <tbody>
              {data.map((s) => <tr key={s.id}><td style={{ fontWeight: 600 }}>{s.name}</td><td>{s.phone || ':'}</td><td className="num">{fmt(s.balance)}</td><td className="num" style={{ color: s.outstanding > 0 ? 'var(--danger)' : 'inherit', fontWeight: 600 }}>{fmt(s.outstanding)}</td></tr>)}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === 'customers' && Array.isArray(data) && (
        <div className="card">
          <div className="table-wrap"><table>
            <thead><tr><th>Customer</th><th>Phone</th><th className="num">Balance</th><th className="num">Credit limit</th><th className="num">Outstanding</th></tr></thead>
            <tbody>
              {data.map((c) => <tr key={c.id}><td style={{ fontWeight: 600 }}>{c.name}</td><td>{c.phone || ':'}</td><td className="num">{fmt(c.balance)}</td><td className="num">{fmt(c.credit_limit)}</td><td className="num" style={{ color: c.outstanding > 0 ? 'var(--danger)' : 'inherit', fontWeight: 600 }}>{fmt(c.outstanding)}</td></tr>)}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === 'cashiers' && Array.isArray(data) && (
        <div className="card">
          <div className="table-wrap"><table>
            <thead><tr><th>Cashier</th><th>Office</th><th className="num">Sales count</th><th className="num">Total sales</th></tr></thead>
            <tbody>
              {data.map((c, i) => <tr key={i}><td style={{ fontWeight: 600 }}>{c.name}</td><td>{c.office ? <span className="badge blue">{c.office}</span> : <span className="muted">:</span>}</td><td className="num">{c.sales_count}</td><td className="num">{fmt(c.total)}</td></tr>)}
            </tbody>
          </table></div>
        </div>
      )}

      {tab === 'cashierDaily' && (
        <>
          <div className="toolbar no-print" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="small muted" style={{ fontWeight: 700 }}>Date</label>
              <input type="date" value={cashierDate} onChange={(e) => setCashierDate(e.target.value)} />
              <label className="small muted" style={{ fontWeight: 700 }}>Cashier</label>
              <select value={cashierId} onChange={(e) => setCashierId(e.target.value)}>
                <option value="">All cashiers</option>
                {cashiersList.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role}){u.office ? ` · ${u.office}` : ''}</option>)}
              </select>
              {data?.range && <span className="muted small">Showing {data.range.from}{data.range.cashier_id ? ` · filtered` : ''}</span>}
              {!data?.summary && <span className="muted small">Loading…</span>}
            </div>
          </div>
          {!data?.summary ? <div className="card">Loading daily report…</div> : (<>

          <div className="stats-grid cols-3">
            <div className="card stat-card"><div className="label">Sales transactions</div><div className="value">{data.summary.sales_count}</div><div className="sub">Receipts issued</div></div>
            <div className="card stat-card"><div className="label">Items sold</div><div className="value">{fmt(data.summary.total_qty)}</div><div className="sub">Units in period</div></div>
            <div className="card stat-card"><div className="label">Revenue</div><div className="value">{fmt(data.summary.total_revenue)}</div><div className="sub">Gross sales</div></div>
            <div className="card stat-card"><div className="label">Total profit</div><div className="value" style={{ color: 'var(--primary)' }}>{fmt(data.summary.total_profit)}</div><div className="sub">Revenue − cost</div></div>
            <div className="card stat-card"><div className="label">Collected</div><div className="value">{fmt(data.summary.total_paid)}</div><div className="sub">Cash received</div></div>
            <div className="card stat-card"><div className="label">Outstanding</div><div className="value" style={{ color: data.summary.outstanding > 0 ? 'var(--danger)' : 'var(--primary)' }}>{fmt(data.summary.outstanding)}</div><div className="sub">{data.summary.outstanding > 0 ? 'Still to collect' : 'Fully paid'}</div></div>
          </div>

          {!cashierId && data.perCashier && data.perCashier.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <h3>Breakdown by cashier</h3>
              <div className="table-wrap"><table>
                <thead><tr><th>Cashier</th><th className="num">Receipts</th><th className="num">Items</th><th className="num">Revenue</th><th className="num">Profit</th></tr></thead>
                <tbody>
                  {data.perCashier.map((r) => <tr key={r.id}><td style={{ fontWeight: 600 }}>{r.name}{r.office && <span className="badge blue" style={{ marginLeft: 8 }}>{r.office}</span>}</td><td className="num">{r.sales_count}</td><td className="num">{fmt(r.qty)}</td><td className="num">{fmt(r.total)}</td><td className="num" style={{ color: 'var(--primary)' }}>{fmt(r.profit)}</td></tr>)}
                </tbody>
              </table></div>
            </div>
          )}

          <div className="card" style={{ marginTop: 14 }}>
            <h3>Products sold per day : detailed</h3>
            <div className="table-wrap"><table>
              <thead><tr><th>Product</th><th>Category</th><th>SKU</th><th className="num">Qty</th><th className="num">Revenue</th><th className="num">Cost</th><th className="num">Profit</th><th className="num">Receipts</th></tr></thead>
              <tbody>
                {data.perProduct.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 20 }}>No sales for this day / cashier.</td></tr>}
                {data.perProduct.map((p) => (
                  <tr key={p.id}><td style={{ fontWeight: 600 }}>{p.name}</td><td className="muted small">{p.category}</td><td className="muted small">{p.sku || ':'}</td><td className="num">{fmt(p.qty)}</td><td className="num">{fmt(p.revenue)}</td><td className="num">{fmt(p.cost)}</td><td className="num" style={{ color: 'var(--primary)' }}>{fmt(p.profit)}</td><td className="num">{p.transactions}</td></tr>
                ))}
              </tbody>
            </table></div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h3>Individual receipts ({data.sales.length})</h3>
            <div className="table-wrap"><table>
              <thead><tr><th>Invoice</th><th>Time</th><th>Customer</th><th>Cashier</th><th className="num">Items</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th><th>Receipt</th></tr></thead>
              <tbody>
                {data.sales.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.invoice_number}</td>
                    <td className="muted small">{new Date(s.sale_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{s.customer_name || 'Walk-in'}</td>
                    <td className="muted small">{s.cashier_name || ':'}{s.office && <span className="badge blue" style={{ marginLeft: 6 }}>{s.office}</span>}</td>
                    <td className="num">{s.items.length}</td>
                    <td className="num">{fmt(s.total)}</td>
                    <td className="num">{fmt(s.paid_amount)}</td>
                    <td><span className={`badge ${s.payment_status === 'paid' ? 'amber' : 'amber'}`}>{s.payment_status}</span></td>
                    <td><button className="btn sm primary" onClick={() => setReceipt(s)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="muted small" style={{ marginTop: 10 }}>
              Click <b>View</b> to open and print any receipt. The printed PDF also contains the full line-item ledger for all receipts.
            </div>
          </div>

          {receipt && (
            <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setReceipt(null)}>
              <div className="modal" style={{ maxWidth: 520 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>Receipt {receipt.invoice_number}</h3>
                  <button className="btn sm" onClick={() => setReceipt(null)}>x</button>
                </div>
                <div className="muted small" style={{ marginBottom: 10 }}>
                   {new Date(receipt.sale_date).toLocaleString()} · {receipt.customer_name || 'Walk-in'} · Cashier: {receipt.cashier_name || ':'}{receipt.office ? ` (${receipt.office})` : ''} · <span className={`badge ${receipt.payment_status === 'paid' ? 'amber' : 'amber'}`}>{receipt.payment_status}</span> · {receipt.payment_method}
                </div>
                <div className="table-wrap"><table>
                  <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Line total</th></tr></thead>
                  <tbody>
                    {receipt.items.map((it, i) => (
                      <tr key={i}><td>{it.name}</td><td className="num">{fmt(it.quantity)}</td><td className="num">{fmt(it.unit_price)}</td><td className="num">{fmt(it.total)}</td></tr>
                    ))}
                    <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border-strong)' }}><td colSpan={3} style={{ textAlign: 'right' }}>Total</td><td className="num">{fmt(receipt.total)}</td></tr>
                    <tr><td colSpan={3} style={{ textAlign: 'right' }} className="muted small">Paid ({receipt.payment_method})</td><td className="num">{fmt(receipt.paid_amount)}</td></tr>
                    {Number(receipt.paid_amount) > Number(receipt.total) && <tr><td colSpan={3} style={{ textAlign: 'right' }} className="muted small">Change</td><td className="num">{fmt(Number(receipt.paid_amount) - Number(receipt.total))}</td></tr>}
                  </tbody>
                </table></div>
                <div className="modal-actions" style={{ marginTop: 14 }}>
                  <button className="btn" onClick={() => setReceipt(null)}>Close</button>
                  <button className="btn primary" onClick={() => window.print()}>Print receipt</button>
                </div>
              </div>
            </div>
          )}

          {/* Print-only: full line items ledger */}
          <div className="doc-print" style={{ display: 'none' }}>
            <div className="doc-note">Cashier Daily Report · {data.range.from} · all amounts in TSh</div>
            {data.sales.map((s) => (
              <div key={s.id} style={{ marginBottom: 14, breakInside: 'avoid' }}>
                <div style={{ fontWeight: 700, fontSize: 12 }}>{s.invoice_number} · {new Date(s.sale_date).toLocaleString()} · {s.customer_name || 'Walk-in'} · {s.cashier_name || ''}</div>
                <table className="ledger" style={{ marginTop: 4 }}>
                  <tbody>
                    {s.items.map((it, i) => (
                      <tr key={i}><td>{it.name} <span className="muted small">({it.sku || ''})</span></td><td className="num">{fmt(it.quantity)} × {fmt(it.unit_price)}</td><td className="num">{fmt(it.total)}</td></tr>
                    ))}
                    <tr className="sub"><td colSpan={2} style={{ textAlign: 'right' }}>Sale total</td><td className="num">{fmt(s.total)}</td></tr>
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>)}
        </>
      )}

      {tab === 'tax' && data && (
        <>
          <div className="stats-grid cols-3 print-hide">
            <div className="card stat-card"><div className="label">Output tax (sales)</div><div className="value">{fmt(data.sales_tax)}</div></div>
            <div className="card stat-card"><div className="label">Input tax (purchases)</div><div className="value">{fmt(data.purchase_tax)}</div></div>
            <div className="card stat-card"><div className="label">Net payable</div><div className="value" style={{ color: 'var(--danger)' }}>{fmt(data.net_payable)}</div></div>
          </div>
          <div className="doc-ledger">
            <div className="doc-note">VAT Summary · all amounts in TSh</div>
            <table className="ledger">
              <tbody>
                <tr><td>Output tax charged on sales</td><td className="num">{fmt(data.sales_tax)}</td></tr>
                <tr><td>Less: Input tax paid on purchases</td><td className="num">({fmt(Math.abs(data.purchase_tax))})</td></tr>
                <tr className="net"><td>Net VAT payable to authority</td><td className="num">{fmt(data.net_payable)}</td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'audit' && Array.isArray(data) && (
        <div className="card">
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>User</th><th>Action</th><th>Entity</th><th className="num">ID</th><th>Details</th></tr></thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id}>
                  <td className="muted">{fmtDate(l.created_at)}</td>
                  <td>{l.user_name || ':'}</td>
                  <td><span className="badge blue">{l.action}</span></td>
                  <td>{l.entity}</td>
                  <td className="num">{l.entity_id ?? ':'}</td>
                  <td className="muted small">{l.details ? (() => { try { return JSON.stringify(JSON.parse(l.details)); } catch { return l.details; } })() : ''}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
      {data !== null && (
        <div className="doc-foot">
          <div className="doc-sign">
            <div><span>Prepared by</span></div>
            <div><span>Verified by</span></div>
            <div><span>Approved by</span></div>
          </div>
          <div className="muted small" style={{ textAlign: 'center', marginTop: 18 }}>
            End of report : generated by the point-of-sale system.
          </div>
        </div>
      )}
    </div>
  );
}