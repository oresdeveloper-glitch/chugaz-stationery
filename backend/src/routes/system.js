const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db, DB_PATH, audit, reopenDb } = require('../db');
const { requireRole } = require('../auth');

const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const router = express.Router();

router.get('/settings', (req, res) => {
 const rows = db.prepare('SELECT key, value FROM settings').all();
 const settings = {};
 rows.forEach((r) => (settings[r.key] = r.value));
 res.json(settings);
});

router.put('/settings', requireRole('admin'), (req, res) => {
 const allowed = ['shop_name', 'shop_address', 'shop_phone', 'shop_email', 'currency', 'receipt_footer', 'allow_negative_stock', 'delivery_fee', 'free_delivery_threshold', 'pickup_available', 'payment_instructions', 'app_theme', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from'];
 const upd = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
 for (const k of allowed) {
  if (req.body[k] !== undefined) upd.run(k, String(req.body[k]));
 }
 audit(req.user.id, 'UPDATE', 'settings', null, { fields: allowed.filter((k) => req.body[k] !== undefined) });
 res.json({ ok: true });
});

router.post('/test-email', requireRole('admin'), async (req, res) => {
 const { sendTestEmail } = require('../mailer');
 const to = req.body.to || db.prepare("SELECT value FROM settings WHERE key='shop_email'").get()?.value;
 if (!to) return res.status(400).json({ error: 'No recipient â€” enter an email or set the stationery email in settings' });
 const result = await sendTestEmail(String(to).trim());
 if (result.sent) {
  audit(req.user.id, 'TEST_EMAIL', 'settings', null, { to });
  return res.json({ ok: true, message: `Test email sent to ${to}` });
 }
 res.status(400).json({ error: result.reason === 'smtp_not_configured'
  ? 'SMTP is not configured â€” fill the host, user and password first'
  : `Send failed: ${result.reason}` });
});

router.get('/backup', requireRole('admin'), (req, res) => {
 try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {}
 const data = fs.readFileSync(DB_PATH);
 res.setHeader('Content-Type', 'application/octet-stream');
 res.setHeader('Content-Disposition', `attachment; filename="stationery-backup-${Date.now()}.db"`);
 res.send(data);
});

router.post('/restore', requireRole('admin'), uploadMem.single('file'), (req, res) => {
  const file = req.file || (Array.isArray(req.files) ? req.files[0] : null);
  if (!file) return res.status(400).json({ error: 'No backup file uploaded' });
  try {
   const data = Buffer.from(file.buffer || file.data || '');
   // Validate it's a SQLite database
   if (data.slice(0, 16).toString() !== 'SQLite format 3\x00') {
    return res.status(400).json({ error: 'Not a valid SQLite backup file' });
   }
   try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {}
   const backup = path.join(path.dirname(DB_PATH), 'stationery-pre-restore.db');
   fs.copyFileSync(DB_PATH, backup);
   fs.writeFileSync(DB_PATH, data);
   try { fs.unlinkSync(DB_PATH + '-wal'); } catch (_) {}
   try { fs.unlinkSync(DB_PATH + '-shm'); } catch (_) {}
   reopenDb();
   audit(req.user.id, 'RESTORE', 'database', null, { restored_from: file.originalname || file.name || 'upload' });
  res.json({ ok: true, message: 'Database restored. Previous database saved as stationery-pre-restore.db' });
 } catch (e) {
  res.status(500).json({ error: 'Restore failed: ' + e.message });
 }
});

router.post('/restore-merge', requireRole('admin'), uploadMem.single('file'), (req, res) => {
  const file = req.file || (Array.isArray(req.files) ? req.files[0] : null);
  if (!file) return res.status(400).json({ error: 'No backup file uploaded' });
  const data = Buffer.from(file.buffer || file.data || '');
  if (data.slice(0, 16).toString() !== 'SQLite format 3\x00') {
   return res.status(400).json({ error: 'Not a valid SQLite backup file' });
  }
  const srcPath = path.join(path.dirname(DB_PATH), `merge-src-${Date.now()}.db`);
  try { fs.writeFileSync(srcPath, data); } catch (e) {
   return res.status(500).json({ error: 'Merge failed: ' + e.message });
  }
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (_) {}

  try {
   db.prepare('ATTACH DATABASE ? AS bak').run(srcPath);
  } catch (e) {
   try { fs.unlinkSync(srcPath); } catch (_) {}
   return res.status(400).json({ error: 'Could not read backup: ' + e.message });
  }

  const M = {};
  const bump = (k, n = 1) => { M[k] = (M[k] || 0) + n; };
  const tableExists = (t) => {
   try { return !!db.prepare("SELECT 1 FROM bak.sqlite_master WHERE type='table' AND name=?").get(t); } catch (_) { return false; }
  };
  const mainColsOf = (t) => { try { return db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name); } catch (_) { return []; } };
  const bakColsOf = (t) => { try { return db.prepare(`PRAGMA bak.table_info(${t})`).all().map((r) => r.name); } catch (_) { return []; } };
  const commonCols = (t) => {
   const m = new Set(mainColsOf(t));
   return bakColsOf(t).filter((c) => c !== 'id' && m.has(c));
  };
  const bakRows = (t, cl) => db.prepare(`SELECT id AS __id, ${cl.join(', ')} FROM bak.${t} ORDER BY id`).all();
  const ins = (t, cl, vals) => Number(db.prepare(`INSERT INTO ${t} (${cl.join(', ')}) VALUES (${cl.map(() => '?').join(', ')})`).run(...vals).lastInsertRowid);
  const has = (t, where, params) => !!db.prepare(`SELECT 1 FROM ${t} WHERE ${where}`).get(...params);

  const officeMap = new Map(), catMap = new Map(), brandMap = new Map(), userMap = new Map(),
   custMap = new Map(), suppMap = new Map(), prodMap = new Map(), saleMap = new Map(),
   saleItemMap = new Map(), saleRetMap = new Map(), purchMap = new Map(), purchRetMap = new Map(),
   orderMap = new Map(), orderRetMap = new Map(), addrMap = new Map(), bakStock = new Map();
  const saleBakNew = new Set(), purchBakNew = new Set(), orderBakNew = new Set();

  const remapV = (col, v, remap) => {
   if (v === null || v === undefined) return v;
   const m = remap[col];
   if (!m) return v;
   const mapped = m.get(Number(v));
   return mapped === undefined ? v : mapped;
  };

  const mergeByKey = (t, keyCols, map, remap = {}, { update = true, onRow = null } = {}) => {
   if (!tableExists(t)) return;
   const cl = commonCols(t);
   if (!keyCols.every((c) => cl.includes(c))) return;
   for (const r of bakRows(t, cl)) {
    const where = keyCols.map((c) => `${c} = ?`).join(' AND ');
    const ex = db.prepare(`SELECT id FROM ${t} WHERE ${where}`).get(...keyCols.map((c) => r[c]));
    if (ex) {
     map.set(Number(r.__id), Number(ex.id));
     if (update) {
      const upd = cl.filter((c) => !keyCols.includes(c));
      if (upd.length) db.prepare(`UPDATE ${t} SET ${upd.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...upd.map((c) => remapV(c, r[c], remap)), Number(ex.id));
     }
     continue;
    }
    const id = ins(t, cl, cl.map((c) => remapV(c, r[c], remap)));
    map.set(Number(r.__id), id);
    bump(t);
    if (onRow) onRow(r, id, true);
   }
  };

  db.exec('BEGIN');
  try {
   db.exec('PRAGMA defer_foreign_keys = ON');

   mergeByKey('offices', ['name'], officeMap, {});
   mergeByKey('categories', ['name'], catMap, { parent_id: catMap }, { update: false });
   mergeByKey('brands', ['name'], brandMap, {});
   mergeByKey('users', ['email'], userMap, { office_id: officeMap });

   if (tableExists('customers')) {
    const cl = commonCols('customers');
    for (const r of bakRows('customers', cl)) {
     const ex = (r.phone && has('customers', 'phone = ?', [r.phone])) ? db.prepare('SELECT id FROM customers WHERE phone = ?').get(r.phone)
      : (r.email && has('customers', 'email = ?', [r.email])) ? db.prepare('SELECT id FROM customers WHERE email = ?').get(r.email)
      : has('customers', 'name = ?', [r.name]) ? db.prepare('SELECT id FROM customers WHERE name = ?').get(r.name) : null;
     if (ex) {
      custMap.set(Number(r.__id), Number(ex.id));
      const upd = cl.filter((c) => c !== 'name');
      if (upd.length) db.prepare(`UPDATE customers SET ${upd.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...upd.map((c) => r[c]), Number(ex.id));
      continue;
     }
     const id = ins('customers', cl, cl.map((c) => r[c]));
     custMap.set(Number(r.__id), id);
     bump('customers');
    }
   }
   mergeByKey('suppliers', ['name'], suppMap, {});

   if (tableExists('products')) {
    const cl = commonCols('products');
    for (const r of bakRows('products', cl)) {
     const ex = (r.sku && has('products', 'sku = ?', [r.sku])) ? db.prepare('SELECT id FROM products WHERE sku = ?').get(r.sku)
      : has('products', 'name = ?', [r.name]) ? db.prepare('SELECT id FROM products WHERE name = ?').get(r.name) : null;
     const remapCols = { category_id: catMap, brand_id: brandMap };
     if (ex) {
      prodMap.set(Number(r.__id), Number(ex.id));
      bakStock.set(Number(r.__id), Number(r.current_stock) || 0);
      const upd = cl.filter((c) => c !== 'sku');
      if (upd.length) db.prepare(`UPDATE products SET ${upd.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...upd.map((c) => remapV(c, r[c], remapCols)), Number(ex.id));
     } else {
      const id = ins('products', cl, cl.map((c) => remapV(c, r[c], remapCols)));
      prodMap.set(Number(r.__id), id);
      bakStock.set(Number(r.__id), Number(r.current_stock) || 0);
      bump('products');
     }
    }
   }

   if (tableExists('sales')) {
    const cl = commonCols('sales');
    for (const r of bakRows('sales', cl)) {
     const ex = r.invoice_number && has('sales', 'invoice_number = ?', [r.invoice_number])
      ? db.prepare('SELECT id FROM sales WHERE invoice_number = ?').get(r.invoice_number) : null;
     if (ex) { saleMap.set(Number(r.__id), Number(ex.id)); continue; }
     const remapCols = { customer_id: custMap, created_by: userMap };
     const id = ins('sales', cl, cl.map((c) => remapV(c, r[c], remapCols)));
     saleMap.set(Number(r.__id), id);
     saleBakNew.add(Number(r.__id));
     bump('sales');
    }
   }

   if (tableExists('sale_items')) {
    const cl = commonCols('sale_items');
    for (const r of bakRows('sale_items', cl)) {
     if (!saleBakNew.has(Number(r.sale_id))) continue;
     const id = ins('sale_items', cl, cl.map((c) => (c === 'sale_id' ? saleMap.get(Number(r.sale_id)) : remapV(c, r[c], { product_id: prodMap }))));
     saleItemMap.set(Number(r.__id), id);
     bump('sale_items');
    }
   }

   if (tableExists('sale_returns')) {
    const cl = commonCols('sale_returns');
    for (const r of bakRows('sale_returns', cl)) {
     if (!saleBakNew.has(Number(r.sale_id))) continue;
     const id = ins('sale_returns', cl, cl.map((c) => remapV(c, r[c], { sale_id: saleMap, created_by: userMap })));
     saleRetMap.set(Number(r.__id), id);
     bump('sale_returns');
    }
   }
   if (tableExists('sale_return_items')) {
    const cl = commonCols('sale_return_items');
    for (const r of bakRows('sale_return_items', cl)) {
     if (!saleRetMap.has(Number(r.return_id))) continue;
     ins('sale_return_items', cl, cl.map((c) => {
      if (c === 'return_id') return saleRetMap.get(Number(r.return_id));
      if (c === 'sale_item_id') return r.sale_item_id == null ? null : (saleItemMap.get(Number(r.sale_item_id)) ?? null);
      return remapV(c, r[c], { product_id: prodMap });
     }));
     bump('sale_return_items');
    }
   }

   if (tableExists('purchases')) {
    const cl = commonCols('purchases');
    for (const r of bakRows('purchases', cl)) {
     const ex = r.invoice_number && has('purchases', 'invoice_number = ?', [r.invoice_number])
      ? db.prepare('SELECT id FROM purchases WHERE invoice_number = ?').get(r.invoice_number)
      : has('purchases', "purchase_date = ? AND total = ? AND COALESCE(notes, '') = ?", [r.purchase_date, r.total, r.notes ?? ''])
       ? db.prepare("SELECT id FROM purchases WHERE purchase_date = ? AND total = ? AND COALESCE(notes, '') = ?").get(r.purchase_date, r.total, r.notes ?? '') : null;
     if (ex) { purchMap.set(Number(r.__id), Number(ex.id)); continue; }
     const id = ins('purchases', cl, cl.map((c) => remapV(c, r[c], { supplier_id: suppMap, created_by: userMap })));
     purchMap.set(Number(r.__id), id);
     purchBakNew.add(Number(r.__id));
     bump('purchases');
    }
   }
   if (tableExists('purchase_items')) {
    const cl = commonCols('purchase_items');
    for (const r of bakRows('purchase_items', cl)) {
     if (!purchBakNew.has(Number(r.purchase_id))) continue;
     ins('purchase_items', cl, cl.map((c) => remapV(c, r[c], { purchase_id: purchMap, product_id: prodMap })));
     bump('purchase_items');
    }
   }
   if (tableExists('purchase_returns')) {
    const cl = commonCols('purchase_returns');
    for (const r of bakRows('purchase_returns', cl)) {
     if (!purchBakNew.has(Number(r.purchase_id))) continue;
     const id = ins('purchase_returns', cl, cl.map((c) => remapV(c, r[c], { purchase_id: purchMap, created_by: userMap })));
     purchRetMap.set(Number(r.__id), id);
     bump('purchase_returns');
    }
    if (tableExists('purchase_return_items')) {
     const icl = commonCols('purchase_return_items');
     for (const r of bakRows('purchase_return_items', icl)) {
      if (!purchRetMap.has(Number(r.return_id))) continue;
      ins('purchase_return_items', icl, icl.map((c) => remapV(c, r[c], { return_id: purchRetMap, purchase_item_id: new Map(), product_id: prodMap })));
      bump('purchase_return_items');
     }
    }
   }

   if (tableExists('payments')) {
    const cl = commonCols('payments');
    for (const r of bakRows('payments', cl)) {
     const rem = cl.map((c) => remapV(c, r[c], { sale_id: saleMap, purchase_id: purchMap, customer_id: custMap, supplier_id: suppMap, created_by: userMap }));
     const idx = (c) => cl.indexOf(c);
     const where = "COALESCE(sale_id, 0) = ? AND COALESCE(purchase_id, 0) = ? AND COALESCE(customer_id, 0) = ? AND amount = ? AND payment_date = ? AND COALESCE(created_by, 0) = ?";
     const params = [
      Number(rem[idx('sale_id')] || 0), Number(rem[idx('purchase_id')] || 0), Number(rem[idx('customer_id')] || 0),
      rem[idx('amount')], rem[idx('payment_date')], Number(rem[idx('created_by')] || 0),
     ];
     if (has('payments', where, params)) continue;
     ins('payments', cl, rem);
     bump('payments');
    }
   }

   if (tableExists('expenses')) {
    const cl = commonCols('expenses');
    for (const r of bakRows('expenses', cl)) {
     const rem = cl.map((c) => remapV(c, r[c], { created_by: userMap }));
     const idx = (c) => cl.indexOf(c);
     if (has('expenses', 'title = ? AND amount = ? AND expense_date = ? AND COALESCE(notes, \'\') = ? AND COALESCE(created_by, 0) = ?',
      [rem[idx('title')], rem[idx('amount')], rem[idx('expense_date')], rem[idx('notes')] ?? null, Number(rem[idx('created_by')] || 0)])) continue;
     ins('expenses', cl, rem);
     bump('expenses');
    }
   }

   if (tableExists('customer_addresses')) {
    const cl = commonCols('customer_addresses');
    for (const r of bakRows('customer_addresses', cl)) {
     const uw = r.user_id != null ? userMap.get(Number(r.user_id)) : null;
     const un = uw ?? (r.user_id != null && has('users', 'id = ?', [r.user_id]) ? Number(r.user_id) : null);
     if (un == null) continue;
     const where = 'user_id = ? AND COALESCE(address, \'\') = ? AND COALESCE(phone, \'\') = ? AND COALESCE(address_name, \'\') = ?';
     const params = [un, r.address || '', r.phone || '', r.address_name || ''];
     const ex = db.prepare(`SELECT id FROM customer_addresses WHERE ${where}`).get(...params);
     if (ex) { addrMap.set(Number(r.__id), Number(ex.id)); continue; }
     const id = ins('customer_addresses', cl, cl.map((c) => (c === 'user_id' ? un : r[c])));
     addrMap.set(Number(r.__id), id);
     bump('customer_addresses');
    }
   }

   if (tableExists('orders')) {
    const cl = commonCols('orders');
    for (const r of bakRows('orders', cl)) {
     const ex = has('orders', 'order_number = ?', [r.order_number]) ? db.prepare('SELECT id FROM orders WHERE order_number = ?').get(r.order_number) : null;
     if (ex) { orderMap.set(Number(r.__id), Number(ex.id)); continue; }
     const id = ins('orders', cl, cl.map((c) => remapV(c, r[c], { user_id: userMap, created_by: userMap })));
     if (cl.includes('delivery_address_id') && r.delivery_address_id != null) {
      const addr = addrMap.get(Number(r.delivery_address_id)) ?? null;
      db.prepare('UPDATE orders SET delivery_address_id = ? WHERE id = ?').run(addr, id);
     }
     orderMap.set(Number(r.__id), id);
     orderBakNew.add(Number(r.__id));
     bump('orders');
    }
   }
   if (tableExists('order_items')) {
    const cl = commonCols('order_items');
    for (const r of bakRows('order_items', cl)) {
     if (!orderBakNew.has(Number(r.order_id))) continue;
     ins('order_items', cl, cl.map((c) => remapV(c, r[c], { order_id: orderMap, product_id: prodMap })));
     bump('order_items');
    }
   }
   if (tableExists('order_payments')) {
    const cl = commonCols('order_payments');
    for (const r of bakRows('order_payments', cl)) {
     if (!orderBakNew.has(Number(r.order_id))) continue;
     ins('order_payments', cl, cl.map((c) => remapV(c, r[c], { order_id: orderMap, created_by: userMap })));
     bump('order_payments');
    }
   }
   if (tableExists('order_status_history')) {
    const cl = commonCols('order_status_history');
    for (const r of bakRows('order_status_history', cl)) {
     if (!orderBakNew.has(Number(r.order_id))) continue;
     ins('order_status_history', cl, cl.map((c) => remapV(c, r[c], { order_id: orderMap, changed_by: userMap, office_id: officeMap })));
     bump('order_status_history');
    }
   }
   if (tableExists('order_returns')) {
    const cl = commonCols('order_returns');
    for (const r of bakRows('order_returns', cl)) {
     if (!orderBakNew.has(Number(r.order_id))) continue;
     const id = ins('order_returns', cl, cl.map((c) => remapV(c, r[c], { order_id: orderMap, processed_by: userMap })));
     orderRetMap.set(Number(r.__id), id);
     bump('order_returns');
    }
   }

   const remapRef = (type, v) => {
    if (v === null || v === undefined) return v;
    const s = String(v);
    if (/^\d+$/.test(s)) {
     const n = Number(s);
     if (type === 'out' && saleMap.has(n)) return saleMap.get(n);
     if (type === 'in' && purchMap.has(n)) return purchMap.get(n);
     return v;
    }
    const m = /^(SR|PR|ORD|RET)(\d+)$/.exec(s);
    if (m) {
     const map = m[1] === 'SR' ? saleRetMap : m[1] === 'PR' ? purchRetMap : m[1] === 'ORD' ? orderMap : orderRetMap;
     const t = map.get(Number(m[2]));
     return t ? m[1] + t : v;
    }
    return v;
   };

   if (tableExists('stock_movements')) {
    const cl = commonCols('stock_movements');
    for (const r of bakRows('stock_movements', cl)) {
     const vals = cl.map((c) => {
      if (c === 'reference_id') return remapRef(r.movement_type, r[c]);
      return remapV(c, r[c], { product_id: prodMap, created_by: userMap });
     });
     const idx = (c) => cl.indexOf(c);
     if (has('stock_movements', 'product_id = ? AND movement_type = ? AND quantity = ? AND COALESCE(reference_id, \'\') = ? AND COALESCE(notes, \'\') = ? AND created_at = ? AND COALESCE(created_by, 0) = ?',
      [vals[idx('product_id')], vals[idx('movement_type')], vals[idx('quantity')], vals[idx('reference_id')] ?? '', vals[idx('notes')] ?? '', vals[idx('created_at')], Number(vals[idx('created_by')] || 0)])) continue;
     ins('stock_movements', cl, vals);
     bump('stock_movements');
    }
   }

   if (tableExists('notifications')) {
    const cl = commonCols('notifications');
    for (const r of bakRows('notifications', cl)) {
     const vals = cl.map((c) => remapV(c, r[c], { user_id: userMap }));
     const idx = (c) => cl.indexOf(c);
     if (has('notifications', 'user_id = ? AND kind = ? AND title = ? AND COALESCE(body, \'\') = ? AND created_at = ?',
      [vals[idx('user_id')], vals[idx('kind')], vals[idx('title')], vals[idx('body')] ?? '', vals[idx('created_at')]])) continue;
     ins('notifications', cl, vals);
     bump('notifications');
    }
   }

   if (tableExists('contact_messages')) {
    const cl = commonCols('contact_messages');
    for (const r of bakRows('contact_messages', cl)) {
     if (has('contact_messages', 'name = ? AND message = ? AND created_at = ?', [r.name, r.message, r.created_at])) continue;
     ins('contact_messages', cl, cl.map((c) => r[c]));
     bump('contact_messages');
    }
   }

   if (tableExists('settings')) {
    db.prepare("INSERT INTO settings (key, value) SELECT key, value FROM bak.settings WHERE key <> 'db_marker' ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
   }

   if (prodMap.size && tableExists('sale_items')) {
    const serverSales = "SELECT s.id FROM sales s WHERE COALESCE(s.invoice_number, '') NOT IN (SELECT COALESCE(invoice_number, '') FROM bak.sales)";
    const sold = new Map();
    for (const row of db.prepare(`SELECT si.product_id pid, SUM(si.quantity) q FROM sale_items si WHERE si.sale_id IN (${serverSales}) GROUP BY si.product_id`).all()) sold.set(Number(row.pid), Number(row.q) || 0);
    for (const row of db.prepare(`SELECT sri.product_id pid, SUM(sri.quantity) q FROM sale_return_items sri JOIN sale_returns sr ON sr.id = sri.return_id WHERE sr.sale_id IN (${serverSales}) GROUP BY sri.product_id`).all()) sold.set(Number(row.pid), (sold.get(Number(row.pid)) || 0) - (Number(row.q) || 0));
    const serverPurch = `SELECT p.id FROM purchases p WHERE NOT ((p.invoice_number IS NOT NULL AND p.invoice_number IN (SELECT invoice_number FROM bak.purchases WHERE invoice_number IS NOT NULL)) OR (p.invoice_number IS NULL AND EXISTS (SELECT 1 FROM bak.purchases b2 WHERE b2.invoice_number IS NULL AND b2.purchase_date = p.purchase_date AND b2.total = p.total AND COALESCE(b2.notes, '') = COALESCE(p.notes, ''))))`;
    for (const row of db.prepare(`SELECT pi.product_id pid, SUM(pi.quantity) q FROM purchase_items pi WHERE pi.purchase_id IN (${serverPurch}) GROUP BY pi.product_id`).all()) sold.set(Number(row.pid), (sold.get(Number(row.pid)) || 0) - (Number(row.q) || 0));
    for (const row of db.prepare(`SELECT pri.product_id pid, SUM(pri.quantity) q FROM purchase_return_items pri JOIN purchase_returns pr ON pr.id = pri.return_id WHERE pr.purchase_id IN (${serverPurch}) GROUP BY pri.product_id`).all()) sold.set(Number(row.pid), (sold.get(Number(row.pid)) || 0) + (Number(row.q) || 0));
    const updStock = db.prepare('UPDATE products SET current_stock = ? WHERE id = ?');
    for (const [bakId, targetId] of prodMap) {
     const base = bakStock.get(bakId);
     if (base === undefined) continue;
     updStock.run(base - (sold.get(targetId) || 0), targetId);
    }
   }

   db.exec('COMMIT');
  } catch (e) {
   try { db.exec('ROLLBACK'); } catch (_) {}
   try { db.prepare('DETACH DATABASE bak').run(); } catch (_) {}
   try { fs.unlinkSync(srcPath); } catch (_) {}
   return res.status(500).json({ error: 'Merge failed: ' + e.message });
  }
  try { db.prepare('DETACH DATABASE bak').run(); } catch (_) {}
  try { fs.unlinkSync(srcPath); } catch (_) {}
  audit(req.user.id, 'RESTORE_MERGE', 'database', null, { merged: M, source: file.originalname || file.name || 'upload' });
  res.json({ ok: true, merged: M });
});

module.exports = router;