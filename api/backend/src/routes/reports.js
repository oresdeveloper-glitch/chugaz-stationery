const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

router.get('/dashboard', (req, res) => {
 const RANGES = {
  today: { curStart: "date('now')", curEnd: "date('now')", prevStart: "date('now','-1 day')", prevEnd: "date('now','-1 day')", label: 'Today', prevLabel: 'Yesterday' },
  '7d': { curStart: "date('now','-6 day')", curEnd: "date('now')", prevStart: "date('now','-13 day')", prevEnd: "date('now','-7 day')", label: 'Last 7 days', prevLabel: 'Previous 7 days' },
  '30d': { curStart: "date('now','-29 day')", curEnd: "date('now')", prevStart: "date('now','-59 day')", prevEnd: "date('now','-30 day')", label: 'Last 30 days', prevLabel: 'Previous 30 days' },
  month: { curStart: "date('now','start of month')", curEnd: "date('now')", prevStart: "date('now','start of month','-1 month')", prevEnd: "date('now','start of month','-1 day')", label: 'This month', prevLabel: 'Last month' },
  last_month: { curStart: "date('now','start of month','-1 month')", curEnd: "date('now','start of month','-1 day')", prevStart: "date('now','start of month','-2 month')", prevEnd: "date('now','start of month','-1 month','-1 day')", label: 'Last month', prevLabel: 'Previous month' },
  '90d': { curStart: "date('now','-89 day')", curEnd: "date('now')", prevStart: "date('now','-179 day')", prevEnd: "date('now','-90 day')", label: 'Last 90 days', prevLabel: 'Previous 90 days' },
  all: { curStart: "date('1900-01-01')", curEnd: "date('now')", prevStart: "date('1900-01-01')", prevEnd: "date('now')", label: 'All time', prevLabel: '—' },
 };
 const range = req.query.range || 'month';
 const b = RANGES[range] || RANGES.month;
 const inWin = (col) => `date(${col}) BETWEEN ${b.curStart} AND ${b.curEnd}`;
 const inPrev = (col) => `date(${col}) BETWEEN ${b.prevStart} AND ${b.prevEnd}`;
 const q = (sql) => db.prepare(sql).get();
 const qa = (sql) => db.prepare(sql).all();
 const num = (v) => Number(v) || 0;
 const pct = (cur, prev) => (prev > 0 ? Math.round(((num(cur) - num(prev)) / num(prev)) * 1000) / 10 : num(cur) > 0 ? null : 0);

 // A cashier/clerk only ever sees their own sales on the dashboard.
 const isSeller = req.user.role === 'cashier' || req.user.role === 'clerk';
 const sellerJoin = isSeller ? ` AND s.created_by = ${req.user.id} ` : '';
 const sellerPlain = isSeller ? ` AND created_by = ${req.user.id} ` : '';
 const sellerPay = isSeller ? ` AND created_by = ${req.user.id} ` : '';

 // ---- KPIs for selected window vs previous equivalent window ----
 const curSales = q(`SELECT COALESCE(SUM(total),0) sales, COALESCE(SUM(paid_amount),0) received, COALESCE(SUM(tax),0) tax, COUNT(*) count
  FROM sales WHERE ${inWin('sale_date')}${sellerPlain}`);
 const prevSales = q(`SELECT COALESCE(SUM(total),0) sales, COALESCE(SUM(paid_amount),0) received, COUNT(*) count
  FROM sales WHERE ${inPrev('sale_date')}${sellerPlain}`);
 const curProfit = q(`SELECT COALESCE(SUM(si.total - si.cost_at_sale * si.quantity),0) profit
  FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${inWin('s.sale_date')}${sellerJoin}`);
 const prevProfit = q(`SELECT COALESCE(SUM(si.total - si.cost_at_sale * si.quantity),0) profit
  FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${inPrev('s.sale_date')}${sellerJoin}`);
 const curReceived = q(`SELECT COALESCE(SUM(amount),0) total, COUNT(*) count FROM payments
  WHERE ${inWin('payment_date')} AND amount > 0 AND supplier_id IS NULL${sellerPay}`);
 const curExpenses = q(`SELECT COALESCE(SUM(amount),0) total, COUNT(*) count FROM expenses WHERE ${inWin('expense_date')}`);
 const curOut = q(`SELECT COALESCE(SUM(amount),0) total, COUNT(*) count FROM payments
  WHERE ${inWin('payment_date')} AND amount > 0 AND supplier_id IS NOT NULL${sellerPay}`);

 // ---- Always-current balances / inventory ----
 const inventory = q(`SELECT COUNT(*) product_count,
  COALESCE(SUM(current_stock),0) stock_units,
  COALESCE(SUM(current_stock * purchase_price),0) cost,
  COALESCE(SUM(current_stock * selling_price),0) retail
  FROM products WHERE status='active'`);
 const lowStockCount = q(`SELECT COUNT(*) c FROM products WHERE status='active' AND current_stock <= reorder_level`).c;
 const outStockCount = q(`SELECT COUNT(*) c FROM products WHERE status='active' AND current_stock <= 0`).c;
 const ar = q(`SELECT COUNT(*) count, COALESCE(SUM(total - paid_amount),0) total FROM sales WHERE payment_status != 'paid' AND total > 0${sellerPlain}`);
 const ap = q(`SELECT COUNT(*) count, COALESCE(SUM(total - paid_amount),0) total FROM purchases WHERE payment_status != 'paid'`);
 const pendingOrders = q(`SELECT COUNT(*) count, COALESCE(SUM(total),0) total FROM orders WHERE order_status='pending'`);
 const ordersToday = q(`SELECT COUNT(*) count, COALESCE(SUM(total),0) total FROM orders
   WHERE date(order_date)=date('now') AND order_status NOT IN ('cancelled','rejected')`);
 const ordersTodayPrev = q(`SELECT COUNT(*) count, COALESCE(SUM(total),0) total FROM orders
   WHERE date(order_date)=date('now','-1 day') AND order_status NOT IN ('cancelled','rejected')`);

 // ---- Daily series ----
 const dailySales = qa(`SELECT date(sale_date) day, COALESCE(SUM(total),0) sales, COALESCE(SUM(paid_amount),0) received, COUNT(*) count
  FROM sales WHERE ${inWin('sale_date')}${sellerPlain} GROUP BY date(sale_date) ORDER BY day`);
 const dailyProfit = qa(`SELECT date(s.sale_date) day, COALESCE(SUM(si.total - si.cost_at_sale * si.quantity),0) profit
  FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${inWin('s.sale_date')}${sellerJoin} GROUP BY date(s.sale_date)`);
 const dailyIn = qa(`SELECT date(payment_date) day, COALESCE(SUM(amount),0) inflow FROM payments
  WHERE ${inWin('payment_date')} AND amount > 0 AND supplier_id IS NULL${sellerPay} GROUP BY date(payment_date)`);
 const dailyOutPay = qa(`SELECT date(payment_date) day, COALESCE(SUM(amount),0) outflow FROM payments
  WHERE ${inWin('payment_date')} AND amount > 0 AND supplier_id IS NOT NULL${sellerPay} GROUP BY date(payment_date)`);
 const dailyOutExp = qa(`SELECT date(expense_date) day, COALESCE(SUM(amount),0) outflow FROM expenses WHERE ${inWin('expense_date')} GROUP BY date(expense_date)`);

 const dayMap = {};
 dailySales.forEach((d) => (dayMap[d.day] = { sales: num(d.sales), received: num(d.received), count: num(d.count) }));
 dailyProfit.forEach((p) => { dayMap[p.day] = dayMap[p.day] || {}; dayMap[p.day].profit = num(p.profit); });
 dailyIn.forEach((p) => { dayMap[p.day] = dayMap[p.day] || {}; dayMap[p.day].inflow = num(p.inflow); });
 dailyOutPay.forEach((p) => { dayMap[p.day] = dayMap[p.day] || {}; dayMap[p.day].outflow = num(p.outflow); });
 dailyOutExp.forEach((p) => { dayMap[p.day] = dayMap[p.day] || {}; dayMap[p.day].expenses = num(p.outflow); });

 // Bucket into day / week / month depending on window length
 let bucketMode = 'day';
 const totalDays = range === 'today' ? 1 : range === 'all' ? 2000 : Number((range.match(/(\d+)d/) || [])[1] || 31);
 if (totalDays > 200) bucketMode = 'month';
 else if (totalDays > 45) bucketMode = 'week';
 const bucketKey = (dayStr) => {
  if (bucketMode === 'day') return dayStr;
  const dt = new Date(dayStr + 'T00:00:00');
  if (bucketMode === 'month') return dt.toISOString().slice(0, 7);
  const d = new Date(dt.getTime() + ((4 - dt.getDay()) * 864e5) % (7 * 864e5));
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
 };
 const buckets = {};
 Object.keys(dayMap).sort().forEach((day) => {
  const k = bucketKey(day);
  buckets[k] = buckets[k] || { day: k, sales: 0, profit: 0, received: 0, inflow: 0, outflow: 0, expenses: 0, count: 0 };
  for (const key of ['sales', 'profit', 'received', 'inflow', 'outflow', 'expenses', 'count']) {
   buckets[k][key] += num(dayMap[day][key]);
  }
 });
 const trend = Object.values(buckets).map((d) => ({ ...d, net: num(d.inflow) - num(d.outflow) - num(d.expenses) }));

 // ---- Hourly / weekday pattern ----
 const byHour = qa(`SELECT strftime('%H', sale_date) hour, COUNT(*) count, COALESCE(SUM(total),0) sales
  FROM sales WHERE ${inWin('sale_date')}${sellerPlain} GROUP BY hour ORDER BY hour`);
 const byWeekday = qa(`SELECT (strftime('%w', sale_date) + 6) % 7 dow, COUNT(*) count, COALESCE(SUM(total),0) sales
  FROM sales WHERE ${inWin('sale_date')}${sellerPlain} GROUP BY dow ORDER BY dow`).map((d) => ({ ...d, day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d.dow] }));

 // ---- Breakdowns ----
 const byMethod = qa(`SELECT COALESCE(payment_method,'other') method, COALESCE(SUM(amount),0) amount, COUNT(*) count
  FROM payments WHERE ${inWin('payment_date')} AND amount > 0 AND supplier_id IS NULL${sellerPay} GROUP BY payment_method ORDER BY amount DESC`);
 const byChannel = [
  { channel: 'pos', revenue: q(`SELECT COALESCE(SUM(total),0) v FROM sales WHERE ${inWin('sale_date')}${sellerPlain}`).v,
   count: q(`SELECT COUNT(*) c FROM sales WHERE ${inWin('sale_date')}${sellerPlain}`).c },
  { channel: 'online', revenue: q(`SELECT COALESCE(SUM(total),0) v FROM orders WHERE ${inWin('order_date')} AND order_status NOT IN ('cancelled','rejected')`).v,
   count: q(`SELECT COUNT(*) c FROM orders WHERE ${inWin('order_date')} AND order_status NOT IN ('cancelled','rejected')`).c },
 ];
 const byCategory = qa(`SELECT COALESCE(c.name,'Uncategorized') category, SUM(si.quantity) qty, SUM(si.total) revenue
  FROM sale_items si JOIN sales s ON s.id = si.sale_id
  LEFT JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
  WHERE ${inWin('s.sale_date')}${sellerJoin}
  GROUP BY c.id ORDER BY revenue DESC LIMIT 8`);
 const byCashier = qa(`SELECT u.name, u.office_id, o.name AS office, COUNT(s.id) count, COALESCE(SUM(s.total),0) total, COALESCE(SUM(s.total - s.paid_amount),0) unpaid
  FROM sales s JOIN users u ON u.id = s.created_by LEFT JOIN offices o ON o.id = u.office_id
  WHERE ${inWin('s.sale_date')}${sellerJoin}
  GROUP BY u.id ORDER BY total DESC`);

 // ---- Aging ----
 const age = (table, idCol, extra = '') => [
  { bucket: '0–30 days', cond: `${idCol} >= date('now','-30 day')` },
  { bucket: '31–60 days', cond: `${idCol} >= date('now','-60 day') AND ${idCol} < date('now','-30 day')` },
  { bucket: '61–90 days', cond: `${idCol} >= date('now','-90 day') AND ${idCol} < date('now','-60 day')` },
  { bucket: '90+ days', cond: `${idCol} < date('now','-90 day')` },
 ].map((g) => {
  const r = q(`SELECT COUNT(*) count, COALESCE(SUM(total - paid_amount),0) total FROM ${table} WHERE payment_status != 'paid' AND total > 0 AND ${g.cond} ${extra}`);
  return { bucket: g.bucket, count: num(r.count), total: num(r.total) };
 });
 const arAging = age('sales', 'date(sale_date)', sellerPlain);
 const apAging = age('purchases', 'date(purchase_date)');

 // ---- Alerts ----
 const lowStock = qa(`SELECT id, name, sku, current_stock, reorder_level, (current_stock - COALESCE(reserved_stock,0)) available,
  MAX(1, reorder_level - current_stock + 5) AS suggest_qty
  FROM products WHERE status='active' AND current_stock > 0 AND current_stock <= reorder_level
  ORDER BY (current_stock * 1.0 / NULLIF(reorder_level,0)) ASC LIMIT 12`);
 const outOfStock = qa(`SELECT id, name, sku, current_stock, reorder_level, MAX(1, reorder_level + 5) AS suggest_qty
  FROM products WHERE status='active' AND current_stock <= 0 ORDER BY current_stock ASC LIMIT 12`);

 // ---- Performance ----
 const topProducts = qa(`SELECT p.id, p.name, p.sku, SUM(si.quantity) qty, SUM(si.total) revenue,
  SUM(si.total - si.cost_at_sale * si.quantity) profit
  FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id
  WHERE ${inWin('s.sale_date')}${sellerJoin} GROUP BY p.id ORDER BY revenue DESC LIMIT 8`);
 const topCustomers = qa(`SELECT c.id, c.name, c.phone, COUNT(s.id) count, COALESCE(SUM(s.total),0) revenue,
  COALESCE(SUM(s.total - s.paid_amount),0) outstanding
  FROM sales s JOIN customers c ON c.id = s.customer_id
  WHERE ${inWin('s.sale_date')}${sellerJoin}
  GROUP BY c.id ORDER BY revenue DESC LIMIT 8`);
 const inventoryByCategory = qa(`SELECT COALESCE(c.name,'Uncategorized') category, COUNT(p.id) products,
  COALESCE(SUM(p.current_stock * p.purchase_price),0) cost_value, COALESCE(SUM(p.current_stock * p.selling_price),0) retail_value
  FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.status='active'
  GROUP BY c.id ORDER BY cost_value DESC`);

 // ---- Recent activity ----
 const recentSales = qa(`SELECT s.id, s.invoice_number, s.total, s.paid_amount, s.payment_status, s.sale_date, c.name AS customer_name
  FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
  WHERE 1=1${sellerJoin}
  ORDER BY s.sale_date DESC, s.id DESC LIMIT 8`);
 const recentOrders = qa(`SELECT o.id, o.order_number, o.total, o.order_status, o.payment_status, o.order_date, u.name AS user_name
  FROM orders o LEFT JOIN users u ON u.id = o.user_id
  ORDER BY o.created_at DESC, o.id DESC LIMIT 8`);
 const recentMovements = qa(`SELECT m.id, m.movement_type, m.quantity, m.notes, m.created_at, p.name AS product_name, u.name AS user_name
  FROM stock_movements m LEFT JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.created_by
  ORDER BY m.created_at DESC, m.id DESC LIMIT 8`);
 const recentPayments = qa(`SELECT pay.id, pay.amount, pay.payment_method, pay.payment_date,
  c.name AS customer_name, sup.name AS supplier_name, s.invoice_number AS sale_invoice, pu.invoice_number AS purchase_invoice
  FROM payments pay
  LEFT JOIN customers c ON c.id = pay.customer_id
  LEFT JOIN suppliers sup ON sup.id = pay.supplier_id
  LEFT JOIN sales s ON s.id = pay.sale_id
  LEFT JOIN purchases pu ON pu.id = pay.purchase_id
  WHERE 1=1${sellerPay.replace('created_by', 'pay.created_by')}
  ORDER BY pay.payment_date DESC, pay.id DESC LIMIT 8`);

 const currency = db.prepare("SELECT value FROM settings WHERE key='currency'").get()?.value || 'TSh';
 const margin = curSales.sales > 0 ? Math.round((num(curProfit.profit) / num(curSales.sales)) * 1000) / 10 : 0;

 const isAdmin = req.user.role === 'admin';
 const kpi = {
  cur: { sales: num(curSales.sales), received: num(curSales.received), count: num(curSales.count), tax: num(curSales.tax), profit: num(curProfit.profit), expenses: num(curExpenses.total), expense_count: num(curExpenses.count), out: num(curOut.total), margin, recv_count: num(curReceived.count) },
  prev: { sales: num(prevSales.sales), received: num(prevSales.received), profit: num(prevProfit.profit) },
  trend: { sales: pct(curSales.sales, prevSales.sales), received: pct(curSales.received, prevSales.received), profit: pct(curProfit.profit, prevProfit.profit), orders: pct(ordersToday.total, ordersTodayPrev.total) },
  inventory: isAdmin ? inventory : { product_count: inventory.product_count, stock_units: 0, cost: 0, retail: 0 },
  low_stock: isAdmin ? { count: lowStockCount, out_count: outStockCount } : { count: 0, out_count: 0 },
  receivables: ar,
  payables: ap,
  pending_orders: pendingOrders,
  orders_today: { count: num(ordersToday.count), total: num(ordersToday.total) },
  currency,
 };

 const stats = {
  total_products: inventory.product_count,
  total_stock: isAdmin ? inventory.stock_units : 0,
  inventory_value_cost: isAdmin ? inventory.cost : 0,
  inventory_value_retail: isAdmin ? inventory.retail : 0,
  low_stock_count: isAdmin ? lowStockCount : 0,
  out_of_stock: isAdmin ? outStockCount : 0,
  pending_customer_balance: ar.total,
  pending_supplier_balance: ap.total,
  pending_orders: pendingOrders.count,
  orders_today_count: num(ordersToday.count),
  orders_today_total: num(ordersToday.total),
  range_expenses: num(curExpenses.total),
  range_sales: num(curSales.sales),
  range_profit: num(curProfit.profit),
 };

 res.json({
  range: { key: range, label: b.label, prevLabel: b.prevLabel },
  stats,
  kpi,
  series: { trend, by_hour: byHour, by_weekday: byWeekday },
  breakdown: { by_method: byMethod, by_channel: byChannel, by_category: byCategory, by_cashier: byCashier },
  aging: { receivables: arAging, payables: apAging },
  alerts: { low_stock: isAdmin ? lowStock : [], out_of_stock: isAdmin ? outOfStock : [] },
  top: { products: topProducts, customers: topCustomers },
  inventory_by_category: isAdmin ? inventoryByCategory : [],
  recent_sales: recentSales,
  recent_orders: recentOrders,
  recent_movements: recentMovements,
  recent_payments: recentPayments,
 });
});

router.get('/sales-summary', requireRole('manager', 'admin'), (req, res) => {
 const { from, to, period } = req.query;
 let sql;
 if (period === 'monthly') {
  sql = `SELECT strftime('%Y-%m', sale_date) period, COUNT(*) count, SUM(total) sales, SUM(paid_amount) received, SUM(tax) tax
      FROM sales GROUP BY period ORDER BY period DESC`;
 } else if (period === 'weekly') {
  sql = `SELECT strftime('%Y-W%W', sale_date) period, COUNT(*) count, SUM(total) sales, SUM(paid_amount) received, SUM(tax) tax
      FROM sales GROUP BY period ORDER BY period DESC`;
 } else {
  sql = `SELECT date(sale_date) period, COUNT(*) count, SUM(total) sales, SUM(paid_amount) received, SUM(tax) tax
      FROM sales WHERE date(sale_date) BETWEEN date(?) AND date(?) GROUP BY period ORDER BY period DESC`;
 }
 const params = from && to ? [from, to] : [];
 res.json(db.prepare(sql).all(...params));
});

router.get('/profit-loss', requireRole('manager', 'admin'), (req, res) => {
 const { from, to } = req.query;
 const fromDate = from || '1900-01-01';
 const toDate = to || '2999-12-31';
 const sales = db.prepare(`
  SELECT COALESCE(SUM(total),0) revenue, COALESCE(SUM(tax),0) tax_collected
  FROM sales WHERE date(sale_date) BETWEEN date(?) AND date(?)
 `).get(fromDate, toDate);
 const cogs = db.prepare(`
  SELECT COALESCE(SUM(si.cost_at_sale * si.quantity),0) cost_of_goods
  FROM sale_items si JOIN sales s ON s.id = si.sale_id
  WHERE date(s.sale_date) BETWEEN date(?) AND date(?)
 `).get(fromDate, toDate);
 const expenses = db.prepare(`
  SELECT COALESCE(SUM(amount),0) total FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?)
 `).get(fromDate, toDate);
 const purchases = db.prepare(`
  SELECT COALESCE(SUM(total),0) total FROM purchases WHERE date(purchase_date) BETWEEN date(?) AND date(?)
 `).get(fromDate, toDate);
 res.json({
  revenue: sales.revenue,
  tax_collected: sales.tax_collected,
  cost_of_goods: cogs.cost_of_goods,
  gross_profit: sales.revenue - sales.tax_collected - cogs.cost_of_goods,
  expenses: expenses.total,
  purchases: purchases.total,
  net_profit: sales.revenue - sales.tax_collected - cogs.cost_of_goods - expenses.total,
 });
});

router.get('/best-sellers', requireRole('manager', 'admin'), (req, res) => {
 const { from, to } = req.query;
 const params = [];
 let cond = '';
 if (from && to) { cond = 'WHERE date(s.sale_date) BETWEEN date(?) AND date(?)'; params.push(from, to); }
 res.json(db.prepare(`
  SELECT p.id, p.name, p.sku, SUM(si.quantity) qty, SUM(si.total) revenue
  FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id
  ${cond} GROUP BY p.id ORDER BY revenue DESC LIMIT 20
 `).all(...params));
});

router.get('/inventory-valuation', requireRole('admin'), (req, res) => {
 res.json(db.prepare(`
  SELECT c.name category, COUNT(p.id) products, COALESCE(SUM(p.current_stock * p.purchase_price),0) cost_value,
      COALESCE(SUM(p.current_stock * p.selling_price),0) retail_value
  FROM products p LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.status='active' GROUP BY c.id ORDER BY cost_value DESC
 `).all());
});

router.get('/tax', requireRole('manager', 'admin'), (req, res) => {
 const { from, to } = req.query;
 const fromDate = from || '1900-01-01';
 const toDate = to || '2999-12-31';
 const sales = db.prepare('SELECT COALESCE(SUM(tax),0) tax FROM sales WHERE date(sale_date) BETWEEN date(?) AND date(?)').get(fromDate, toDate);
 const purchases = db.prepare('SELECT COALESCE(SUM(tax),0) tax FROM purchases WHERE date(purchase_date) BETWEEN date(?) AND date(?)').get(fromDate, toDate);
 res.json({ sales_tax: sales.tax, purchase_tax: purchases.tax, net_payable: Math.max(sales.tax - purchases.tax, 0) });
});

router.get('/audit', requireRole('manager', 'admin'), (req, res) => {
 const { limit } = req.query;
 res.json(db.prepare(`
   SELECT al.*, u.name AS user_name FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
   ORDER BY al.created_at DESC, al.id DESC LIMIT ${Math.min(Number(limit) || 200, 1000)}
 `).all());
});

// ---- Daily tasks report: every task made per day (activity + work done) ----
router.get('/daily-tasks', requireRole('manager', 'admin'), (req, res) => {
 const pad = (n) => String(n).padStart(2, '0');
 const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
 const today = iso(new Date());
 const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today;
 const fromInput = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : to;
 const spanDays = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(fromInput + 'T00:00:00Z')) / 864e5);
 const from = spanDays > 366 ? iso(new Date(Date.parse(to + 'T00:00:00Z') - 365 * 864e5)) : fromInput;
 const qa = (sql, ...p) => db.prepare(sql).all(...p);
 const num = (v) => Number(v) || 0;

 // Task counts per day straight out of the audit trail (real work done by users),
 // dropping login/read noise so "tasks" means actions on the business data.
 const taskRows = qa(`
   SELECT date(al.created_at) day, al.action, al.entity, u.name AS user_name, COUNT(*) count
   FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id
   WHERE date(al.created_at) BETWEEN date(?) AND date(?)
     AND al.action NOT IN ('LOGIN','LOGIN_FAIL','LOGIN_RESTORE','READ')
   GROUP BY day, al.action, al.entity, al.user_id
   ORDER BY day, count DESC`, from, to);
 const taskTotals = qa(`
   SELECT date(created_at) day, COUNT(*) count
   FROM audit_logs
   WHERE date(created_at) BETWEEN date(?) AND date(?)
     AND action NOT IN ('LOGIN','LOGIN_FAIL','LOGIN_RESTORE','READ')
   GROUP BY day`, from, to);

 const salesRows = qa(`SELECT date(sale_date) day, COUNT(*) count, COALESCE(SUM(total),0) total
   FROM sales WHERE date(sale_date) BETWEEN date(?) AND date(?) GROUP BY day`, from, to);
 const orderRows = qa(`SELECT date(order_date) day, COUNT(*) count, COALESCE(SUM(total),0) total
   FROM orders WHERE date(order_date) BETWEEN date(?) AND date(?) AND order_status NOT IN ('cancelled','rejected') GROUP BY day`, from, to);
 const payRows = qa(`SELECT date(payment_date) day, COUNT(*) count, COALESCE(SUM(amount),0) total
   FROM payments WHERE date(payment_date) BETWEEN date(?) AND date(?) AND amount > 0 GROUP BY day`, from, to);
 const expRows = qa(`SELECT date(expense_date) day, COUNT(*) count, COALESCE(SUM(amount),0) total
   FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?) GROUP BY day`, from, to);

 // Dense day list so days with no activity still show up as rows of zeros.
 const days = [];
 const endMs = Date.parse(to + 'T00:00:00Z');
 const startMs = Date.parse(from + 'T00:00:00Z');
 for (let ms = startMs; ms <= endMs; ms += 864e5) days.push(iso(new Date(ms)));

 const byDay = {};
 const slot = (d) => (byDay[d] = byDay[d] || { day: d, tasks: 0, sales_count: 0, sales_total: 0, orders_count: 0, orders_total: 0, payments_count: 0, payments_total: 0, expenses_count: 0, expenses_total: 0 });
 days.forEach((d) => slot(d));
 taskTotals.forEach((r) => { if (byDay[r.day]) byDay[r.day].tasks = num(r.count); });
 salesRows.forEach((r) => { if (byDay[r.day]) { byDay[r.day].sales_count = num(r.count); byDay[r.day].sales_total = num(r.total); } });
 orderRows.forEach((r) => { if (byDay[r.day]) { byDay[r.day].orders_count = num(r.count); byDay[r.day].orders_total = num(r.total); } });
 payRows.forEach((r) => { if (byDay[r.day]) { byDay[r.day].payments_count = num(r.count); byDay[r.day].payments_total = num(r.total); } });
 expRows.forEach((r) => { if (byDay[r.day]) { byDay[r.day].expenses_count = num(r.count); byDay[r.day].expenses_total = num(r.total); } });

 const rows = days.map((d) => byDay[d]);
 const totals = rows.reduce((a, r) => ({
   tasks: a.tasks + r.tasks,
   sales_count: a.sales_count + r.sales_count,
   sales_total: a.sales_total + r.sales_total,
   orders_count: a.orders_count + r.orders_count,
   orders_total: a.orders_total + r.orders_total,
   payments_count: a.payments_count + r.payments_count,
   payments_total: a.payments_total + r.payments_total,
   expenses_count: a.expenses_count + r.expenses_count,
   expenses_total: a.expenses_total + r.expenses_total,
 }), { tasks: 0, sales_count: 0, sales_total: 0, orders_count: 0, orders_total: 0, payments_count: 0, payments_total: 0, expenses_count: 0, expenses_total: 0 });

 const taskDetail = qa(`
   SELECT al.id, al.action, al.entity, al.entity_id, al.details, al.created_at,
          date(al.created_at) day, u.name AS user_name, r.name AS user_role
   FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id LEFT JOIN roles r ON r.id = u.role_id
   WHERE date(al.created_at) BETWEEN date(?) AND date(?)
     AND al.action NOT IN ('LOGIN','LOGIN_FAIL','LOGIN_RESTORE','READ')
   ORDER BY al.created_at DESC, al.id DESC LIMIT 500`, from, to);

 res.json({
  range: { from, to },
  days: rows,
  breakdown: taskRows,
  task_detail: taskDetail,
  totals,
 });
});

router.get('/cashier-performance', requireRole('manager', 'admin'), (req, res) => {
 const { from, to } = req.query;
 let dateCond = '';
 const dateParams = [];
 if (from && to) { dateCond = ' AND date(s.sale_date) BETWEEN date(?) AND date(?)'; dateParams.push(from, to); }
 res.json(db.prepare(`
  SELECT u.id, u.name, o.name AS office, COUNT(s.id) sales_count, COALESCE(SUM(s.total),0) total
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN sales s ON s.created_by = u.id${dateCond}
  LEFT JOIN offices o ON o.id = u.office_id
  WHERE r.name IN ('cashier','clerk','manager','admin')
  GROUP BY u.id ORDER BY total DESC, u.id
 `).all(...dateParams));
});

router.get('/cashier-daily-detail', requireRole('manager', 'admin'), (req, res) => {
 const from = req.query.from || new Date().toISOString().slice(0, 10);
 const to = req.query.to || from;
 const cashierId = req.query.cashier_id ? Number(req.query.cashier_id) : null;

 const params = [from, to];
 let cashierFilter = '';
 if (cashierId) { cashierFilter = ' AND s.created_by = ? '; params.push(cashierId); }

 const summary = db.prepare(`
  SELECT COUNT(s.id) sales_count, COALESCE(SUM(s.total),0) total_revenue,
      COALESCE(SUM(s.paid_amount),0) total_paid, COALESCE(SUM(s.total - s.paid_amount),0) outstanding
  FROM sales s
  WHERE date(s.sale_date) BETWEEN date(?) AND date(?) ${cashierFilter}
 `).get(...params);

 const distinctProducts = db.prepare(`
  SELECT COUNT(DISTINCT si.product_id) c
  FROM sale_items si JOIN sales s ON s.id = si.sale_id
  WHERE date(s.sale_date) BETWEEN date(?) AND date(?) ${cashierFilter}
 `).get(...params);

 // qty and profit need separate aggregation from sale_items
 const totals = db.prepare(`
  SELECT COALESCE(SUM(si.quantity),0) total_qty,
      COALESCE(SUM(si.cost_at_sale * si.quantity),0) total_cost,
      COALESCE(SUM(si.total - si.cost_at_sale * si.quantity),0) total_profit
  FROM sale_items si JOIN sales s ON s.id = si.sale_id
  WHERE date(s.sale_date) BETWEEN date(?) AND date(?) ${cashierFilter}
 `).get(...params);

 const perProduct = db.prepare(`
  SELECT p.id, p.name, p.sku, COALESCE(c.name,'Uncategorized') category,
      SUM(si.quantity) qty, SUM(si.total) revenue,
      SUM(si.cost_at_sale * si.quantity) cost,
      SUM(si.total - si.cost_at_sale * si.quantity) profit,
      COUNT(DISTINCT s.id) transactions
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  JOIN products p ON p.id = si.product_id
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE date(s.sale_date) BETWEEN date(?) AND date(?) ${cashierFilter}
  GROUP BY p.id ORDER BY revenue DESC
 `).all(...params);

 const perCashier = cashierId ? [] : (() => {
  const rows = db.prepare(`
   SELECT u.id, u.name, o.name AS office, COUNT(s.id) sales_count,
       COALESCE(SUM(s.total),0) total
   FROM users u
   JOIN roles r ON r.id = u.role_id
   LEFT JOIN sales s ON s.created_by = u.id AND date(s.sale_date) BETWEEN date(?) AND date(?)
   LEFT JOIN offices o ON o.id = u.office_id
   WHERE r.name IN ('cashier','clerk','manager','admin')
   GROUP BY u.id ORDER BY total DESC, u.id
  `).all(from, to);
  const items = db.prepare(`
   SELECT s.created_by AS id, COALESCE(SUM(si.quantity),0) qty,
       COALESCE(SUM(si.total - si.cost_at_sale * si.quantity),0) profit
   FROM sale_items si JOIN sales s ON s.id = si.sale_id
   WHERE date(s.sale_date) BETWEEN date(?) AND date(?) GROUP BY s.created_by
  `).all(from, to);
  const byId = Object.fromEntries(items.map((r) => [r.id, r]));
  return rows.map((r) => ({ ...r, qty: Number(byId[r.id]?.qty || 0), profit: Number(byId[r.id]?.profit || 0) }));
 })();

 const salesDetail = db.prepare(`
  SELECT s.id, s.invoice_number, s.sale_date, s.total, s.paid_amount, s.payment_status, s.payment_method,
      s.discount, s.tax, c.name AS customer_name, u.name AS cashier_name, o.name AS office
  FROM sales s
  LEFT JOIN customers c ON c.id = s.customer_id
  LEFT JOIN users u ON u.id = s.created_by
  LEFT JOIN offices o ON o.id = u.office_id
  WHERE date(s.sale_date) BETWEEN date(?) AND date(?) ${cashierFilter}
  ORDER BY s.sale_date DESC, s.id DESC LIMIT 200
 `).all(...params);

 // attach items for each sale (for the detail drill-down, limit to avoid huge payload)
 const saleIds = salesDetail.map((s) => s.id);
 let itemsBySale = {};
 if (saleIds.length) {
  const items = db.prepare(`
   SELECT si.sale_id, p.name, p.sku, si.quantity, si.unit_price, si.total, si.discount
   FROM sale_items si JOIN products p ON p.id = si.product_id
   WHERE si.sale_id IN (${saleIds.map(() => '?').join(',')}) ORDER BY si.sale_id, si.id
  `).all(...saleIds);
  for (const it of items) {
   if (!itemsBySale[it.sale_id]) itemsBySale[it.sale_id] = [];
   itemsBySale[it.sale_id].push(it);
  }
 }

 res.json({
  range: { from, to, cashier_id: cashierId },
  summary: {
   sales_count: summary.sales_count || 0,
   total_revenue: summary.total_revenue || 0,
   total_paid: summary.total_paid || 0,
   outstanding: summary.outstanding || 0,
   distinct_products: distinctProducts.c || 0,
   total_qty: totals.total_qty || 0,
   total_cost: totals.total_cost || 0,
   total_profit: totals.total_profit || 0,
  },
  perCashier,
  perProduct,
  sales: salesDetail.map((s) => ({ ...s, items: itemsBySale[s.id] || [] })),
 });
});

router.get('/supplier-balances', requireRole('manager', 'admin'), (req, res) => {
 res.json(db.prepare(`
  SELECT s.id, s.name, s.phone, s.balance,
   (SELECT COALESCE(SUM(pu.total - pu.paid_amount),0) FROM purchases pu WHERE pu.supplier_id=s.id AND pu.payment_status != 'paid') outstanding
  FROM suppliers s ORDER BY outstanding DESC
 `).all());
});

router.get('/customer-credit', requireRole('manager', 'admin'), (req, res) => {
 res.json(db.prepare(`
  SELECT c.id, c.name, c.phone, c.balance, c.credit_limit,
   (SELECT COALESCE(SUM(s.total - s.paid_amount),0) FROM sales s WHERE s.customer_id=c.id AND s.payment_status != 'paid') outstanding
  FROM customers c WHERE c.balance > 0 OR c.credit_limit > 0 ORDER BY outstanding DESC
 `).all());
});

module.exports = router;