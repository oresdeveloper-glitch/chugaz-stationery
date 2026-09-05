const express = require('express');
const { db, audit, transact } = require('../db');
const { requireRole } = require('../auth');
const u = require('../units');

const router = express.Router();

router.use(requireRole('clerk', 'cashier', 'manager', 'admin'));

const STATUSES = ['pending', 'confirmed', 'processing', 'ready_for_pickup', 'out_for_delivery', 'completed', 'cancelled', 'rejected', 'returned', 'refunded'];

function logHistory(orderId, from, to, action, user, notes) {
 try {
  db.prepare(`INSERT INTO order_status_history (order_id, from_status, to_status, action, changed_by, changed_by_name, changed_by_role, office_id, office_name, notes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
   .run(orderId, from || null, to || null, action, user.id, user.name, user.role, user.office_id || null, user.office || null, notes || null);
 } catch {}
}

function getOrder(id) {
 const order = db.prepare(`
  SELECT o.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone, u.credit_limit, u.balance AS user_balance,
   a.recipient_name AS addr_recipient, a.phone AS addr_phone, a.address AS addr_address, a.city AS addr_city,
   (SELECT COALESCE(SUM(amount),0) FROM order_payments op WHERE op.order_id=o.id AND op.payment_status='paid') AS paid_amount
  FROM orders o
  LEFT JOIN users u ON u.id = o.user_id
  LEFT JOIN customer_addresses a ON a.id = o.delivery_address_id
  WHERE o.id = ?
 `).get(id);
 if (!order) return null;
 order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id);
 order.payments = db.prepare('SELECT * FROM order_payments WHERE order_id = ? ORDER BY created_at').all(id);
 order.returns = db.prepare(`
  SELECT r.*, u.name AS processed_by_name FROM order_returns r LEFT JOIN users u ON u.id=r.processed_by
  WHERE r.order_id = ? ORDER BY r.created_at
 `).all(id);
 order.history = db.prepare(`
  SELECT h.*, u.name AS changed_by_name2, u.email AS changed_by_email, o.name AS office_name2
  FROM order_status_history h
  LEFT JOIN users u ON u.id = h.changed_by
  LEFT JOIN offices o ON o.id = h.office_id
  WHERE h.order_id = ? ORDER BY h.created_at ASC, h.id ASC
 `).all(id);
 // normalise names
 order.history = order.history.map(h => ({
  ...h,
  changed_by_name: h.changed_by_name || h.changed_by_name2,
  office_name: h.office_name || h.office_name2,
 }));
 return order;
}

function releaseReservation(order) {
 const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
 const release = db.prepare('UPDATE products SET reserved_stock = reserved_stock - ? WHERE id=?');
 for (const i of items) {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(i.product_id);
  if (!p) continue;
  const pieces = u.piecesWanted(i.quantity, i.unit, p);
  release.run(u.baseUnitsFromPieces(pieces, p), i.product_id);
 }
}

function deductStock(order, userId) {
 const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
 const dec = db.prepare('UPDATE products SET current_stock = current_stock - ?, reserved_stock = reserved_stock - ? WHERE id=?');
 const move = db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by) VALUES (?,?,?,?,?,?)');
 for (const i of items) {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(i.product_id);
  if (!p) throw new Error(`Product missing for ${i.product_name}`);
  const baseNeeded = u.baseUnitsFromPieces(u.piecesWanted(i.quantity, i.unit, p), p);
  if (p.current_stock < baseNeeded) throw new Error(`Insufficient stock for ${i.product_name}`);
  dec.run(baseNeeded, baseNeeded, i.product_id);
  move.run(i.product_id, 'out', baseNeeded, `ORD${order.id}`, `Online order ${order.order_number} confirmed`, userId);
 }
}

// ---- stats for the staff dashboard tabs ----
router.get('/stats', (req, res) => {
 const rows = db.prepare('SELECT order_status, COUNT(*) c FROM orders GROUP BY order_status').all();
 const byStatus = {};
 rows.forEach((r) => (byStatus[r.order_status] = r.c));
 res.json({
  pending: byStatus.pending || 0,
  confirmed: byStatus.confirmed || 0,
  processing: byStatus.processing || 0,
  ready_for_pickup: byStatus.ready_for_pickup || 0,
  out_for_delivery: byStatus.out_for_delivery || 0,
  completed: byStatus.completed || 0,
  cancelled: byStatus.cancelled || 0,
  rejected: byStatus.rejected || 0,
  returned: byStatus.returned || 0,
  unpaid: db.prepare("SELECT COUNT(*) c FROM orders WHERE payment_status='unpaid'").get().c,
  paid: db.prepare("SELECT COUNT(*) c FROM orders WHERE payment_status='paid'").get().c,
 });
});

// ---- list ----
router.get('/', (req, res) => {
 const { status, payment_status, q } = req.query;
 const conds = [];
 const params = [];
 if (status) { conds.push('o.order_status = ?'); params.push(status); }
 if (payment_status) { conds.push('o.payment_status = ?'); params.push(payment_status); }
 if (q) { conds.push('(o.order_number LIKE ? OR u.name LIKE ? OR u.email LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
 const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
 const orders = db.prepare(`
  SELECT o.*, u.name AS user_name,
   (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS items,
   (SELECT COALESCE(SUM(amount),0) FROM order_payments op WHERE op.order_id=o.id AND op.payment_status='paid') AS paid_amount,
   (SELECT COUNT(*) FROM order_returns r WHERE r.order_id=o.id AND r.status='requested') AS return_requests,
   (SELECT h.changed_by_name || ' (' || h.changed_by_role || COALESCE(' · ' || h.office_name, '') || ')' FROM order_status_history h WHERE h.order_id=o.id ORDER BY h.created_at DESC, h.id DESC LIMIT 1) AS last_handler,
   (SELECT h.to_status FROM order_status_history h WHERE h.order_id=o.id ORDER BY h.created_at DESC, h.id DESC LIMIT 1) AS last_action
  FROM orders o LEFT JOIN users u ON u.id = o.user_id
  ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT 300
 `).all(...params);
 res.json(orders);
});

router.get('/:id', (req, res) => {
 const order = getOrder(req.params.id);
 if (!order) return res.status(404).json({ error: 'Order not found' });
 res.json(order);
});

router.get('/:id/history', (req, res) => {
 const order = db.prepare('SELECT id FROM orders WHERE id=?').get(req.params.id);
 if (!order) return res.status(404).json({ error: 'Order not found' });
 const history = db.prepare(`
  SELECT h.*, u.name AS changed_by_name2, u.email AS changed_by_email, o.name AS office_name2
  FROM order_status_history h
  LEFT JOIN users u ON u.id = h.changed_by
  LEFT JOIN offices o ON o.id = h.office_id
  WHERE h.order_id = ? ORDER BY h.created_at ASC, h.id ASC
 `).all(req.params.id).map(h=> ({...h, changed_by_name: h.changed_by_name || h.changed_by_name2, office_name: h.office_name || h.office_name2 }));
 res.json(history);
});

// ---- update status (with stock side-effects) ----
router.put('/:id/status', (req, res) => {
 const { status } = req.body;
 if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
 const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
 if (!order) return res.status(404).json({ error: 'Order not found' });

 if (status === order.order_status) return res.json(getOrder(order.id));

 transact(() => {
  // Deduct stock when confirming a pending order
  if (status === 'confirmed' && ['pending', 'rejected', 'cancelled'].includes(order.order_status)) {
   deductStock(order, req.user.id);
  }
  // Releasing reservation when cancelled / rejected while still reserved
  if (['cancelled', 'rejected'].includes(status) && ['pending', 'confirmed', 'processing', 'ready_for_pickup', 'out_for_delivery'].includes(order.order_status)) {
   releaseReservation(order);
   if (order.payment_method === 'credit' && status === 'cancelled') {
    db.prepare('UPDATE users SET balance = balance - ? WHERE id=?').run(order.total, order.user_id);
   }
  }
  db.prepare("UPDATE orders SET order_status=?, updated_at=datetime('now') WHERE id=?").run(status, order.id);
  logHistory(order.id, order.order_status, status, 'status_change', req.user, null);
  audit(req.user.id, 'ORDER_STATUS', 'order', Number(order.id), { from: order.order_status, to: status, by: req.user.name, role: req.user.role, office: req.user.office });
 });
 res.json(getOrder(order.id));
});

// ---- reject (with reason) ----
router.post('/:id/reject', (req, res) => {
 const { reason } = req.body;
 const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
 if (!order) return res.status(404).json({ error: 'Order not found' });
 if (order.order_status !== 'pending') return res.status(400).json({ error: 'Only pending orders can be rejected' });
 transact(() => {
  releaseReservation(order);
  if (order.payment_method === 'credit') db.prepare('UPDATE users SET balance = balance - ? WHERE id=?').run(order.total, order.user_id);
  db.prepare("UPDATE orders SET order_status='rejected', notes = CASE WHEN notes IS NULL THEN ? ELSE notes || ' | ' || ? END, updated_at=datetime('now') WHERE id=?")
   .run(reason ? `Rejected: ${reason}` : 'Rejected', reason ? `Rejected: ${reason}` : 'Rejected', order.id);
  logHistory(order.id, order.order_status, 'rejected', 'reject', req.user, reason || null);
  audit(req.user.id, 'REJECT_ORDER', 'order', Number(order.id), { reason: reason || null, by: req.user.name, role: req.user.role, office: req.user.office });
 });
 res.json(getOrder(order.id));
});

// ---- approve a return request (restores stock + refund) ----
router.post('/:id/returns/:returnId/approve', (req, res) => {
 const { refund_amount } = req.body;
 const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
 const ret = db.prepare('SELECT * FROM order_returns WHERE id=? AND order_id=?').get(req.params.returnId, req.params.id);
 if (!order || !ret) return res.status(404).json({ error: 'Return request not found' });
 if (ret.status !== 'requested') return res.status(400).json({ error: 'Return already processed' });

 const refund = refund_amount !== undefined ? Math.round((Number(refund_amount) || 0) * 100) / 100 : 0;
 if (refund < 0) return res.status(400).json({ error: 'Invalid refund amount' });
 if (refund > 0) {
  const paid = Number(db.prepare("SELECT COALESCE(SUM(amount),0) s FROM order_payments WHERE order_id=? AND payment_status='paid'").get(order.id).s);
  if (refund > paid + 0.001) return res.status(400).json({ error: `Refund exceeds amount paid (${paid.toFixed(2)})` });
  if (!['manager', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Refunds require manager or admin approval' });
 }

 transact(() => {
  // restore stock
  let items;
  try { items = JSON.parse(ret.items || '[]'); } catch { items = []; }
  const inc = db.prepare('UPDATE products SET current_stock = current_stock + ? WHERE id=?');
  const move = db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by) VALUES (?,?,?,?,?,?)');
  for (const i of items) {
   const p = db.prepare('SELECT * FROM products WHERE id=?').get(i.product_id);
   const baseQty = p ? u.baseUnitsFromPieces(u.piecesWanted(i.quantity, i.unit, p), p) : Number(i.quantity) || 0;
   inc.run(baseQty, i.product_id);
   move.run(i.product_id, 'in', baseQty, `RET${ret.id}`, `Return for order ${order.order_number}`, req.user.id);
  }
  // record refund as negative payment
  if (refund > 0) {
   db.prepare("INSERT INTO order_payments (order_id, payment_method, transaction_reference, amount, payment_status, paid_at) VALUES (?, 'refund', ?, ?, 'paid', datetime('now'))")
    .run(order.id, `RETURN-${ret.id}`, -refund);
  }
  db.prepare("UPDATE order_returns SET status='approved', refund_amount=?, processed_by=?, processed_at=datetime('now') WHERE id=?")
   .run(refund, req.user.id, ret.id);
  db.prepare("UPDATE orders SET order_status='returned', updated_at=datetime('now') WHERE id=?").run(order.id);
  if (refund > 0) db.prepare("UPDATE orders SET payment_status = CASE WHEN ? >= COALESCE((SELECT SUM(amount) FROM order_payments WHERE order_id=? AND payment_status='paid'),0) THEN 'refunded' ELSE 'partial_refund' END WHERE id=?")
   .run(refund, order.id, order.id);
  logHistory(order.id, order.order_status, 'returned', 'approve_return', req.user, `refund ${refund}`);
  audit(req.user.id, 'APPROVE_RETURN', 'order', Number(order.id), { return_id: ret.id, refund, by: req.user.name, role: req.user.role, office: req.user.office });
 });
 res.json(getOrder(order.id));
});

// ---- verify a customer-submitted payment (money confirmed received) — also handles COD ----
router.post('/:id/verify-payment', requireRole('cashier', 'clerk', 'manager', 'admin'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const pending = db.prepare("SELECT COUNT(*) c FROM order_payments WHERE order_id=? AND payment_status='pending'").get(order.id).c;
  const isCOD = order.payment_method === 'cash_on_delivery';
  if (!pending && !(isCOD && order.payment_status === 'unpaid')) return res.status(400).json({ error: 'No payment awaiting verification' });
  transact(() => {
    if (pending) {
      db.prepare("UPDATE order_payments SET payment_status='paid', paid_at=datetime('now') WHERE order_id=? AND payment_status='pending'").run(order.id);
    } else if (isCOD) {
      // COD had no pending row (edge case) — mark existing as paid
      db.prepare("UPDATE order_payments SET payment_status='paid', paid_at=datetime('now') WHERE order_id=?").run(order.id);
    }
    db.prepare("UPDATE orders SET payment_status='paid', updated_at=datetime('now') WHERE id=?").run(order.id);
    // For COD, auto-complete the order when cash is confirmed at pickup/delivery
    if (isCOD && ['ready_for_pickup','out_for_delivery'].includes(order.order_status)) {
      db.prepare("UPDATE orders SET order_status='completed', updated_at=datetime('now') WHERE id=?").run(order.id);
      logHistory(order.id, order.order_status, 'completed', 'verify_cod_complete', req.user, 'COD cash received');
    }
    logHistory(order.id, order.payment_status, 'paid', isCOD ? 'verify_cod' : 'verify_payment', req.user, order.payment_method);
    audit(req.user.id, isCOD ? 'VERIFY_COD' : 'VERIFY_PAYMENT', 'order', Number(order.id), { method: order.payment_method, total: order.total, by: req.user.name, role: req.user.role, office: req.user.office });
  });
  res.json(getOrder(order.id));
});

// ---- refund (for cancelled/paid orders) — manager/admin only ----
router.post('/:id/refund', requireRole('manager', 'admin'), (req, res) => {
 const { amount } = req.body;
 const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
 if (!order) return res.status(404).json({ error: 'Order not found' });
 const refund = Math.round((Number(amount) || 0) * 100) / 100;
 if (refund <= 0) return res.status(400).json({ error: 'Refund amount required' });
 const paid = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM order_payments WHERE order_id=? AND payment_status='paid'").get(order.id).s;
 if (refund > paid + 0.001) return res.status(400).json({ error: `Refund exceeds amount paid (${Number(paid).toFixed(2)})` });

 transact(() => {
  db.prepare("INSERT INTO order_payments (order_id, payment_method, transaction_reference, amount, payment_status, paid_at) VALUES (?, 'refund', ?, ?, 'paid', datetime('now'))")
   .run(order.id, `REFUND-${Date.now()}`, -refund);
  db.prepare("UPDATE orders SET payment_status = CASE WHEN ? >= COALESCE((SELECT SUM(amount) FROM order_payments WHERE order_id=? AND payment_status='paid'),0) THEN 'refunded' ELSE 'partial_refund' END, updated_at=datetime('now') WHERE id=?")
   .run(refund, order.id, order.id);
  logHistory(order.id, order.payment_status, 'refunded', 'refund', req.user, `amount ${refund}`);
  audit(req.user.id, 'REFUND', 'order', Number(order.id), { amount: refund, by: req.user.name, role: req.user.role, office: req.user.office });
 });
 res.json(getOrder(order.id));
});

// ---- global search (products, orders, customers, suppliers) ----
function withUnits(row) {
 if (!row) return row;
 try { row.unit_prices = row.unit_prices ? JSON.parse(row.unit_prices) : {}; } catch { row.unit_prices = {}; }
 row.units = u.unitsFor(row).map((x) => ({ ...x, price: u.unitPrice(x.id, row) }));
 row.piece_price = u.piecePrice(row);
 return row;
}
router.get('/search/global', (req, res) => {
 const q = String(req.query.q || '').trim();
 if (!q) return res.json({ products: [], orders: [], customers: [], suppliers: [] });
 const like = `%${q}%`;
 const products = db.prepare(`
  SELECT id, sku, barcode, name, unit, purchase_price, selling_price, current_stock, unit_prices, parent_id
  FROM products WHERE parent_id IS NULL AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ?)
  ORDER BY name LIMIT 6
 `).all(like, like, like).map(withUnits);
 if (req.user.role !== 'admin') {
  for (const p of products) delete p.current_stock;
 }
 const orders = db.prepare(`
  SELECT o.id, o.order_number, o.order_status, o.payment_status, o.total, o.order_date, u.name AS user_name
  FROM orders o LEFT JOIN users u ON u.id=o.user_id
  WHERE o.order_number LIKE ? OR u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?
  ORDER BY o.id DESC LIMIT 5
 `).all(like, like, like, like);
 const customers = db.prepare(`
  SELECT id, name, email, phone, address FROM customers
  WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?
  ORDER BY name LIMIT 5
 `).all(like, like, like);
 const suppliers = db.prepare(`
  SELECT id, name, phone, email FROM suppliers
  WHERE name LIKE ? OR phone LIKE ? OR email LIKE ?
  ORDER BY name LIMIT 5
 `).all(like, like, like);
 res.json({ products, orders, customers, suppliers });
});

module.exports = router;