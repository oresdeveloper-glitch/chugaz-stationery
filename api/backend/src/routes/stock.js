const express = require('express');
const { db, audit, transact } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

router.get('/movements', requireRole('admin'), (req, res) => {
 const { product_id, type, from, to, limit } = req.query;
 const conds = [];
 const params = [];
 if (product_id) { conds.push('sm.product_id = ?'); params.push(product_id); }
 if (type) { conds.push('sm.movement_type = ?'); params.push(type); }
 if (from && to) { conds.push('date(sm.created_at) BETWEEN date(?) AND date(?)'); params.push(from, to); }
 const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
 const rows = db.prepare(`
  SELECT sm.*, p.name AS product_name, p.sku, u.name AS created_by_name
  FROM stock_movements sm
  JOIN products p ON p.id = sm.product_id
  LEFT JOIN users u ON u.id = sm.created_by
  ${where} ORDER BY sm.created_at DESC, sm.id DESC LIMIT ${Math.min(Number(limit) || 200, 1000)}
 `).all(...params);
 res.json(rows);
});

router.get('/low', requireRole('admin'), (req, res) => {
 const rows = db.prepare(`
  SELECT p.*, c.name AS category_name
  FROM products p LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.status='active' AND p.current_stock <= p.reorder_level ORDER BY (p.current_stock - p.reorder_level)
 `).all();
 res.json(rows);
});

router.post('/adjust', requireRole('admin'), (req, res) => {
 const { product_id, new_quantity, reason } = req.body;
 if (!product_id || new_quantity === undefined || new_quantity < 0) {
  return res.status(400).json({ error: 'Product and non-negative quantity required' });
 }
 const product = db.prepare('SELECT * FROM products WHERE id=?').get(product_id);
 if (!product) return res.status(404).json({ error: 'Product not found' });

 transact(() => {
  const delta = Number(new_quantity) - product.current_stock;
  db.prepare('UPDATE products SET current_stock=? WHERE id=?').run(Number(new_quantity), product_id);
  if (delta !== 0) {
   db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by) VALUES (?,?,?,NULL,?,?)')
    .run(product_id, delta > 0 ? 'in' : 'out', Math.abs(delta), `Stock adjustment: ${reason || 'manual'} (from ${product.current_stock} to ${new_quantity})`, req.user.id);
  }
  audit(req.user.id, 'ADJUST', 'stock', Number(product_id), { from: product.current_stock, to: Number(new_quantity), reason });
 });
 res.json({ ok: true });
});

module.exports = router;