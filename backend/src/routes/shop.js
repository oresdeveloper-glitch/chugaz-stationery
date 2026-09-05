const express = require('express');
const { db, audit } = require('../db');
const u = require('../units');

const router = express.Router();

function sanitize(r) {
 if (r && typeof r === 'object') {
  delete r.available;
  delete r.current_stock;
  delete r.reserved_stock;
  delete r.reorder_level;
 }
 return r;
}

// Public shop info (settings exposed to storefront)
router.get('/info', (req, res) => {
 const rows = db.prepare('SELECT key, value FROM settings').all();
 const s = {};
 rows.forEach((r) => (s[r.key] = r.value));
 res.json({
  shop_name: s.shop_name || 'Stationery Shop',
  shop_address: s.shop_address || '',
  shop_phone: s.shop_phone || '',
  shop_email: s.shop_email || '',
  currency: s.currency || 'TSh',
  delivery_fee: Number(s.delivery_fee) || 0,
  free_delivery_threshold: Number(s.free_delivery_threshold) || 0,
  pickup_available: s.pickup_available !== '0',
  payment_instructions: s.payment_instructions || '',
  receipt_footer: s.receipt_footer || '',
  theme: s.app_theme || 'steel',
 });
});

// Units visible on the customer storefront — bulk + allowed piece (REAM + MANILA + TRANSPARENT)
const STORE_UNITS = "('dozen','outer','carton')";
const ALLOWED_PIECE_NAMES = ["REAM A3 MAGNA PIECE","REAM A3 A1 PIECE","REAM A4 (A1 & NO1) PIECE"];
const PIECE_ALLOW = `(p.name IN ('${ALLOWED_PIECE_NAMES.join("','")}') OR p.name LIKE '%REAM A2%' OR p.name LIKE '%MANILA%' OR p.name LIKE '%TRANSPARENT%')`;
const SHOP_FILTER = `(p.unit IN ${STORE_UNITS} OR (p.unit='piece' AND ${PIECE_ALLOW}))`;

router.get('/categories', (req, res) => {
 const rows = db.prepare(`
  SELECT c.id, c.name, c.description,
   (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status = 'active' AND p.parent_id IS NULL AND ${SHOP_FILTER}) AS product_count,
   (SELECT p.image FROM products p WHERE p.category_id = c.id AND p.status = 'active' AND p.parent_id IS NULL AND ${SHOP_FILTER} AND p.image IS NOT NULL AND p.image != '' ORDER BY p.id LIMIT 1) AS image
  FROM categories c ORDER BY c.name
 `).all();
 res.json(rows);
});

router.get('/brands', (req, res) => {
 res.json(db.prepare('SELECT * FROM brands ORDER BY name').all());
});

router.get('/products', (req, res) => {
 const { q, category_id, brand_id, sort } = req.query;
 const conds = ["p.status = 'active'", 'p.parent_id IS NULL', SHOP_FILTER, 'p.office_id IS NULL'];
 const params = [];
 if (q) { conds.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
 if (category_id) { conds.push('p.category_id = ?'); params.push(category_id); }
 if (brand_id) { conds.push('p.brand_id = ?'); params.push(brand_id); }
 const orderBy = sort === 'price_low' ? 'p.selling_price ASC'
  : sort === 'price_high' ? 'p.selling_price DESC'
  : sort === 'name' ? 'p.name ASC'
  : 'p.name ASC';
 const rows = db.prepare(`
  SELECT p.*, c.name AS category_name, b.name AS brand_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  WHERE ${conds.join(' AND ')}
  ORDER BY ${orderBy} LIMIT 500
 `).all(...params);
 for (const r of rows) {
  r.piece_price = u.piecePrice(r);
  r.units = u.unitsFor(r).map((x) => ({ ...x, price: u.unitPrice(x.id, r) }));
  sanitize(r);
 }
 res.json(rows);
});

function shopImagesFor(id) {
 const rows = db.prepare('SELECT path FROM product_images WHERE product_id=? ORDER BY sort, id').all(id);
 if (rows.length) return rows.map((r) => r.path);
 const pr = db.prepare('SELECT image FROM products WHERE id=?').get(id);
 return pr && pr.image ? [pr.image] : [];
}

router.get('/products/:id', (req, res) => {
 const row = db.prepare(`
  SELECT p.*, c.name AS category_name, b.name AS brand_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  WHERE p.id = ? AND p.status = 'active' AND ${SHOP_FILTER} AND p.office_id IS NULL
 `).get(req.params.id);
 if (!row) return res.status(404).json({ error: 'Product not found' });

 // If this is a variant, serve it through its parent so buyers get the full option set.
 let primary = row;
 if (row.parent_id) {
  const parent = db.prepare(`
   SELECT p.*, c.name AS category_name, b.name AS brand_name
   FROM products p
   LEFT JOIN categories c ON c.id = p.category_id
   LEFT JOIN brands b ON b.id = p.brand_id
   WHERE p.id = ? AND p.status = 'active' AND p.office_id IS NULL
  `).get(row.parent_id);
  if (parent) primary = parent;
 }

 const variants = db.prepare(`
  SELECT p.* FROM products p WHERE p.status='active' AND p.parent_id = ? AND p.office_id IS NULL ORDER BY p.id
 `).all(primary.id);
 for (const v of variants) {
  v.piece_price = u.piecePrice(v);
  v.units = u.unitsFor(v).map((x) => ({ ...x, price: u.unitPrice(x.id, v) }));
  sanitize(v);
 }

 const similar = db.prepare(`
  SELECT p.* FROM products p WHERE p.status='active' AND p.parent_id IS NULL AND ${SHOP_FILTER} AND p.office_id IS NULL AND p.category_id = ? AND p.id != ? LIMIT 6
 `).all(primary.category_id, primary.id);
 for (const s of similar) {
  s.piece_price = u.piecePrice(s);
  sanitize(s);
 }
 primary.piece_price = u.piecePrice(primary);
 primary.units = u.unitsFor(primary).map((x) => ({ ...x, price: u.unitPrice(x.id, primary) }));
 sanitize(primary);
 primary.images = shopImagesFor(primary.id);
 for (const v of variants) v.images = shopImagesFor(v.id);
 res.json({ ...primary, variants, similar });
});

router.post('/contact', (req, res) => {
 const { name, email, phone, subject, message } = req.body;
 if (!name || !message) return res.status(400).json({ error: 'Name and message are required' });
 const info = db.prepare('INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?,?,?,?,?)')
  .run(name, email || null, phone || null, subject || null, message);
 audit(null, 'CONTACT', 'message', Number(info.lastInsertRowid), { name, subject });
 res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

module.exports = router;