const express = require('express');
const { db, audit } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

router.get('/', (req, res) => {
 res.json(db.prepare('SELECT * FROM customers ORDER BY name').all());
});

router.post('/', requireRole('clerk', 'cashier', 'manager', 'admin'), (req, res) => {
 const c = req.body;
 if (!c.name) return res.status(400).json({ error: 'Customer name is required' });
 const info = db.prepare(`
  INSERT INTO customers (name, phone, email, address, credit_limit, balance, discount_rate)
  VALUES (?,?,?,?,?,?,?)
 `).run(c.name, c.phone || null, c.email || null, c.address || null, c.credit_limit || 0, c.balance || 0, c.discount_rate || 0);
 audit(req.user.id, 'CREATE', 'customer', Number(info.lastInsertRowid), { name: c.name });
 res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.put('/:id', requireRole('admin'), (req, res) => {
 const c = req.body;
 const info = db.prepare(`
  UPDATE customers SET name=?, phone=?, email=?, address=?, credit_limit=?, discount_rate=? WHERE id=?
 `).run(c.name, c.phone, c.email, c.address, c.credit_limit || 0, c.discount_rate || 0, req.params.id);
 if (info.changes === 0) return res.status(404).json({ error: 'Customer not found' });
 res.json({ ok: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
 const used = db.prepare('SELECT COUNT(*) c FROM sales WHERE customer_id=?').get(req.params.id).c;
 if (used > 0) return res.status(409).json({ error: 'Customer has sales history' });
 db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
 res.json({ ok: true });
});

router.get('/:id/history', (req, res) => {
 const sales = db.prepare(`
  SELECT s.*, (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS items
  FROM sales s WHERE s.customer_id=? ORDER BY s.sale_date DESC
 `).all(req.params.id);
 const payments = db.prepare(`
  SELECT * FROM payments WHERE customer_id=? ORDER BY payment_date DESC
 `).all(req.params.id);
 res.json({ sales, payments });
});

module.exports = router;