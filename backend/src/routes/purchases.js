const express = require('express');
const { db, audit, transact } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

function purchaseSelect(extra) {
 return `
  SELECT pu.*, s.name AS supplier_name, u.name AS created_by_name
  FROM purchases pu
  LEFT JOIN suppliers s ON s.id = pu.supplier_id
  LEFT JOIN users u ON u.id = pu.created_by
  ${extra || ''}`;
}

function applyPayment(purchaseId, amount, method, userId, notes) {
 if (!amount || amount <= 0) return;
 const purchase = db.prepare('SELECT * FROM purchases WHERE id=?').get(purchaseId);
 if (!purchase) return;
 const remaining = purchase.total - purchase.paid_amount;
 const pay = Math.min(amount, Math.max(remaining, 0));
 db.prepare('UPDATE purchases SET paid_amount = paid_amount + ?, payment_status = CASE WHEN paid_amount + ? >= total THEN \'paid\' ELSE \'partial\' END WHERE id=?')
  .run(pay, pay, purchaseId);
 if (purchase.supplier_id) {
  db.prepare('UPDATE suppliers SET balance = balance - ? WHERE id=?').run(pay, purchase.supplier_id);
 }
 db.prepare(`
  INSERT INTO payments (customer_id, supplier_id, sale_id, purchase_id, amount, payment_method, notes, created_by)
  VALUES (NULL, ?, NULL, ?, ?, ?, ?, ?)
 `).run(purchase.supplier_id || null, purchaseId, pay, method || 'cash', notes || null, userId);
 audit(userId, 'PAYMENT', 'purchase', purchaseId, { amount: pay, method });
}

router.get('/', (req, res) => {
 const { supplier_id, status, from, to } = req.query;
 const conds = [];
 const params = [];
 if (supplier_id) { conds.push('pu.supplier_id = ?'); params.push(supplier_id); }
 if (status === 'outstanding') { conds.push('pu.payment_status != \'paid\''); }
 else if (status) { conds.push('pu.payment_status = ?'); params.push(status); }
 if (from && to) { conds.push('date(pu.purchase_date) BETWEEN date(?) AND date(?)'); params.push(from, to); }
 const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
 const rows = db.prepare(purchaseSelect(where + ' ORDER BY pu.purchase_date DESC, pu.id DESC')).all(...params);
 res.json(rows);
});

router.get('/:id', (req, res) => {
 const purchase = db.prepare(purchaseSelect('WHERE pu.id = ?')).get(req.params.id);
 if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
 const items = db.prepare(`
  SELECT pi.*, p.name AS product_name, p.sku, p.unit
  FROM purchase_items pi JOIN products p ON p.id = pi.product_id WHERE pi.purchase_id = ? ORDER BY pi.id
 `).all(req.params.id);
 const payments = db.prepare('SELECT * FROM payments WHERE purchase_id = ? ORDER BY payment_date DESC').all(req.params.id);
 purchase.items = items;
 purchase.payments = payments;
 res.json(purchase);
});

router.post('/', requireRole('clerk', 'cashier', 'manager', 'admin'), (req, res) => {
 const { supplier_id, invoice_number, purchase_date, items, paid_amount, payment_method, discount, notes } = req.body;
 if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Purchase must include items' });

 const allowNegative = db.prepare(`SELECT value FROM settings WHERE key='allow_negative_stock'`).get()?.value === '1';

 const created = transact(() => {
  let subtotal = 0;
  let tax = 0;
  const prepared = items.map((it) => {
   const qty = Number(it.quantity) || 0;
   const cost = Number(it.unit_cost) || 0;
   if (qty <= 0 || cost < 0) throw new Error('Invalid quantity or cost');
   const product = db.prepare('SELECT * FROM products WHERE id=?').get(it.product_id);
   if (!product) throw new Error(`Product ${it.product_id} not found`);
   const lineTotal = qty * cost;
   subtotal += lineTotal;
   const rate = Number(it.tax_rate) || Number(product.tax_rate) || 0;
   tax += lineTotal * (rate / 100);
   return { ...it, qty, cost, lineTotal, tax_rate: rate };
  });
  const discountVal = Number(discount) || 0;
  const total = subtotal + tax - discountVal;

  const info = db.prepare(`
   INSERT INTO purchases (supplier_id, invoice_number, purchase_date, subtotal, discount, tax, total,
    paid_amount, payment_status, notes, created_by)
   VALUES (?,?,?,?,?,?,?,0,'unpaid',?,?)
  `).run(
   supplier_id || null, invoice_number || null, purchase_date || new Date().toISOString(),
   subtotal, discountVal, tax, total, notes || null, req.user.id
  );
  const purchaseId = Number(info.lastInsertRowid);

  const insItem = db.prepare('INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, total) VALUES (?,?,?,?,?)');
  const updStock = db.prepare('UPDATE products SET current_stock = current_stock + ?, purchase_price = CASE WHEN ? > 0 THEN ? ELSE purchase_price END WHERE id=?');
  const insMove = db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by) VALUES (?,?,?,?,?,?)');

  if (supplier_id) {
   db.prepare('UPDATE suppliers SET balance = balance + ? WHERE id=?').run(total, supplier_id);
  }

  for (const it of prepared) {
   insItem.run(purchaseId, it.product_id, it.qty, it.cost, it.lineTotal);
   updStock.run(it.qty, it.cost, it.cost, it.product_id);
   insMove.run(it.product_id, 'in', it.qty, purchaseId, `Purchase #${purchaseId}`, req.user.id);
  }

  if (paid_amount && Number(paid_amount) > 0) {
   applyPayment(purchaseId, Number(paid_amount), payment_method, req.user.id, 'Payment on purchase');
  }
  audit(req.user.id, 'CREATE', 'purchase', purchaseId, { total, supplier_id });
  return purchaseId;
 });

 res.status(201).json({ id: created });
});

router.post('/:id/payment', requireRole('cashier', 'clerk', 'manager', 'admin'), (req, res) => {
 const { amount, method, notes } = req.body;
 const purchase = db.prepare('SELECT * FROM purchases WHERE id=?').get(req.params.id);
 if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
 const remaining = purchase.total - purchase.paid_amount;
 if (remaining <= 0) return res.status(400).json({ error: 'Purchase is already fully paid' });
 transact(() => applyPayment(Number(req.params.id), Number(amount), method, req.user.id, notes));
 res.json({ ok: true, remaining: Math.max(purchase.total - purchase.paid_amount - Number(amount), 0) });
});

router.post('/:id/return', requireRole('manager', 'admin'), (req, res) => {
 const { items, reason, refund } = req.body;
 const purchase = db.prepare('SELECT * FROM purchases WHERE id=?').get(req.params.id);
 if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
 if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No items to return' });

 const created = transact(() => {
  const info = db.prepare(`
   INSERT INTO purchase_returns (purchase_id, reason, refund_amount, created_by)
   VALUES (?,?,?,?)
  `).run(req.params.id, reason || null, refund || 0, req.user.id);
  const returnId = Number(info.lastInsertRowid);
  const insItem = db.prepare('INSERT INTO purchase_return_items (return_id, purchase_item_id, product_id, quantity, unit_cost, total) VALUES (?,?,?,?,?,?)');
  const updStock = db.prepare('UPDATE products SET current_stock = current_stock - ? WHERE id=?');
  const insMove = db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by) VALUES (?,?,?,?,?,?)');
  for (const it of items) {
   const pi = db.prepare('SELECT * FROM purchase_items WHERE id=? AND purchase_id=?').get(it.purchase_item_id, req.params.id);
   if (!pi) throw new Error('Invalid purchase item');
   if (it.quantity > pi.quantity) throw new Error('Return quantity exceeds purchased quantity');
   insItem.run(returnId, pi.id, pi.product_id, it.quantity, pi.unit_cost, it.quantity * pi.unit_cost);
   updStock.run(it.quantity, pi.product_id);
   insMove.run(pi.product_id, 'out', it.quantity, `PR${returnId}`, `Purchase return on purchase #${purchase.id}`, req.user.id);
   db.prepare('UPDATE purchase_items SET quantity = quantity - ?, total = total - ? WHERE id=?').run(it.quantity, it.quantity * pi.unit_cost, pi.id);
  }
  const refundVal = Number(refund) || 0;
  if (purchase.supplier_id) db.prepare('UPDATE suppliers SET balance = balance + ? WHERE id=?').run(refundVal, purchase.supplier_id);
  if (refundVal > 0) {
   db.prepare('INSERT INTO payments (customer_id, supplier_id, sale_id, purchase_id, amount, payment_method, notes, created_by) VALUES (NULL,?,NULL,?,?,?,?,?)')
    .run(purchase.supplier_id || null, req.params.id, refundVal, 'cash', 'Supplier refund for purchase return', req.user.id);
  }
  audit(req.user.id, 'RETURN', 'purchase', Number(req.params.id), { return_id: returnId, refund: refundVal });
  return returnId;
 });

 res.status(201).json({ id: created });
});

module.exports = router;