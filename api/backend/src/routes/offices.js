const express = require('express');
const { db, audit } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

// List offices (any staff member may read, to populate assignment dropdowns).
router.get('/', requireRole('clerk', 'cashier', 'manager', 'admin'), (req, res) => {
 res.json(db.prepare('SELECT id, name FROM offices ORDER BY name').all());
});

// Create a new office (admin only).
router.post('/', requireRole('admin'), (req, res) => {
 const name = (req.body && req.body.name || '').toString().trim();
 if (!name) return res.status(400).json({ error: 'Office name is required' });
 try {
  const info = db.prepare('INSERT INTO offices (name) VALUES (?)').run(name);
  audit(req.user.id, 'CREATE', 'office', Number(info.lastInsertRowid), { name });
  res.status(201).json({ id: Number(info.lastInsertRowid), name });
 } catch (e) {
  if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'An office with that name already exists' });
  throw e;
 }
});

module.exports = router;
