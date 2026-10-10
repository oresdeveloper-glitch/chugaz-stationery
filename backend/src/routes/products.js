const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db, audit, transact } = require('../db');
const { requireRole } = require('../auth');
const u = require('../units');

const router = express.Router();

const UPLOAD_DIR = process.env.VERCEL === '1' ? '/tmp/stationery-uploads' : path.join(__dirname, '..', '..', 'uploads');
try {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (_) { /* read-only bundle dir on serverless — uploads fall back to /tmp */ }

// Normalize admin-entered unit_prices: keep only numeric > 0 entries for known units.
function cleanUnitPrices(raw) {
 if (!raw || typeof raw !== 'object') return null;
 const out = {};
 for (const key of ['piece', 'dozen', 'pack', 'box']) {
  const v = Number(raw[key]);
  if (Number.isFinite(v) && v > 0) out[key] = v;
 }
 return Object.keys(out).length ? JSON.stringify(out) : null;
}

// Attach the buyer-sale units with their effective prices for the admin form / shop.
function withUnits(row) {
 if (!row) return row;
 try {
  row.unit_prices = row.unit_prices ? JSON.parse(row.unit_prices) : {};
 } catch {
  row.unit_prices = {};
 }
 row.units = u.unitsFor(row).map((x) => ({ ...x, price: u.unitPrice(x.id, row) }));
 row.piece_price = u.piecePrice(row);
 return row;
}

const IMAGE_TYPES = {
 'image/jpeg': '.jpg',
 'image/png': '.png',
 'image/webp': '.webp',
 'image/gif': '.gif',
};

const storage = multer.diskStorage({
 destination: (req, file, cb) => cb(null, UPLOAD_DIR),
 filename: (req, file, cb) => {
  const ext = IMAGE_TYPES[file.mimetype] || '.jpg';
  cb(null, `prod-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
 },
});
// Only real images are accepted — blocks HTML/SVG/scripts disguised as uploads.
const upload = multer({
 storage,
 limits: { fileSize: 2 * 1024 * 1024, files: 8 },
 fileFilter: (req, file, cb) => {
  if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
  cb(new Error('Only JPG, PNG, WebP or GIF images are allowed'));
 },
});

// ---- product image gallery ----
db.exec(`CREATE TABLE IF NOT EXISTS product_images (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 path TEXT NOT NULL,
 sort INTEGER DEFAULT 0,
 created_at TEXT DEFAULT (datetime('now'))
)`);
if (db.prepare('SELECT COUNT(*) AS n FROM product_images').get().n === 0) {
 db.prepare("INSERT INTO product_images (product_id, path, sort) SELECT id, image, 0 FROM products WHERE image IS NOT NULL AND image != ''").run();
}
function imagesFor(id) {
 const rows = db.prepare('SELECT id, path FROM product_images WHERE product_id=? ORDER BY sort, id').all(id);
 if (rows.length) return rows;
 const pr = db.prepare('SELECT image FROM products WHERE id=?').get(id);
 return pr && pr.image ? [{ id: 0, path: pr.image }] : [];
}

function productSelect(extra) {
 return `
  SELECT p.*, c.name AS category_name, c.description AS category_description, b.name AS brand_name, pp.name AS parent_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN products pp ON pp.id = p.parent_id
  ${extra || ''}`;
}

// Child variants of a product.
function variantsOf(id) {
 return db.prepare('SELECT * FROM products WHERE parent_id = ? ORDER BY id').all(id).map(withUnits);
}

router.get('/', (req, res) => {
 const { q, barcode, category_id, status, low, office_id } = req.query;
 const conds = [];
 const params = [];
 // Cashiers see the shared catalog (same as the original cashier account); managers/admins see all.
 if (req.user.role === 'cashier') {
  conds.push('p.office_id IS NULL');
 } else if (office_id) {
  conds.push('p.office_id = ?'); params.push(Number(office_id));
 }
 if (q) { conds.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
 if (barcode) {
  const scanCat = categoryForBarcode(barcode);
  if (scanCat) {
   // A shared category code must find the category's items even when the
   // scanned code is not the product's own (primary-category) barcode.
   conds.push('(p.barcode = ? OR p.sku = ? OR EXISTS(SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = ?))');
   params.push(barcode, barcode, scanCat);
  } else {
   conds.push('(p.barcode = ? OR p.sku = ?)'); params.push(barcode, barcode);
  }
 }
 if (category_id) {
  conds.push('(p.category_id = ? OR EXISTS(SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id = ?))');
  params.push(category_id, category_id);
 }
 if (status) { conds.push('p.status = ?'); params.push(status); }
 if (low === '1') { conds.push('p.current_stock <= p.reorder_level'); }
 const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
 const rows = db.prepare(productSelect(where + ' ORDER BY p.name')).all(...params);
 const withCount = rows.map((r) => {
   r.variant_count = db.prepare("SELECT COUNT(*) c FROM products WHERE parent_id = ? AND status='active'").get(r.id).c;
   return withUnits(r);
 });
 // Full membership list (primary first) for the category filters and the edit form.
 const links = new Map();
 for (const l of db.prepare('SELECT product_id, category_id FROM product_categories').all()) {
   const arr = links.get(l.product_id) || [];
   arr.push(Number(l.category_id));
   links.set(l.product_id, arr);
 }
 for (const r of withCount) {
   const set = new Set(links.get(r.id) || []);
   if (r.category_id) set.add(Number(r.category_id));
   r.category_ids = r.category_id ? [Number(r.category_id), ...[...set].filter((n) => n !== Number(r.category_id))] : [...set];
 }
 // Admin and managers work with real stock numbers; cashiers/clerk only see a yes/no flag.
 const hideStock = !['admin', 'manager'].includes(req.user.role);
 for (const r of withCount) {
  r.in_stock = Number(r.current_stock) > 0;
  if (hideStock) {
   delete r.current_stock;
   delete r.reorder_level;
   delete r.reserved_stock;
  }
 }
 res.json(withCount);
});

// EAN-13 check digit (12 digits -> 13th check digit)
function ean13CheckDigit(base12) {
 let sum = 0;
 for (let i = 0; i < 12; i++) {
  const d = Number(base12[i]);
  sum += i % 2 === 0 ? d : d * 3;
 }
 return (10 - (sum % 10)) % 10;
}

// Decode a shared category barcode (601 + 9-digit category id + check digit)
// back to its category id, so scanning a category code also finds products
// whose primary category is a different one. Random unique barcodes almost
// never decode to an existing id, and a rare accidental hit only widens the
// match set a little.
function categoryForBarcode(code) {
 const s = String(code || '');
 if (!/^\d{13}$/.test(s) || !s.startsWith('601')) return null;
 const base12 = s.slice(0, 12);
 if (ean13CheckDigit(base12) !== Number(s[12])) return null;
 const id = Number(base12.slice(3));
 return id > 0 ? id : null;
}

// Membership set for a product write: the listed category_ids plus the primary
// category. Unknown ids are dropped (a stale form tab must not fail the save)
// and the primary is always kept as a member.
function targetCategoryIds(p, keepPrimary) {
 const wanted = [...(Array.isArray(p.category_ids) ? p.category_ids : [])];
 const given = p.category_id !== undefined && p.category_id !== null && p.category_id !== '';
 if (given) wanted.push(p.category_id);
 const empty = { ids: [], primary: p.category_id !== undefined ? null : (keepPrimary ?? null) };
 const nums = [...new Set(wanted.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
 if (!nums.length) return empty;
 const ids = db.prepare(`SELECT id FROM categories WHERE id IN (${nums.map(() => '?').join(',')})`).all(...nums).map((r) => Number(r.id));
 if (!ids.length) return empty;
 const primary = given && ids.includes(Number(p.category_id)) ? Number(p.category_id)
  : p.category_id !== undefined ? ids[0]
  : keepPrimary != null && ids.includes(Number(keepPrimary)) ? Number(keepPrimary)
  : ids[0];
 return { ids, primary };
}

// One shared barcode per category: prefix 601 + category id zero-padded to 9 + check digit.
function categoryBarcode(categoryId) {
 const base12 = '601' + String(Number(categoryId)).padStart(9, '0');
 return base12 + ean13CheckDigit(base12);
}

// Returns the barcode that the given category's products all share.
function barcodeForCategory(categoryId) {
 const row = db.prepare("SELECT barcode FROM products WHERE category_id = ? AND barcode IS NOT NULL AND barcode != '' LIMIT 1").get(categoryId);
 return row ? row.barcode : categoryBarcode(categoryId);
}

// Shared category barcode: when creating/editing a product in a category, reuse that
// category's single barcode so every product in the category scans the same.
// GET /barcode/generate?category_id= returns the category's shared barcode, otherwise a fresh unique one.
router.get('/barcode/generate', requireRole('admin', 'manager'), (req, res) => {
 const catId = req.query.category_id;
 if (catId) {
  const shared = db.prepare("SELECT barcode FROM products WHERE category_id = ? AND barcode IS NOT NULL AND barcode != '' LIMIT 1").get(catId);
  return res.json({ barcode: shared ? shared.barcode : categoryBarcode(catId), shared: true });
 }
 for (let attempt = 0; attempt < 30; attempt++) {
  const suffix = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const base12 = '601' + suffix;
  const code = base12 + ean13CheckDigit(base12);
  if (!db.prepare('SELECT 1 FROM products WHERE barcode = ?').get(code)) {
   return res.json({ barcode: code });
  }
 }
 res.status(409).json({ error: 'Could not generate a unique barcode, please retry.' });
});

router.get('/:id', (req, res) => {
 const row = db.prepare(productSelect('WHERE p.id = ?')).get(req.params.id);
 if (!row) return res.status(404).json({ error: 'Product not found' });
 withUnits(row);
 row.variants = variantsOf(row.id);
 row.images = imagesFor(row.id);
 row.in_stock = Number(row.current_stock) > 0;
 const members = db.prepare('SELECT category_id FROM product_categories WHERE product_id = ?').all(row.id).map((l) => Number(l.category_id));
 const set = new Set(members);
 if (row.category_id) set.add(Number(row.category_id));
 row.category_ids = row.category_id ? [Number(row.category_id), ...[...set].filter((n) => n !== Number(row.category_id))] : [...set];
 const hideStock = !['admin', 'manager'].includes(req.user.role);
 if (hideStock) {
  delete row.current_stock;
  delete row.reorder_level;
  delete row.reserved_stock;
 }
 for (const v of row.variants) {
  v.in_stock = Number(v.current_stock) > 0;
  if (hideStock) {
   delete v.current_stock;
   delete v.reorder_level;
   delete v.reserved_stock;
  }
 }
 res.json(row);
});

router.post('/', requireRole('admin', 'manager'), (req, res) => {
 const p = req.body;
 if (!p.name) return res.status(400).json({ error: 'Product name is required' });
 const { ids, primary } = targetCategoryIds(p);
 const barcode = p.barcode || (primary ? barcodeForCategory(primary) : null);
 try {
  const id = transact(() => {
   const info = db.prepare(`
    INSERT INTO products (sku, barcode, name, category_id, brand_id, unit, purchase_price,
     selling_price, tax_rate, discount_rate, reorder_level, current_stock, image, status, description, specifications, unit_prices, parent_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
   `).run(
    p.sku || null, barcode, p.name, primary, p.brand_id || null,
    p.unit || 'piece', p.purchase_price || 0, p.selling_price || 0, p.tax_rate || 0,
    p.discount_rate || 0, p.reorder_level || 0, p.current_stock || 0, p.image || null, p.status || 'active',
    p.description || null, p.specifications || null, cleanUnitPrices(p.unit_prices), p.parent_id || null
   );
   const pid = Number(info.lastInsertRowid);
   const addLink = db.prepare('INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?,?)');
   for (const cid of ids) addLink.run(pid, cid);
   audit(req.user.id, 'CREATE', 'product', pid, { name: p.name });
   return pid;
  });
  res.status(201).json({ id, barcode });
 } catch (e) {
  if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'SKU or barcode already exists' });
  throw e;
 }
});

router.put('/:id', requireRole('admin', 'manager'), (req, res) => {
 const p = req.body;
 const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
 if (!existing) return res.status(404).json({ error: 'Product not found' });
 const oldStock = Number(existing.current_stock) || 0;
 const rawNew = p.current_stock !== undefined && p.current_stock !== null ? Number(p.current_stock) : null;
 const newStock = rawNew === null || Number.isNaN(rawNew) ? oldStock : rawNew;
 const prev = { selling_price: existing.selling_price, purchase_price: existing.purchase_price, status: existing.status };
 // When the membership changes (or no explicit barcode given), keep the shared
 // barcode of the primary category. With no category fields at all the current
 // memberships stay untouched.
 const hasCatChange = p.category_ids !== undefined || p.category_id !== undefined;
 const target = hasCatChange ? targetCategoryIds(p, existing.category_id) : { ids: null, primary: existing.category_id };
 const targetCat = target.primary;
 const barcode = (p.barcode !== undefined && p.barcode !== null && p.barcode !== '')
  ? p.barcode
  : (targetCat ? barcodeForCategory(targetCat) : existing.barcode);
 transact(() => {
  const update = db.prepare(`
   UPDATE products SET sku=?, barcode=?, name=?, category_id=?, brand_id=?, unit=?, purchase_price=?,
    selling_price=?, tax_rate=?, discount_rate=?, reorder_level=?, current_stock=?, image=?, status=?, description=?, specifications=?, unit_prices=?, parent_id=?
   WHERE id=?
  `);
  update.run(
   p.sku ?? existing.sku, barcode, p.name ?? existing.name,
   target.primary, p.brand_id ?? existing.brand_id, p.unit ?? existing.unit,
   p.purchase_price ?? existing.purchase_price, p.selling_price ?? existing.selling_price,
   p.tax_rate ?? existing.tax_rate, p.discount_rate ?? existing.discount_rate,
   p.reorder_level ?? existing.reorder_level, newStock, p.image ?? existing.image, p.status ?? existing.status,
   p.description ?? existing.description, p.specifications ?? existing.specifications,
   p.unit_prices !== undefined ? cleanUnitPrices(p.unit_prices) : existing.unit_prices,
   p.parent_id !== undefined ? p.parent_id : existing.parent_id,
   req.params.id
  );
  if (target.ids) {
   db.prepare('DELETE FROM product_categories WHERE product_id = ?').run(Number(req.params.id));
   const addLink = db.prepare('INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?,?)');
   for (const cid of target.ids) addLink.run(Number(req.params.id), cid);
  } else if (target.primary) {
   db.prepare('INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?,?)').run(Number(req.params.id), Number(target.primary));
  }
  if (newStock !== oldStock) {
   db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by) VALUES (?,?,?,NULL,?,?)')
    .run(req.params.id, newStock > oldStock ? 'in' : 'out', Math.abs(newStock - oldStock),
     `Stock set in product edit (from ${oldStock} to ${newStock})`, req.user.id);
  }
  audit(req.user.id, 'UPDATE', 'product', Number(req.params.id), { prev, next: { selling_price: p.selling_price, purchase_price: p.purchase_price, status: p.status, current_stock: newStock } });
  // Save variants (children). Each variant is a full product under this parent.
  if (Array.isArray(p.variants)) {
   const existingVariantIds = new Set(db.prepare('SELECT id FROM products WHERE parent_id = ?').all(req.params.id).map((r) => Number(r.id)));
   const keep = new Set();
   for (const v of p.variants) {
    const row = {
     sku: v.sku || null, barcode: v.barcode || null, name: v.name, unit: v.unit || 'piece',
     category_id: existing.category_id, brand_id: existing.brand_id, purchase_price: v.purchase_price || 0,
     selling_price: v.selling_price || 0, tax_rate: v.tax_rate ?? existing.tax_rate ?? 0,
     discount_rate: v.discount_rate ?? 0, reorder_level: v.reorder_level ?? existing.reorder_level ?? 0,
     current_stock: v.current_stock || 0, image: v.image || null, status: v.status || 'active',
     description: v.description ?? null, specifications: v.specifications ?? null,
     unit_prices: cleanUnitPrices(v.unit_prices), parent_id: Number(req.params.id),
    };
    if (v.id) {
     const vid = Number(v.id);
     const cur = db.prepare('SELECT * FROM products WHERE id = ? AND parent_id = ?').get(vid, Number(req.params.id));
     if (cur) {
      db.prepare(`UPDATE products SET sku=?, barcode=?, name=?, unit=?, purchase_price=?, selling_price=?, tax_rate=?, discount_rate=?, reorder_level=?, current_stock=?, image=?, status=?, description=?, specifications=?, unit_prices=? WHERE id=?`).run(
       row.sku, row.barcode, row.name, row.unit, row.purchase_price, row.selling_price, row.tax_rate, row.discount_rate, row.reorder_level, row.current_stock, row.image, row.status, row.description, row.specifications, row.unit_prices, vid);
      keep.add(vid);
      continue;
     }
    }
    const info = db.prepare(`INSERT INTO products (sku, barcode, name, category_id, brand_id, unit, purchase_price, selling_price, tax_rate, discount_rate, reorder_level, current_stock, image, status, description, specifications, unit_prices, parent_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
     row.sku, row.barcode, row.name, row.category_id, row.brand_id, row.unit, row.purchase_price, row.selling_price, row.tax_rate, row.discount_rate, row.reorder_level, row.current_stock, row.image, row.status, row.description, row.specifications, row.unit_prices, row.parent_id);
    keep.add(Number(info.lastInsertRowid));
   }
   // remove variant rows that were deleted in the form
   for (const id of existingVariantIds) {
    if (!keep.has(id)) {
     const hasMoves = db.prepare('SELECT COUNT(*) c FROM stock_movements WHERE product_id=?').get(id).c;
     if (hasMoves > 0) db.prepare("UPDATE products SET status='inactive' WHERE id=?").run(id);
     else db.prepare('DELETE FROM products WHERE id=?').run(id);
    }
   }
  }
 });
 res.json({ ok: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
 // Business rule: deactivate instead of hard delete if the product has movement history
 const hasMovements = db.prepare('SELECT COUNT(*) c FROM stock_movements WHERE product_id=?').get(req.params.id).c;
 if (hasMovements > 0) {
  db.prepare("UPDATE products SET status='inactive' WHERE id=?").run(req.params.id);
  audit(req.user.id, 'DEACTIVATE', 'product', Number(req.params.id), { reason: 'has stock history' });
  return res.json({ ok: true, deactivated: true });
 }
 db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
 audit(req.user.id, 'DELETE', 'product', Number(req.params.id));
 res.json({ ok: true });
});

router.post('/:id/image', upload.single('image'), requireRole('admin'), (req, res) => {
 if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
 const url = '/uploads/' + req.file.filename;
 db.prepare('UPDATE products SET image=? WHERE id=?').run(url, req.params.id);
 audit(req.user.id, 'UPDATE', 'product', Number(req.params.id), { image: url });
 res.json({ url });
});

// ---- categories ----
router.post('/:id/images', upload.array('images', 8), requireRole('admin'), (req, res) => {
 if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });
 const pid = Number(req.params.id);
 const maxSort = db.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM product_images WHERE product_id=?').get(pid).m;
 const ins = db.prepare('INSERT INTO product_images (product_id, path, sort) VALUES (?,?,?)');
 req.files.forEach((f, i) => ins.run(pid, '/uploads/' + f.filename, maxSort + 1 + i));
 const cur = db.prepare('SELECT image FROM products WHERE id=?').get(pid);
 if (!cur.image) db.prepare('UPDATE products SET image=? WHERE id=?').run('/uploads/' + req.files[0].filename, pid);
 audit(req.user.id, 'UPDATE', 'product', pid, { images_added: req.files.length });
 res.json({ ok: true, images: imagesFor(pid) });
});

router.delete('/:id/images/:imgId', requireRole('admin'), (req, res) => {
 const row = db.prepare('SELECT * FROM product_images WHERE id=? AND product_id=?').get(req.params.imgId, req.params.id);
 if (!row) return res.status(404).json({ error: 'Image not found' });
 db.prepare('DELETE FROM product_images WHERE id=?').run(row.id);
 const cur = db.prepare('SELECT image FROM products WHERE id=?').get(req.params.id);
 if (cur.image === row.path) {
  const rest = db.prepare('SELECT path FROM product_images WHERE product_id=? ORDER BY sort, id').all(Number(req.params.id));
  db.prepare('UPDATE products SET image=? WHERE id=?').run(rest.length ? rest[0].path : null, req.params.id);
 }
 audit(req.user.id, 'UPDATE', 'product', Number(req.params.id), { image_removed: row.path });
 res.json({ ok: true, images: imagesFor(Number(req.params.id)) });
});

router.get('/cats/all', (req, res) => {
 res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
});

router.post('/cats', requireRole('admin', 'manager'), (req, res) => {
 const { name, description, parent_id } = req.body;
 if (!name) return res.status(400).json({ error: 'Name required' });
 let parent = null;
 if (parent_id) {
  parent = db.prepare('SELECT * FROM categories WHERE id=?').get(parent_id);
  if (!parent) return res.status(400).json({ error: 'Parent category not found' });
  if (parent.parent_id) return res.status(400).json({ error: 'Subcategories can only be one level deep' });
 }
 try {
  const info = db.prepare('INSERT INTO categories (name, description, parent_id) VALUES (?,?,?)').run(name, description || null, parent ? parent.id : null);
  audit(req.user.id, 'CREATE', 'category', Number(info.lastInsertRowid), { name });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
 } catch (e) {
  if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Category already exists' });
  throw e;
 }
});

router.put('/cats/:id', requireRole('admin', 'manager'), (req, res) => {
 const existing = db.prepare('SELECT * FROM categories WHERE id=?').get(req.params.id);
 if (!existing) return res.status(404).json({ error: 'Category not found' });
 const name = (req.body.name || '').trim();
 if (!name) return res.status(400).json({ error: 'Name required' });
 try {
  db.prepare('UPDATE categories SET name=?, description=? WHERE id=?').run(name, req.body.description || null, req.params.id);
 } catch (e) {
  if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Category already exists' });
  throw e;
 }
 audit(req.user.id, 'UPDATE', 'category', Number(req.params.id), { name });
 res.json({ ok: true });
});

// Categories are permanent: only an admin may remove one, and only after no
// product (primary or extra membership) still points at it.
router.delete('/cats/:id', requireRole('admin'), (req, res) => {
 const catId = Number(req.params.id);
 const used = db.prepare('SELECT COUNT(*) c FROM products WHERE category_id = ? OR id IN (SELECT product_id FROM product_categories WHERE category_id = ?)').get(catId, catId).c;
 if (used > 0) return res.status(409).json({ error: 'Category is used by products' });
 const subs = db.prepare('SELECT COUNT(*) c FROM categories WHERE parent_id=?').get(req.params.id).c;
 if (subs > 0) return res.status(409).json({ error: 'Delete its subcategories first' });
 db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
 audit(req.user.id, 'DELETE', 'category', Number(req.params.id));
 res.json({ ok: true });
});

// ---- brands ----
router.get('/brands/all', (req, res) => {
 res.json(db.prepare('SELECT * FROM brands ORDER BY name').all());
});

router.post('/brands', requireRole('admin'), (req, res) => {
 const { name } = req.body;
 if (!name) return res.status(400).json({ error: 'Name required' });
 try {
  const info = db.prepare('INSERT INTO brands (name) VALUES (?)').run(name);
  audit(req.user.id, 'CREATE', 'brand', Number(info.lastInsertRowid), { name });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
 } catch (e) {
  if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Brand already exists' });
  throw e;
 }
});

router.put('/brands/:id', requireRole('admin'), (req, res) => {
 db.prepare('UPDATE brands SET name=? WHERE id=?').run(req.body.name, req.params.id);
 audit(req.user.id, 'UPDATE', 'brand', Number(req.params.id), { name: req.body.name });
 res.json({ ok: true });
});

router.delete('/brands/:id', requireRole('admin'), (req, res) => {
 const used = db.prepare('SELECT COUNT(*) c FROM products WHERE brand_id=?').get(req.params.id).c;
 if (used > 0) return res.status(409).json({ error: 'Brand is used by products' });
 db.prepare('DELETE FROM brands WHERE id=?').run(req.params.id);
 audit(req.user.id, 'DELETE', 'brand', Number(req.params.id));
 res.json({ ok: true });
});

module.exports = router;