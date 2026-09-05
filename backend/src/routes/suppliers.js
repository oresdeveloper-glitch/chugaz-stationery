const express = require('express');
const { db, audit } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

router.get('/', (req, res) => {
 res.json(db.prepare('SELECT * FROM suppliers ORDER BY name').all());
});

router.post('/', requireRole('manager', 'admin'), (req, res) => {
 const s = req.body;
 if (!s.name) return res.status(400).json({ error: 'Supplier name is required' });
 const info = db.prepare(`
  INSERT INTO suppliers (name, phone, email, address, tax_number, balance)
  VALUES (?,?,?,?,?,?)
 `).run(s.name, s.phone || null, s.email || null, s.address || null, s.tax_number || null, s.balance || 0);
 audit(req.user.id, 'CREATE', 'supplier', Number(info.lastInsertRowid), { name: s.name });
 res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.put('/:id', requireRole('manager', 'admin'), (req, res) => {
 const s = req.body;
 const info = db.prepare(`
  UPDATE suppliers SET name=?, phone=?, email=?, address=?, tax_number=? WHERE id=?
 `).run(s.name, s.phone, s.email, s.address, s.tax_number, req.params.id);
 if (info.changes === 0) return res.status(404).json({ error: 'Supplier not found' });
 res.json({ ok: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
 const used = db.prepare('SELECT COUNT(*) c FROM purchases WHERE supplier_id=?').get(req.params.id).c;
 if (used > 0) return res.status(409).json({ error: 'Supplier has purchase history' });
 db.prepare('DELETE FROM suppliers WHERE id=?').run(req.params.id);
 res.json({ ok: true });
});

router.get('/:id/purchases', (req, res) => {
 res.json(db.prepare('SELECT * FROM purchases WHERE supplier_id=? ORDER BY purchase_date DESC').all(req.params.id));
});

module.exports = router;