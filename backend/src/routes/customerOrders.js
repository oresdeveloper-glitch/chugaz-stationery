const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db, audit, transact } = require('../db');
const { requireCustomer } = require('../auth');
const u = require('../units');

const router = express.Router();

// System customer that owns guest-checkout orders (created on demand).
// Guests can order without signing in, so placing an order never depends
// on a session. This row can never log in (random unguessable hash).
const GUEST_EMAIL = 'guest@shop.local';
function ensureGuestUserId() {
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(GUEST_EMAIL);
  if (existing) return Number(existing.id);
  const roleId = db.prepare("SELECT id FROM roles WHERE name='customer'").get();
  if (!roleId) throw new Error('Customer role not configured');
  const hash = bcrypt.hashSync(crypto.randomBytes(48).toString('hex'), 10);
  try {
    const info = db.prepare('INSERT INTO users (name, email, phone, password_hash, role_id, status) VALUES (?,?,?,?,?,?)')
      .run('Guest Checkout', GUEST_EMAIL, null, hash, roleId.id, 'active');
    return Number(info.lastInsertRowid);
  } catch (e) {
    const retry = db.prepare('SELECT id FROM users WHERE email=?').get(GUEST_EMAIL);
    if (retry) return Number(retry.id);
    throw e;
  }
}

function guestId(req) {
  const id = req.get('x-guest-id');
  return id && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

const PAYMENT_METHODS = ['cash_on_delivery', 'pay_at_shop', 'card', 'mobile_money', 'bank_transfer', 'credit'];
const ONLINE_PAID = ['card', 'mobile_money', 'bank_transfer'];

function getOrder(id, userId) {
 const order = db.prepare(`
  SELECT o.*, u.name AS user_name, u.email AS user_email, u.phone AS user_phone,
   a.recipient_name AS addr_recipient, a.phone AS addr_phone, a.address AS addr_address, a.city AS addr_city
  FROM orders o
  LEFT JOIN users u ON u.id = o.user_id
  LEFT JOIN customer_addresses a ON a.id = o.delivery_address_id
  WHERE o.id = ? AND o.user_id = ?
 `).get(id, userId);
 if (!order) return null;
 order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id);
 order.payments = db.prepare('SELECT * FROM order_payments WHERE order_id = ? ORDER BY created_at').all(id);
 order.returns = db.prepare('SELECT * FROM order_returns WHERE order_id = ? ORDER BY created_at').all(id);
 return order;
}

function settings() {
 const rows = db.prepare('SELECT key, value FROM settings').all();
 const s = {};
 rows.forEach((r) => (s[r.key] = r.value));
 return s;
}

// ---- place order from cart (signed-in customers AND guests) ----
router.post('/', (req, res) => {
  const isGuest = !req.user;
  // One connected account system: customers AND staff may order online.
  if (req.user && !['customer', 'admin', 'manager', 'cashier', 'clerk'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Customer account required' });
  }
  if (isGuest && !!String(req.headers.authorization || '').startsWith('Bearer ')) {
    // A token was sent but verifies nowhere (e.g. cold serverless instance):
    // tell the client the session is dead so it can re-authenticate or
    // fall back to guest checkout, instead of failing contact validation.
    return res.status(401).json({ error: 'Session expired - please sign in again' });
  }
  const { fulfillment_type, delivery_address_id, payment_method, transaction_reference, notes,
    guest_name, guest_phone, guest_address, guest_city } = req.body;
  const ft = fulfillment_type === 'pickup' ? 'pickup' : 'delivery';
  const method = PAYMENT_METHODS.includes(payment_method) ? payment_method : 'cash_on_delivery';
  if (method === 'credit' && isGuest) {
    return res.status(400).json({ error: 'Credit purchases require a customer account — please sign in' });
  }
  let gName = null, gPhone = null, gAddr = null, gCity = null;
  if (isGuest) {
    gName = String(guest_name || '').trim().slice(0, 80);
    gPhone = String(guest_phone || '').trim().slice(0, 30);
    if (!gName || !gPhone) return res.status(400).json({ error: 'Please enter your name and phone number' });
    if (ft === 'delivery') {
      gAddr = String(guest_address || '').trim().slice(0, 160);
      gCity = String(guest_city || '').trim().slice(0, 80);
      if (!gAddr || !gCity) return res.status(400).json({ error: 'Please enter your delivery address and city' });
    }
  } else if (ft === 'delivery' && !delivery_address_id) {
    return res.status(400).json({ error: 'Please select a delivery address' });
  }
  // Guests may send their items inline so ordering never depends on which
  // serverless instance holds their cart.
  let guestItems = null;
  if (isGuest && Array.isArray(req.body.items) && req.body.items.length > 0) {
    guestItems = [];
    for (const it of req.body.items.slice(0, 100)) {
      const pid = Number(it && it.product_id);
      const qty = Number(it && it.quantity);
      if (!pid || !(qty > 0)) return res.status(400).json({ error: 'Invalid items in order' });
      guestItems.push({ product_id: pid, quantity: qty });
    }
  }

  const sf = settings();

  let orderUserId;
  const created = transact(() => {
    let user = null;
    if (isGuest) {
      orderUserId = ensureGuestUserId();
    } else {
      user = db.prepare('SELECT * FROM users WHERE id=? AND status=\'active\'').get(req.user.id);
      if (!user) throw new Error('Account is not active');
      orderUserId = user.id;
    }

    let address = null;
    if (ft === 'delivery' && !isGuest) {
      address = db.prepare('SELECT * FROM customer_addresses WHERE id=? AND user_id=?').get(delivery_address_id, req.user.id);
      if (!address) throw new Error('Address not found');
    }

    let cart = null;
    let lines = [];
    if (isGuest && guestItems) {
      for (const it of guestItems) {
        const pr = db.prepare('SELECT id, name, unit, tax_rate, current_stock, reserved_stock, status, selling_price FROM products WHERE id=?').get(it.product_id);
        if (!pr || pr.status !== 'active') throw new Error('An item in your order is no longer available');
        if (!['dozen', 'outer', 'carton'].includes(pr.unit)) throw new Error(`${pr.name} is not available online. Wholesale packs only (dozen, outer, carton).`);
        lines.push({ product_id: pr.id, quantity: it.quantity, cart_unit: pr.unit, product_name: pr.name, product_unit: pr.unit, tax_rate: pr.tax_rate, current_stock: pr.current_stock, reserved_stock: pr.reserved_stock, status: pr.status, selling_price: pr.selling_price, unit_price: 0 });
      }
    } else {
      if (isGuest) {
        const gid = guestId(req);
        if (gid) cart = db.prepare('SELECT * FROM carts WHERE guest_id=?').get(gid);
      } else {
        cart = db.prepare('SELECT * FROM carts WHERE user_id=?').get(req.user.id);
      }
      if (!cart) throw new Error('Your cart is empty');
      lines = db.prepare('SELECT ci.id, ci.product_id, ci.quantity, ci.unit_price, ci.unit AS cart_unit, p.name AS product_name, p.unit AS product_unit, p.tax_rate, p.current_stock, p.reserved_stock, p.status, p.selling_price FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=?').all(cart.id);
    }
    if (lines.length === 0) throw new Error('Your cart is empty');

  let subtotal = 0;
  let tax = 0;
  const prepared = [];
  for (const l of lines) {
   if (l.status !== 'active') throw new Error(`${l.product_name} is no longer available`);
   const productLike = { name: l.product_name, unit: l.product_unit, selling_price: l.selling_price };
   const pieces = u.piecesWanted(l.quantity, l.cart_unit, productLike);
   const baseNeeded = u.baseUnitsFromPieces(pieces, productLike);
   const available = l.current_stock - (l.reserved_stock || 0);
   if (baseNeeded > available) {
    throw new Error(`Insufficient stock for ${l.product_name} (only ${Math.floor(available * u.basePieces(productLike))} pieces available)`);
   }
   // Price integrity: always recompute from the current product price —
   // never trust a stored/client-supplied unit price.
   const unitPrice = u.unitPrice(l.cart_unit, productLike);
   const lineSub = Math.round(Number(l.quantity) * unitPrice * 100) / 100;
   const lineTax = Math.round(lineSub * (Number(l.tax_rate) || 0) / 100 * 100) / 100;
   subtotal += lineSub;
   tax += lineTax;
   prepared.push({ ...l, unit: l.cart_unit, unitPrice, lineSub, lineTax, baseNeeded });
  }

  const deliveryFee = ft === 'pickup' ? 0 : (Number(sf.free_delivery_threshold) > 0 && subtotal >= Number(sf.free_delivery_threshold) ? 0 : (Number(sf.delivery_fee) || 0));
  const discount = 0;
  const total = Math.max(Math.round((subtotal + tax + deliveryFee - discount) * 100) / 100, 0);

  // Online-paid methods need a verifiable reference and go to staff review.
  const needsRef = ['card', 'mobile_money', 'bank_transfer'].includes(method);
  const ref = transaction_reference ? String(transaction_reference).trim().slice(0, 80) : null;
  if (needsRef && (!ref || ref.length < 4)) {
   throw new Error('A valid transaction reference is required for this payment method');
  }
  const cleanNotes = notes ? String(notes).slice(0, 500) : null;

  const contactName = isGuest ? null : (typeof req.body.contact_name === 'string' ? req.body.contact_name.trim().slice(0, 80) : '');
  const contactPhone = isGuest ? null : (typeof req.body.contact_phone === 'string' ? req.body.contact_phone.trim().slice(0, 30) : '');

  if (method === 'credit' && !isGuest) {
    const outstanding = Number(user.balance) + total;
   const limit = Number(user.credit_limit) || 0;
   if (limit <= 0) throw new Error('Credit purchases are not available for your account');
   if (outstanding > limit) throw new Error(`Order exceeds your credit limit (${limit})`);
  }

  const orderNumber = `ORD-${Date.now().toString().slice(-9)}-${Math.round(Math.random() * 89 + 10)}`;
  // Online transfers/cards are 'verifying' until staff confirm the money arrived.
  const initialPayStatus = needsRef ? 'verifying' : (ONLINE_PAID.includes(method) ? 'paid' : 'unpaid');
  const payRowStatus = needsRef ? 'pending' : (ONLINE_PAID.includes(method) ? 'paid' : 'pending');
  const info = db.prepare(`
   INSERT INTO orders (order_number, user_id, order_status, payment_status, fulfillment_type,
    delivery_address_id, shipping_name, shipping_phone, shipping_address, subtotal, discount, tax, delivery_fee, total,
    payment_method, notes)
   VALUES (?,?,'pending',?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
   orderNumber, orderUserId,
   initialPayStatus,
   ft, address ? address.id : null,
   address ? (contactName || address.recipient_name || user.name) : (isGuest ? gName : (contactName || user.name || null)),
   address ? (contactPhone || address.phone || user.phone) : (isGuest ? gPhone : (contactPhone || user.phone || null)),
   address ? `${address.address}, ${address.city}` : (isGuest && ft === 'delivery' ? `${gAddr}, ${gCity}` : null),
   subtotal, discount, tax, deliveryFee, total, method, cleanNotes
  );
  const orderId = Number(info.lastInsertRowid);

  const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, unit, quantity, unit_price, discount, tax, total) VALUES (?,?,?,?,?,?,0,?,?)');
  const reserve = db.prepare('UPDATE products SET reserved_stock = reserved_stock + ? WHERE id=?');
  for (const p of prepared) {
   insItem.run(orderId, p.product_id, p.product_name, p.unit, p.quantity, p.unitPrice, p.lineTax, p.lineSub);
   reserve.run(p.baseNeeded, p.product_id);
  }

  if (cart) db.prepare('DELETE FROM cart_items WHERE cart_id=?').run(cart.id);

  const payStatus = payRowStatus;
  db.prepare('INSERT INTO order_payments (order_id, payment_method, transaction_reference, amount, payment_status, paid_at) VALUES (?,?,?,?,?,?)')
   .run(orderId, method, ref, total, payStatus, payStatus === 'paid' ? new Date().toISOString() : null);

  if (method === 'credit') {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id=?').run(total, orderUserId);
  }

  audit(orderUserId, 'PLACE_ORDER', 'order', orderId, { order_number: orderNumber, total, method, ft, guest: isGuest });
  try { db.prepare(`INSERT INTO order_status_history (order_id, from_status, to_status, action, changed_by, changed_by_name, changed_by_role, office_id, office_name, notes) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(orderId, null, 'pending', 'create', orderUserId, isGuest ? gName : req.user.name, isGuest ? 'customer' : req.user.role, isGuest ? null : (req.user.office_id || null), isGuest ? null : (req.user.office || null), `Order placed ${orderNumber}`); } catch {}
  return orderId;
  });

  res.status(201).json(getOrder(created, orderUserId));
});

// ---- list my orders ----
router.get('/', requireCustomer, (req, res) => {
 const { status } = req.query;
 const conds = ['user_id = ?'];
 const params = [req.user.id];
 if (status) { conds.push('order_status = ?'); params.push(status); }
 const orders = db.prepare(`
  SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS items,
   (SELECT COALESCE(SUM(amount),0) FROM order_payments op WHERE op.order_id=o.id AND op.payment_status='paid') AS paid_amount
  FROM orders o WHERE ${conds.join(' AND ')} ORDER BY o.created_at DESC, o.id DESC LIMIT 200
 `).all(...params);
 res.json(orders);
});

// ---- order detail ----
router.get('/:id', requireCustomer, (req, res) => {
 const order = getOrder(req.params.id, req.user.id);
 if (!order) return res.status(404).json({ error: 'Order not found' });
 res.json(order);
});

// ---- cancel (only while pending) ----
router.post('/:id/cancel', requireCustomer, (req, res) => {
 const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
 if (!order) return res.status(404).json({ error: 'Order not found' });
 if (order.order_status !== 'pending') return res.status(400).json({ error: 'Only pending orders can be cancelled' });
 const paid = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM order_payments WHERE order_id=? AND payment_status='paid'").get(order.id).s;
 if (paid > 0) return res.status(400).json({ error: 'This order has been paid — contact the shop to request a refund' });

 transact(() => {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  const release = db.prepare('UPDATE products SET reserved_stock = reserved_stock - ? WHERE id=?');
  for (const i of items) {
   const p = db.prepare('SELECT * FROM products WHERE id=?').get(i.product_id);
   if (!p) continue;
   const pieces = u.piecesWanted(i.quantity, i.unit, p);
   release.run(u.baseUnitsFromPieces(pieces, p), i.product_id);
  }
  if (order.payment_method === 'credit') {
   db.prepare('UPDATE users SET balance = balance - ? WHERE id=?').run(order.total, req.user.id);
  }
  db.prepare("UPDATE orders SET order_status='cancelled', updated_at=datetime('now') WHERE id=?").run(order.id);
  try { db.prepare(`INSERT INTO order_status_history (order_id, from_status, to_status, action, changed_by, changed_by_name, changed_by_role, office_id, office_name, notes) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(order.id, order.order_status, 'cancelled', 'cancel', req.user.id, req.user.name, req.user.role, req.user.office_id || null, req.user.office || null, null); } catch {}
  audit(req.user.id, 'CANCEL_ORDER', 'order', Number(order.id), { order_number: order.order_number });
 });
 res.json(getOrder(order.id, req.user.id));
});

// ---- submit payment for an unpaid order (goes to staff verification) ----
router.post('/:id/pay', requireCustomer, (req, res) => {
 const { method, transaction_reference } = req.body;
 const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
 if (!order) return res.status(404).json({ error: 'Order not found' });
 if (order.payment_status === 'paid') return res.status(400).json({ error: 'Order is already paid' });
 if (['cancelled', 'rejected'].includes(order.order_status)) return res.status(400).json({ error: 'This order is no longer active' });
 const m = PAYMENT_METHODS.includes(method) ? method : order.payment_method;
 if (m === 'credit') return res.status(400).json({ error: 'Use the credit payment method at checkout' });
 const ref = transaction_reference ? String(transaction_reference).trim().slice(0, 80) : null;
 if (['card', 'mobile_money', 'bank_transfer'].includes(m) && (!ref || ref.length < 4)) {
  return res.status(400).json({ error: 'A valid transaction reference is required' });
 }

 transact(() => {
  db.prepare("UPDATE order_payments SET payment_status='pending', transaction_reference=?, paid_at=NULL WHERE order_id=? AND payment_status NOT IN ('paid')")
   .run(ref, order.id);
  db.prepare("UPDATE orders SET payment_status='verifying', updated_at=datetime('now') WHERE id=?").run(order.id);
  try { db.prepare(`INSERT INTO order_status_history (order_id, from_status, to_status, action, changed_by, changed_by_name, changed_by_role, office_id, office_name, notes) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(order.id, order.payment_status, 'verifying', 'submit_payment', req.user.id, req.user.name, req.user.role, req.user.office_id || null, req.user.office || null, `${m} ${ref||''}`); } catch {}
  audit(req.user.id, 'SUBMIT_PAYMENT', 'order', Number(order.id), { method: m, ref });
 });
 res.json(getOrder(order.id, req.user.id));
});

// ---- reorder (copy previous items into cart) ----
router.post('/:id/reorder', requireCustomer, (req, res) => {
 const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
 if (!order) return res.status(404).json({ error: 'Order not found' });
 const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);

 transact(() => {
  let cart = db.prepare('SELECT * FROM carts WHERE user_id=?').get(req.user.id);
  if (!cart) {
   const info = db.prepare('INSERT INTO carts (user_id) VALUES (?)').run(req.user.id);
   cart = { id: Number(info.lastInsertRowid) };
  }
  const upsert = db.prepare(`
   INSERT INTO cart_items (cart_id, product_id, quantity, unit_price, unit) VALUES (?,?,?,?,?)
   ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + excluded.quantity, unit_price = excluded.unit_price, unit = excluded.unit
  `);
  for (const i of items) {
   const p = db.prepare("SELECT * FROM products WHERE id=? AND status='active'").get(i.product_id);
   if (!p) continue;
   const available = p.current_stock - (p.reserved_stock || 0);
   if (available <= 0) continue;
   const productLike = { name: i.product_name || p.name, unit: p.unit, selling_price: p.selling_price };
   const pieces = u.piecesWanted(i.quantity, i.unit, productLike);
   const availPieces = Math.floor(available * u.basePieces(productLike));
   const safePieces = Math.min(pieces, availPieces);
   const qty = safePieces / u.multiplier(i.unit, productLike);
   upsert.run(cart.id, i.product_id, qty, u.unitPrice(i.unit, productLike), i.unit);
  }
 });
 res.json({ ok: true });
});

// ---- request a return / refund ----
router.post('/:id/return-request', requireCustomer, (req, res) => {
 const { reason } = req.body;
 const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
 if (!order) return res.status(404).json({ error: 'Order not found' });
 if (!['completed', 'ready_for_pickup', 'out_for_delivery'].includes(order.order_status)) {
  return res.status(400).json({ error: 'Returns are only available for completed orders' });
 }
 const existing = db.prepare("SELECT COUNT(*) c FROM order_returns WHERE order_id=? AND status='requested'").get(order.id).c;
 if (existing > 0) return res.status(400).json({ error: 'A return request is already pending' });

 const items = db.prepare('SELECT id, product_id, product_name, quantity FROM order_items WHERE order_id=?').all(order.id);
 const info = db.prepare('INSERT INTO order_returns (order_id, reason, items) VALUES (?,?,?)')
  .run(order.id, reason || null, JSON.stringify(items));
 audit(req.user.id, 'REQUEST_RETURN', 'order', Number(order.id), { return_id: Number(info.lastInsertRowid), reason });
 res.status(201).json({ id: Number(info.lastInsertRowid) });
});

module.exports = router;