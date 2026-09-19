const express = require('express');
const { db, audit, transact } = require('../db');
const { requireRole } = require('../auth');
const u = require('../units');

const router = express.Router();

const SALE_METHODS = ['cash', 'card', 'mobile_money', 'bank_transfer', 'credit', 'cheque'];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Legitimate unit prices for a product (base price + every defined unit price).
// Used to detect under/overcharging by client-supplied unit_price.
function legitPrices(product) {
 let prices = [Number(product.selling_price) || 0];
 try {
  const up = product.unit_prices ? JSON.parse(product.unit_prices) : {};
  for (const v of Object.values(up)) { const n = Number(v); if (n > 0) prices.push(n); }
 } catch {}
 try {
  const rows = u.unitsFor({ ...product, unit_prices: product.unit_prices ? product.unit_prices : '{}' });
  for (const x of rows) { const p = u.unitPrice(x.id, { ...product, unit_prices: product.unit_prices || '{}' }); if (p > 0) prices.push(Number(p)); }
 } catch {}
 return prices;
}

function saleSelect(extra) {
 return `
  SELECT s.*, c.name AS customer_name, u.name AS created_by_name,
   (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS items
  FROM sales s
  LEFT JOIN customers c ON c.id = s.customer_id
  LEFT JOIN users u ON u.id = s.created_by
  ${extra || ''}`;
}

function applyPayment(saleId, amount, method, userId, notes, customerId) {
 if (!amount || amount <= 0) return;
 const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(saleId);
 if (!sale) return;
 const remaining = sale.total - sale.paid_amount;
 const pay = Math.min(amount, Math.max(remaining, 0));
 db.prepare("UPDATE sales SET paid_amount = paid_amount + ?, payment_status = CASE WHEN paid_amount + ? >= total THEN 'paid' ELSE 'partial' END WHERE id=?")
  .run(pay, pay, saleId);
 if (customerId) {
  db.prepare('UPDATE customers SET balance = balance - ? WHERE id=?').run(pay, customerId);
 }
 db.prepare(`
  INSERT INTO payments (customer_id, supplier_id, sale_id, purchase_id, amount, payment_method, notes, created_by)
  VALUES (?, NULL, ?, NULL, ?, ?, ?, ?)
 `).run(customerId || null, saleId, pay, method || 'cash', notes || null, userId);
 audit(userId, 'PAYMENT', 'sale', saleId, { amount: pay, method });
}

router.get('/', requireRole('cashier', 'manager', 'admin'), (req, res) => {
 const { customer_id, status, from, to, q, created_by } = req.query;
 const conds = [];
 const params = [];
 // A cashier (or clerk) may only ever see their own sales; managers/admins can filter by any cashier.
 if (req.user.role === 'cashier' || req.user.role === 'clerk') {
  conds.push('s.created_by = ?');
  params.push(req.user.id);
 } else if (created_by) {
  conds.push('s.created_by = ?');
  params.push(Number(created_by));
 }
 if (customer_id) { conds.push('s.customer_id = ?'); params.push(customer_id); }
 if (status === 'outstanding') { conds.push('s.payment_status != \'paid\''); }
 else if (status) { conds.push('s.payment_status = ?'); params.push(status); }
 if (from && to) { conds.push('date(s.sale_date) BETWEEN date(?) AND date(?)'); params.push(from, to); }
 if (q) { conds.push('(s.invoice_number LIKE ? OR c.name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
 const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
 const rows = db.prepare(saleSelect(where + ' ORDER BY s.sale_date DESC, s.id DESC LIMIT 200')).all(...params);
 res.json(rows);
});

router.get('/:id', requireRole('cashier', 'manager', 'admin'), (req, res) => {
 const sale = db.prepare(saleSelect('WHERE s.id = ?')).get(req.params.id);
 if (!sale) return res.status(404).json({ error: 'Sale not found' });
 const items = db.prepare(`
  SELECT si.*, p.name AS product_name, p.sku, p.barcode, p.unit, p.image
  FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id
 `).all(req.params.id);
 const payments = db.prepare('SELECT * FROM payments WHERE sale_id = ? ORDER BY payment_date DESC').all(req.params.id);
 const returns = db.prepare(`
  SELECT sr.*, u.name AS created_by_name FROM sale_returns sr LEFT JOIN users u ON u.id = sr.created_by
  WHERE sr.sale_id = ? ORDER BY sr.created_at DESC
 `).all(req.params.id);
 sale.items = items;
 sale.payments = payments;
 sale.returns = returns;
 res.json(sale);
});

router.post('/', requireRole('cashier', 'clerk', 'manager', 'admin'), (req, res) => {
 const { customer_id, items, discount, tax_override, payment_method, paid_amount, notes, sale_date } = req.body;
 if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Sale must include items' });
 const method = SALE_METHODS.includes(payment_method) ? payment_method : 'cash';
 const paid = paid_amount === undefined || paid_amount === null || paid_amount === '' ? 0 : Number(paid_amount);
 if (!Number.isFinite(paid) || paid < 0) return res.status(400).json({ error: 'Invalid paid amount' });
 const isManager = ['manager', 'admin'].includes(req.user.role);
 const globalDiscount = Math.min(Math.max(Number(discount) || 0, 0), Number.MAX_SAFE_INTEGER);

 const allowNegative = db.prepare(`SELECT value FROM settings WHERE key='allow_negative_stock'`).get()?.value === '1';

 const invoiceNumber = `INV-${Date.now().toString().slice(-8)}-${Math.round(Math.random() * 99)}`;

 let created;
 try {
  created = transact(() => {
  const cust = customer_id ? db.prepare('SELECT * FROM customers WHERE id=?').get(customer_id) : null;
  let subtotal = 0;
  let totalTax = 0;
  let totalDiscount = 0;

  const prepared = [];
  for (const it of items) {
   const qty = Number(it.quantity) || 0;
   if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be positive');
   const product = db.prepare('SELECT * FROM products WHERE id=?').get(it.product_id);
   if (!product || product.status !== 'active') throw new Error('Product unavailable');

   // Price integrity: client-sent price must sit within the product's legitimate
   // unit price range. Outside that range requires manager/admin.
   let price = Number(product.selling_price) || 0;
   if (it.unit_price !== undefined && it.unit_price !== null && it.unit_price !== '') {
    const wanted = Number(it.unit_price);
    if (!Number.isFinite(wanted) || wanted < 0) throw new Error(`Invalid price for ${product.name}`);
    const legit = legitPrices(product);
    const minLegit = Math.min(...legit) * 0.98;
    const maxLegit = Math.max(...legit) * 1.02;
    if ((wanted < minLegit || wanted > maxLegit) && !isManager) {
     throw new Error(`Price for ${product.name} needs manager approval (sent ${wanted}, expected ${minLegit.toFixed(0)}–${maxLegit.toFixed(0)})`);
    }
    price = wanted;
   }

   const lineDiscount = Math.min(Math.max(Number(it.discount) || 0, 0), 100);
   const rate = tax_override !== undefined ? Math.min(Math.max(Number(tax_override) || 0, 0), 100) : (Number(product.tax_rate) || 0);
   const lineSubtotal = r2(qty * price);
   const discVal = r2(lineSubtotal * (lineDiscount / 100));
   const available = product.current_stock - (product.reserved_stock || 0);

   if (!allowNegative && qty > available) {
    throw new Error(`Insufficient stock for ${product.name} (available: ${available})`);
   }

   subtotal = r2(subtotal + lineSubtotal);
   totalDiscount = r2(totalDiscount + discVal);
   totalTax = r2(totalTax + (lineSubtotal - discVal) * (rate / 100));

   prepared.push({ ...it, qty, price, lineDiscount, rate, lineSubtotal, discVal });
  }

  const totalDiscountAll = r2(Math.min(totalDiscount + globalDiscount, subtotal));
  const total = Math.max(r2(subtotal - totalDiscountAll + totalTax), 0);
  const paidCapped = cust ? Math.min(paid, total) : paid;

  const info = db.prepare(`
   INSERT INTO sales (customer_id, invoice_number, sale_date, subtotal, discount, tax, total,
    paid_amount, payment_method, payment_status, notes, created_by)
   VALUES (?,?,?,?,?,?,?,?,?,'unpaid',?,?)
  `).run(
   customer_id || null, invoiceNumber, sale_date || new Date().toISOString(),
   subtotal, totalDiscount + globalDiscount, totalTax, total,
   0, payment_method || 'cash', notes || null, req.user.id
  );
  const saleId = Number(info.lastInsertRowid);

  const insItem = db.prepare(`
   INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, total, cost_at_sale)
   VALUES (?,?,?,?,?,?,?)
  `);
  for (const it of prepared) {
   insItem.run(saleId, it.product_id, it.qty, it.price, it.lineDiscount, it.lineSubtotal - it.discVal,
    Number(db.prepare('SELECT purchase_price FROM products WHERE id=?').get(it.product_id).purchase_price) || 0);
  }

  const updStock = db.prepare('UPDATE products SET current_stock = current_stock - ? WHERE id=?');
  const insMove = db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by) VALUES (?,?,?,?,?,?)');
  for (const it of items) {
   updStock.run(it.quantity, it.product_id);
   insMove.run(it.product_id, 'out', it.quantity, saleId, `Sale #${saleId}`, req.user.id);
  }

  if (cust && customer_id) {
   const credit = Math.max(total - paidCapped, 0);
   db.prepare('UPDATE customers SET balance = balance + ? WHERE id=?').run(credit, customer_id);
  }

  if (paidCapped > 0) {
   applyPayment(saleId, paidCapped, method, req.user.id, 'Payment on sale', customer_id);
  } else {
   db.prepare("UPDATE sales SET payment_status = CASE WHEN total <= 0 THEN 'paid' ELSE 'unpaid' END WHERE id=?").run(saleId);
  }

  audit(req.user.id, 'CREATE', 'sale', saleId, { total, customer_id, invoice_number: invoiceNumber, method });
  return { id: saleId, invoice_number: invoiceNumber };
  });
 } catch (e) {
  return res.status(400).json({ error: e.message });
 }

 res.status(201).json(created);
});

router.post('/:id/payment', requireRole('cashier', 'clerk', 'manager', 'admin'), (req, res) => {
 const { amount, method, notes } = req.body;
 const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(req.params.id);
 if (!sale) return res.status(404).json({ error: 'Sale not found' });
 const amt = Number(amount);
 if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Payment amount must be greater than zero' });
 const remaining = r2(sale.total - sale.paid_amount);
 if (remaining <= 0) return res.status(400).json({ error: 'Sale is already fully paid' });
 if (amt > remaining + 0.001) return res.status(400).json({ error: `Amount exceeds outstanding balance (${remaining.toFixed(2)})` });
 const m = SALE_METHODS.includes(method) ? method : 'cash';
 const cleanNotes = notes ? String(notes).slice(0, 200) : null;
 transact(() => applyPayment(Number(req.params.id), amt, m, req.user.id, cleanNotes, sale.customer_id));
 audit(req.user.id, 'RECORD_PAYMENT', 'sale', Number(req.params.id), { amount: amt, method: m });
 res.json({ ok: true, paid_amount: r2(sale.paid_amount + Math.min(amt, remaining)) });
});

router.post('/:id/return', requireRole('cashier', 'clerk', 'manager', 'admin'), (req, res) => {
 const { items, reason } = req.body;
 const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(req.params.id);
 if (!sale) return res.status(404).json({ error: 'Sale not found' });
 if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No items to return' });

 const created = transact(() => {
  const info = db.prepare('INSERT INTO sale_returns (sale_id, reason, created_by) VALUES (?,?,?)').run(req.params.id, reason || null, req.user.id);
  const returnId = Number(info.lastInsertRowid);
  const insItem = db.prepare('INSERT INTO sale_return_items (return_id, sale_item_id, product_id, quantity, unit_price, total) VALUES (?,?,?,?,?,?)');
  const updStock = db.prepare('UPDATE products SET current_stock = current_stock + ? WHERE id=?');
  const insMove = db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by) VALUES (?,?,?,?,?,?)');
  let refundAmount = 0;

  for (const it of items) {
   const si = db.prepare('SELECT * FROM sale_items WHERE id=? AND sale_id=?').get(it.sale_item_id, req.params.id);
   if (!si) throw new Error('Invalid sale item');
   const returned = db.prepare('SELECT COALESCE(SUM(quantity),0) s FROM sale_return_items WHERE sale_item_id=?').get(si.id).s;
   const remaining = si.quantity - returned;
   if (it.quantity > remaining) throw new Error('Return quantity exceeds returned-eligible quantity');
   const amt = it.quantity * si.unit_price * (1 - (si.discount || 0) / 100);
   refundAmount += amt;
   insItem.run(returnId, si.id, si.product_id, it.quantity, si.unit_price, amt);
   updStock.run(it.quantity, si.product_id);
   insMove.run(si.product_id, 'in', it.quantity, `SR${returnId}`, `Sale return on sale #${sale.id}`, req.user.id);
  }

  db.prepare('UPDATE sale_returns SET refund_amount=? WHERE id=?').run(refundAmount, returnId);
  if (sale.customer_id) {
   db.prepare('UPDATE customers SET balance = balance - ? WHERE id=?').run(refundAmount, sale.customer_id);
  }
  // Reverse payment against the sale and record refund as negative payment
  const refund = Math.min(refundAmount, sale.paid_amount);
  db.prepare('UPDATE sales SET paid_amount = paid_amount - ?, payment_status = CASE WHEN paid_amount - ? >= total THEN \'paid\' WHEN paid_amount - ? <= 0 THEN \'unpaid\' ELSE \'partial\' END WHERE id=?')
   .run(refund, refund, refund, req.params.id);
  db.prepare('INSERT INTO payments (customer_id, supplier_id, sale_id, purchase_id, amount, payment_method, notes, created_by) VALUES (?,NULL,?,NULL,?,?,?,?)')
   .run(sale.customer_id || null, req.params.id, -refund, 'refund', `Refund for return #${returnId}`, req.user.id);

  audit(req.user.id, 'RETURN', 'sale', Number(req.params.id), { return_id: returnId, refund: refundAmount });
  return { id: returnId, refund_amount: refundAmount };
 });

 res.status(201).json(created);
});

module.exports = router;