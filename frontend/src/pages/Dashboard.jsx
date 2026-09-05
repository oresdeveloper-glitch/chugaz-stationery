import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmt, getUser } from '../lib/api';
import { useToast } from '../components/Toast';
import { LineChart, Donut, SplitBar, HBarList, BarChart, Spark } from '../components/charts';
import { canRole } from '../lib/roles';
import I from '../components/icons';

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: 'month', label: 'Month' },
  { key: '90d', label: '90D' },
  { key: 'all', label: 'All' },
];

const KPI_COLORS = {
  blue: 'var(--primary)',
  green: 'var(--primary)',
  red: 'var(--danger)',
  amber: 'var(--warning)',
};

const METHOD_COLORS = { cash: '#78350f', mobile: '#92400e', card: '#78350f', bank: '#f59e0b', credit: '#ef4444', other: '#44403c' };

function TrendChip({ pct, good = true }) {
  if (pct === null || pct === undefined) return null;
  const up = pct > 0;
  const ok = good ? up : !up;
  return <span className={`kpi-trend ${ok ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {Math.abs(pct)}%</span>;
}

const KPI_ICON = { blue: 'chart', green: 'box', amber: 'bell', red: 'receipt' };
function kpiIconFor(label, color) {
  const l = (label || '').toLowerCase();
  if (l.includes('order')) return 'cart';
  if (l.includes('cash') || l.includes('received')) return 'truck';
  if (l.includes('stock') || l.includes('product')) return 'box';
  if (l.includes('expense') || l.includes('payable')) return 'receipt';
  if (l.includes('receivable') || l.includes('customer')) return 'users';
  return KPI_ICON[color] || 'chart';
}

function KpiCard({ label, value, currency, color = 'blue', icon, spark, sparkKey = 'sales', trend, trendGood = true, sub }) {
  const c = KPI_COLORS[color] || 'var(--primary)';
  return (
    <div className={`card stat-card kpi-card kpi-${color}`}>
      <div className="kpi-icon" style={{ color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
        <I name={icon || kpiIconFor(label, color)} size={18} />
      </div>
      <div className="kpi-top">
        <div className="label">{label}</div>
      </div>
      <div className="value" style={{ color: c }}>
        {fmt(value)} {currency && <span className="kpi-currency">{currency}</span>}
      </div>
      {spark && spark.length > 1 && <div className="kpi-spark"><Spark data={spark} key={sparkKey} color={c} /></div>}
      <div className="kpi-foot">
        <TrendChip pct={trend} good={trendGood} />
        {sub && <span className="sub">{sub}</span>}
      </div>
    </div>
  );
}

function AgingBar({ rows, color }) {
  const total = rows.reduce((s, r) => s + Number(r.total), 0);
  if (total <= 0) return <div className="muted small">Nothing outstanding.</div>;
  return (
    <div className="aging">
      {rows.map((r) => {
        const frac = Number(r.total) / total;
        return (
          <div key={r.bucket} className="aging-row">
            <div className="aging-label"><span>{r.bucket}</span><b>{fmt(r.total)}</b></div>
            <div className="hbar-track"><div className="hbar-fill" style={{ width: `${frac * 100}%`, background: color }} title={`${r.count} invoices`} /></div>
            <div className="aging-count muted small">{r.count} invoice{r.count === 1 ? '' : 's'}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const user = getUser();
  const role = (user && user.role) || 'clerk';
  const isCashier = role === 'cashier';
  const isClerk = role === 'clerk';
  const isMgmt = role === 'manager' || role === 'admin';
  const isAdmin = canRole(user, 'admin');

  const [data, setData] = useState(null);
  const [range, setRange] = useState(isCashier ? 'today' : 'month');
  const [auto, setAuto] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [updated, setUpdated] = useState(null);
  const toast = useToast();
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const load = async (r) => {
    const rr = r || rangeRef.current;
    setRefreshing(true);
    try {
      setData(await api(`/reports/dashboard?range=${rr}`));
      setUpdated(new Date());
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { load(rangeRef.current); }, []);
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => load(), 60000);
    return () => clearInterval(id);
  }, [auto]);

  if (!data) return <div className="card">Loading dashboard...</div>;

  const cur = data.kpi.currency;
  const k = data.kpi.cur;
  const trendData = data.series.trend;
  const isToday = data.range.key === 'today';
  const hourData = data.series.by_hour.map((h) => ({ day: `${h.hour}:00`, sales: Number(h.sales), count: Number(h.count) }));
  const weekdayData = data.series.by_weekday.map((w) => ({ day: w.day, sales: Number(w.sales), count: Number(w.count) }));
  const patternData = isToday ? hourData : weekdayData;
  const netTotal = trendData.reduce((s, d) => s + Number(d.net || 0), 0);
  const totalAlerts = data.alerts.low_stock.length + data.alerts.out_of_stock.length + (data.kpi.pending_orders.count > 0 ? 1 : 0) + (data.kpi.receivables.count > 0 ? 1 : 0) + (data.kpi.payables.count > 0 ? 1 : 0);
  const dateLabel = clock.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeLabel = clock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const lowStockList = [...data.alerts.low_stock, ...data.alerts.out_of_stock];

  return (
    <div>
      {/* Header - practical */}
      <div className="page-header dash-header">
        <div>
          <h1>Dashboard</h1>
          <div className="muted small">
            {user?.name} · {user?.role} · {dateLabel} · {timeLabel}
          </div>
          <div className="muted small" style={{marginTop:4}}>Products, stock, sales and orders at a glance.</div>
        </div>
        <div className="dash-toolbar">
          <div className="range-pills">
            {RANGES.map((r) => (
              <button key={r.key} className={`pill ${range === r.key ? 'active' : ''}`} onClick={() => { setRange(r.key); load(r.key); }}>{r.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions per role */}
      {isCashier && (
        <div className="dash-actions">
          <Link to="/pos" className="btn primary"><I name="bolt" size={14} /> New sale</Link>
          <Link to="/scan" className="btn"><I name="scan" size={14} /> Barcode scanner</Link>
          <Link to="/sales" className="btn"><I name="receipt" size={14} /> Sales</Link>
          <Link to="/orders" className="btn"><I name="list" size={14} /> Online orders{data.kpi.pending_orders.count > 0 && <span className="badge red">{data.kpi.pending_orders.count}</span>}</Link>
          <Link to="/products" className="btn"><I name="pencil" size={14} /> Products</Link>
        </div>
      )}
      {isClerk && (
        <div className="dash-actions">
          <Link to="/orders" className="btn primary"><I name="list" size={14} /> Online orders{data.kpi.pending_orders.count > 0 && <span className="badge red">{data.kpi.pending_orders.count}</span>}</Link>
          <Link to="/products" className="btn"><I name="pencil" size={14} /> Products</Link>
          <Link to="/customers" className="btn"><I name="users" size={14} /> Customers</Link>
          <Link to="/sales" className="btn"><I name="receipt" size={14} /> Sales</Link>
        </div>
      )}
      {isMgmt && (
        <div className="dash-actions">
          <Link to="/pos" className="btn primary"><I name="bolt" size={14} /> New sale</Link>
          <Link to="/orders" className="btn"><I name="list" size={14} /> Online orders{data.kpi.pending_orders.count > 0 && <span className="badge red">{data.kpi.pending_orders.count}</span>}</Link>
          <Link to="/purchases" className="btn"><I name="inbox" size={14} /> Receive stock</Link>
          <Link to="/products" className="btn"><I name="plus" size={14} /> Add product</Link>
          <Link to="/expenses" className="btn">¤ Add expense</Link>
          <Link to="/reports" className="btn"><I name="chart" size={14} /> Reports</Link>
        </div>
      )}

      {/* ---------- CASHIER dashboard ---------- */}
      {isCashier && (
        <>
          <div className="stats-grid">
            <KpiCard label={`Sales · ${data.range.label}`} value={k.sales} currency={cur} color="amber"
              spark={trendData} sparkKey="sales" trend={data.kpi.trend.sales}
              sub={`${k.count} transaction${k.count === 1 ? '' : 's'}`} />
            <KpiCard label="Cash received" value={k.received} currency={cur} color="amber"
              spark={trendData} sparkKey="inflow" trend={data.kpi.trend.received}
              sub={`${k.recv_count} receipt${k.recv_count === 1 ? '' : 's'}`} />
            {isAdmin && <KpiCard label="Low / out of stock" value={data.kpi.low_stock.count} color={data.kpi.low_stock.count > 0 ? 'amber' : 'amber'}
              sub={`${data.kpi.low_stock.out_count} out of stock · ${data.kpi.inventory.product_count} products`} />}
            <KpiCard label="Online orders" value={data.kpi.pending_orders.count} color={data.kpi.pending_orders.count > 0 ? 'amber' : 'amber'}
              sub={`${fmt(data.kpi.pending_orders.total)} ${cur} pending`} />
          </div>

          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head">
                <h2>{isToday ? 'Sales today by hour' : 'Sales by weekday'}</h2>
                <span className="muted small">{data.range.label}</span>
              </div>
              <BarChart data={patternData} xKey="day"
                series={[{ key: 'sales', color: 'var(--primary)', label: 'Sales' }]}
                currency={cur} labelEvery={isToday ? 2 : 1} />
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Payments by method</h2>
                <span className="muted small">{data.range.label}</span>
              </div>
              <Donut data={data.breakdown.by_method} valueKey="amount" labelKey="method" currency={cur}
                colors={data.breakdown.by_method.map((m) => METHOD_COLORS[m.method] || '#44403c')} />
            </div>
          </div>

          {(data.kpi.pending_orders.count > 0 || (isAdmin && lowStockList.length > 0)) && (
            <div className="card dash-alerts" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <h2>Needs attention</h2>
                <span className="badge red">{isAdmin ? lowStockList.length + (data.kpi.pending_orders.count > 0 ? 1 : 0) : data.kpi.pending_orders.count}</span>
              </div>
              <div className="dash-alert-grid">
                {data.kpi.pending_orders.count > 0 && (
                  <div className="dash-alert amber">
                    <b>{data.kpi.pending_orders.count} pending online order{data.kpi.pending_orders.count > 1 ? 's' : ''}</b> · {fmt(data.kpi.pending_orders.total)} {cur}
                    <Link to="/orders?status=pending">Review →</Link>
                  </div>
                )}
                {isAdmin && data.alerts.low_stock.map((p) => (
                  <div className="dash-alert amber" key={p.id}>
                    <b>{p.name}</b> : {fmt(p.available)} left (reorder at {fmt(p.reorder_level)}) · order ≈ {fmt(p.suggest_qty)} <span className="muted small">units</span>
                    <Link to="/products">View →</Link>
                  </div>
                ))}
                {isAdmin && data.alerts.out_of_stock.map((p) => (
                  <div className="dash-alert red" key={p.id}>
                    <b>{p.name}</b> is out of stock · order ≈ {fmt(p.suggest_qty)} <span className="muted small">units</span>
                    <Link to="/products">View →</Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head"><h2>Recent sales</h2><Link to="/sales" className="muted small">View all →</Link></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Invoice</th><th>Customer</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th><th>Date</th></tr></thead>
                <tbody>
                  {data.recent_sales.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.invoice_number}</td>
                      <td>{s.customer_name || 'Walk-in'}</td>
                      <td className="num">{fmt(s.total)}</td>
                      <td className="num">{fmt(s.paid_amount)}</td>
                      <td><span className={`badge ${s.payment_status === 'paid' ? 'amber' : s.payment_status === 'partial' ? 'amber' : 'red'}`}>{s.payment_status}</span></td>
                      <td className="muted">{new Date(s.sale_date).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ---------- CLERK dashboard ---------- */}
      {isClerk && (
        <>
          <div className="stats-grid">
            <KpiCard label="Pending orders" value={data.kpi.pending_orders.count} color={data.kpi.pending_orders.count > 0 ? 'amber' : 'amber'}
              sub={`${fmt(data.kpi.pending_orders.total)} ${cur}`} />
            {isAdmin && <KpiCard label="Low / out of stock" value={data.kpi.low_stock.count} color={data.kpi.low_stock.count > 0 ? 'amber' : 'amber'}
              sub={`${data.kpi.low_stock.out_count} out of stock`} />}
            <KpiCard label="Products" value={data.kpi.inventory.product_count} color="amber"
              sub={isAdmin ? `${fmt(data.kpi.inventory.stock_units)} units on hand` : 'in catalog'} />
            <KpiCard label={`Sales · ${data.range.label}`} value={k.sales} currency={cur} color="amber"
              spark={trendData} sparkKey="sales" trend={data.kpi.trend.sales}
              sub={`${k.count} transaction${k.count === 1 ? '' : 's'}`} />
          </div>

          {totalAlerts > 0 && (
            <div className="card dash-alerts" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <h2>Needs attention</h2>
                <span className="badge red">{totalAlerts}</span>
              </div>
              <div className="dash-alert-grid">
                {data.kpi.pending_orders.count > 0 && (
                  <div className="dash-alert amber">
                    <b>{data.kpi.pending_orders.count} pending online order{data.kpi.pending_orders.count > 1 ? 's' : ''}</b> · {fmt(data.kpi.pending_orders.total)} {cur}
                    <Link to="/orders?status=pending">Review →</Link>
                  </div>
                )}
                {isAdmin && data.alerts.low_stock.map((p) => (
                  <div className="dash-alert amber" key={p.id}>
                    <b>{p.name}</b> : {fmt(p.available)} left (reorder at {fmt(p.reorder_level)}) · order ≈ {fmt(p.suggest_qty)} <span className="muted small">units</span>
                    <Link to="/products">View →</Link>
                  </div>
                ))}
                {isAdmin && data.alerts.out_of_stock.map((p) => (
                  <div className="dash-alert red" key={p.id}>
                    <b>{p.name}</b> is out of stock · order ≈ {fmt(p.suggest_qty)} <span className="muted small">units</span>
                    <Link to="/products">View →</Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head"><h2>Recent online orders</h2><Link to="/orders" className="muted small">View all →</Link></div>
              {data.recent_orders.length === 0 ? <div className="muted">No orders yet.</div> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Order</th><th>Customer</th><th className="num">Total</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.recent_orders.map((o) => (
                      <tr key={o.id}>
                        <td style={{ fontWeight: 600 }}>{o.order_number}</td>
                        <td>{o.user_name}</td>
                        <td className="num">{fmt(o.total)}</td>
                        <td><span className={`badge ${o.order_status === 'completed' ? 'amber' : o.order_status === 'pending' ? 'amber' : o.order_status === 'cancelled' || o.order_status === 'rejected' ? 'red' : 'blue'}`}>{o.order_status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
            <div className="card">
              <div className="card-head"><h2>Recent sales</h2><Link to="/sales" className="muted small">View all →</Link></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Invoice</th><th>Customer</th><th className="num">Total</th><th>Status</th><th>Date</th></tr></thead>
                  <tbody>
                    {data.recent_sales.slice(0, 6).map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600 }}>{s.invoice_number}</td>
                        <td>{s.customer_name || 'Walk-in'}</td>
                        <td className="num">{fmt(s.total)}</td>
                        <td><span className={`badge ${s.payment_status === 'paid' ? 'amber' : s.payment_status === 'partial' ? 'amber' : 'red'}`}>{s.payment_status}</span></td>
                        <td className="muted">{new Date(s.sale_date).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head"><h2>Top sellers</h2><span className="muted small">{data.range.label}</span></div>
              <div className="table-wrap"><table>
                <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Revenue</th></tr></thead>
                <tbody>
                  {data.top.products.map((p) => (
                    <tr key={p.id}><td>{p.name}</td><td className="num">{fmt(p.qty)}</td><td className="num">{fmt(p.revenue)}</td></tr>
                  ))}
                </tbody>
              </table></div>
            </div>
            <div className="card">
              <div className="card-head"><h2>Revenue by category</h2><span className="muted small">{data.range.label}</span></div>
              {data.breakdown.by_category.length ? (
                <HBarList data={data.breakdown.by_category} valueKey="revenue" labelKey="category" currency={cur} />
              ) : <div className="muted small">No sales in this period.</div>}
            </div>
          </div>
        </>
      )}

      {/* ---------- MANAGER / ADMIN dashboard ---------- */}
      {isMgmt && (
        <>
          {/* Row 1 : performance KPIs for selected range */}
          <div className="stats-grid">
            <KpiCard label={`Sales · ${data.range.label}`} value={k.sales} currency={cur} color="amber"
              spark={trendData} sparkKey="sales" trend={data.kpi.trend.sales}
              sub={`${k.count} transaction${k.count === 1 ? '' : 's'}`} />
            <KpiCard label={`Profit · ${data.range.label}`} value={k.profit} currency={cur} color="amber"
              spark={trendData} sparkKey="profit" trend={data.kpi.trend.profit}
              sub={`margin ${k.margin}%`} />
            <KpiCard label="Cash received" value={k.received} currency={cur} color="amber"
              spark={trendData} sparkKey="inflow" trend={data.kpi.trend.received}
              sub={`${k.recv_count} receipt${k.recv_count === 1 ? '' : 's'} in period`} />
            <KpiCard label={`Expenses · ${data.range.label}`} value={k.expenses} currency={cur} color="red"
              spark={trendData} sparkKey="expenses"
              sub={`${k.expense_count} entry${k.expense_count === 1 ? '' : 's'} · supplier payments ${fmt(k.out)}`} />
          </div>

          {/* Row 2 : balances & inventory (always current) */}
          <div className="stats-grid">
            <KpiCard label="Receivables (customers)" value={data.kpi.receivables.total} currency={cur} color="amber"
              sub={`${data.kpi.receivables.count} unpaid invoices`} />
            <KpiCard label="Payables (suppliers)" value={data.kpi.payables.total} currency={cur} color="red"
              sub={`${data.kpi.payables.count} unpaid purchases`} />
            {isAdmin && <KpiCard label="Inventory value (cost)" value={data.kpi.inventory.cost} currency={cur} color="amber"
              sub={`${fmt(data.kpi.inventory.stock_units)} units · retail ${fmt(data.kpi.inventory.retail)}`} />}
            {isAdmin && <KpiCard label="Low / out of stock" value={data.kpi.low_stock.count} color={data.kpi.low_stock.count > 0 ? 'amber' : 'amber'}
              sub={`${data.kpi.low_stock.out_count} out of stock · ${data.kpi.inventory.product_count} products`} />}
          </div>

          {/* Charts row A : cash flow + payment methods */}
          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head">
                <h2>Cash flow</h2>
                <span className={`badge ${netTotal >= 0 ? 'amber' : 'red'}`}>Net {fmt(netTotal)} {cur}</span>
              </div>
              <BarChart data={trendData} xKey="day"
                series={[{ key: 'inflow', color: 'var(--primary)', label: 'Money in' }, { key: 'outflow', color: 'var(--danger)', label: 'Money out' }]}
                currency={cur} />
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Payments by method</h2>
                <span className="muted small">{data.range.label}</span>
              </div>
              <Donut data={data.breakdown.by_method} valueKey="amount" labelKey="method" currency={cur}
                colors={data.breakdown.by_method.map((m) => METHOD_COLORS[m.method] || '#44403c')} />
            </div>
          </div>

          {/* Charts row B : sales & profit + channels */}
          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head">
                <h2>{isToday ? 'Sales today by hour' : `Sales & profit : ${data.range.label.toLowerCase()}`}</h2>
                <span className="muted small">{isToday ? 'Hourly revenue' : 'Revenue vs gross profit'}</span>
              </div>
              <LineChart data={isToday ? hourData : trendData} xKey="day"
                series={isToday
                  ? [{ key: 'sales', color: 'var(--primary)', label: 'Sales' }]
                  : [{ key: 'sales', color: 'var(--primary)', label: 'Sales' }, { key: 'profit', color: 'var(--primary)', label: 'Profit' }]}
                currency={cur} />
            </div>
            <div className="card">
              <div className="card-head">
                <h2>Sales channels</h2>
                <span className="muted small">{data.range.label}</span>
              </div>
              <SplitBar items={data.breakdown.by_channel} currency={cur} />
            </div>
          </div>

          {/* Charts row C : category + pattern */}
          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head">
                <h2>Revenue by category</h2>
                <span className="muted small">{data.range.label}</span>
              </div>
              {data.breakdown.by_category.length ? (
                <HBarList data={data.breakdown.by_category} valueKey="revenue" labelKey="category" currency={cur} />
              ) : <div className="muted small">No sales in this period.</div>}
            </div>
            <div className="card">
              <div className="card-head">
                <h2>{isToday ? 'Busiest hours' : 'Sales by weekday'}</h2>
                <span className="muted small">{isToday ? 'Today' : data.range.label}</span>
              </div>
              <BarChart data={patternData} xKey="day"
                series={[{ key: 'sales', color: 'var(--primary)', label: 'Sales' }]}
                currency={cur} labelEvery={isToday ? 2 : 1} />
            </div>
          </div>

          {/* Aging */}
          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head"><h2>Receivables aging</h2><Link to="/sales?status=outstanding" className="muted small">Collect →</Link></div>
              <AgingBar rows={data.aging.receivables} color="var(--warning)" />
            </div>
            <div className="card">
              <div className="card-head"><h2>Payables aging</h2><Link to="/purchases?status=outstanding" className="muted small">Pay →</Link></div>
              <AgingBar rows={data.aging.payables} color="var(--danger)" />
            </div>
          </div>

          {/* Alerts */}
          {totalAlerts > 0 && (
            <div className="card dash-alerts" style={{ marginBottom: 16 }}>
              <div className="card-head">
                <h2>Needs attention</h2>
                <span className="badge red">{totalAlerts}</span>
              </div>
              <div className="dash-alert-grid">
                {data.kpi.pending_orders.count > 0 && (
                  <div className="dash-alert amber">
                    <b>{data.kpi.pending_orders.count} pending online order{data.kpi.pending_orders.count > 1 ? 's' : ''}</b> · {fmt(data.kpi.pending_orders.total)} {cur}
                    <Link to="/orders?status=pending">Review →</Link>
                  </div>
                )}
                {data.kpi.receivables.count > 0 && (
                  <div className="dash-alert amber">
                    <b>{fmt(data.kpi.receivables.total)} {cur} receivable</b> across {data.kpi.receivables.count} invoices
                    <Link to="/sales?status=outstanding">Collect →</Link>
                  </div>
                )}
                {data.kpi.payables.count > 0 && (
                  <div className="dash-alert red">
                    <b>{fmt(data.kpi.payables.total)} {cur} payable</b> across {data.kpi.payables.count} purchases
                    <Link to="/purchases?status=outstanding">Pay →</Link>
                  </div>
                )}
                {isAdmin && data.alerts.low_stock.map((p) => (
                  <div className="dash-alert amber" key={p.id}>
                    <b>{p.name}</b> : {fmt(p.available)} left (reorder at {fmt(p.reorder_level)}) · order ≈ {fmt(p.suggest_qty)} <span className="muted small">units</span>
                    <Link to="/inventory?tab=low">Manage →</Link>
                  </div>
                ))}
                {isAdmin && data.alerts.out_of_stock.map((p) => (
                  <div className="dash-alert red" key={p.id}>
                    <b>{p.name}</b> is out of stock · order ≈ {fmt(p.suggest_qty)} <span className="muted small">units</span>
                    <Link to="/inventory?tab=low">Manage →</Link>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Performance */}
          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head"><h2>Top sellers</h2><span className="muted small">{data.range.label}</span></div>
              <div className="table-wrap"><table>
                <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Revenue</th><th className="num">Profit</th></tr></thead>
                <tbody>
                  {data.top.products.map((p) => (
                    <tr key={p.id}><td>{p.name}</td><td className="num">{fmt(p.qty)}</td><td className="num">{fmt(p.revenue)}</td><td className="num">{fmt(p.profit)}</td></tr>
                  ))}
                </tbody>
              </table></div>
            </div>
            <div className="card">
              <div className="card-head"><h2>Top customers</h2><span className="muted small">{data.range.label} · by revenue</span></div>
              {data.top.customers.length === 0 ? <div className="muted">No customers in this period.</div> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Customer</th><th className="num">Orders</th><th className="num">Revenue</th><th className="num">Outstanding</th></tr></thead>
                  <tbody>
                    {data.top.customers.map((c) => (
                      <tr key={c.id}><td>{c.name}</td><td className="num">{c.count}</td><td className="num">{fmt(c.revenue)}</td>
                        <td className="num" style={{ color: Number(c.outstanding) > 0 ? 'var(--danger)' : undefined }}>{fmt(c.outstanding)}</td></tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          </div>

          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head"><h2>Cashier performance</h2><span className="muted small">{data.range.label}</span></div>
              {data.breakdown.by_cashier.length === 0 ? <div className="muted">No sales in this period.</div> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Cashier</th><th>Office</th><th className="num">Sales</th><th className="num">Total</th><th className="num">Unpaid</th></tr></thead>
                  <tbody>
                    {data.breakdown.by_cashier.map((c, i) => (
                      <tr key={i}><td style={{ fontWeight: 600 }}>{c.name}</td><td>{c.office ? <span className="badge amber">{c.office}</span> : <span className="muted">:</span>}</td><td className="num">{c.count}</td><td className="num">{fmt(c.total)}</td>
                        <td className="num" style={{ color: Number(c.unpaid) > 0 ? 'var(--danger)' : undefined }}>{fmt(c.unpaid)}</td></tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
            {isAdmin && (
            <div className="card">
              <div className="card-head"><h2>Stock value by category</h2><span className="muted small">Current inventory</span></div>
              {data.inventory_by_category.length ? (
                <HBarList data={data.inventory_by_category} valueKey="cost_value" labelKey="category" currency={cur} />
              ) : <div className="muted">No stock recorded.</div>}
            </div>
          )}
          </div>

          {/* Recent activity */}
          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head"><h2>Recent online orders</h2><Link to="/orders" className="muted small">View all →</Link></div>
              {data.recent_orders.length === 0 ? <div className="muted">No orders yet.</div> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Order</th><th>Customer</th><th className="num">Total</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.recent_orders.map((o) => (
                      <tr key={o.id}>
                        <td style={{ fontWeight: 600 }}>{o.order_number}</td>
                        <td>{o.user_name}</td>
                        <td className="num">{fmt(o.total)}</td>
                        <td><span className={`badge ${o.order_status === 'completed' ? 'amber' : o.order_status === 'pending' ? 'amber' : o.order_status === 'cancelled' || o.order_status === 'rejected' ? 'red' : 'blue'}`}>{o.order_status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
            <div className="card">
              <div className="card-head"><h2>Recent payments</h2><span className="muted small">Sales & purchases</span></div>
              {data.recent_payments.length === 0 ? <div className="muted">No payments yet.</div> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>Date</th><th>Method</th><th className="num">Amount</th><th>Context</th></tr></thead>
                  <tbody>
                    {data.recent_payments.map((p) => (
                      <tr key={p.id}>
                        <td className="muted small">{new Date(p.payment_date).toLocaleString()}</td>
                        <td>{p.payment_method}</td>
                        <td className="num" style={{ color: Number(p.amount) < 0 ? 'var(--danger)' : undefined }}>{fmt(p.amount)}</td>
                        <td className="muted small">{p.customer_name || p.supplier_name || p.sale_invoice || p.purchase_invoice || ':'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Recent sales</h2><Link to="/sales" className="muted small">View all →</Link></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Invoice</th><th>Customer</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th><th>Date</th></tr></thead>
                <tbody>
                  {data.recent_sales.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.invoice_number}</td>
                      <td>{s.customer_name || 'Walk-in'}</td>
                      <td className="num">{fmt(s.total)}</td>
                      <td className="num">{fmt(s.paid_amount)}</td>
                      <td><span className={`badge ${s.payment_status === 'paid' ? 'amber' : s.payment_status === 'partial' ? 'amber' : 'red'}`}>{s.payment_status}</span></td>
                      <td className="muted">{new Date(s.sale_date).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}