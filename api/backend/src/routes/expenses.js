const express = require('express');
const { db, audit } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

router.get('/', requireRole('manager', 'admin'), (req, res) => {
 const { category, from, to } = req.query;
 const conds = [];
 const params = [];
 if (category) { conds.push('category = ?'); params.push(category); }
 if (from && to) { conds.push('date(expense_date) BETWEEN date(?) AND date(?)'); params.push(from, to); }
 const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
 res.json(db.prepare(`SELECT e.*, u.name AS created_by_name FROM expenses e LEFT JOIN users u ON u.id=e.created_by ${where} ORDER BY expense_date DESC, id DESC`).all(...params));
});

router.get('/categories', requireRole('manager', 'admin'), (req, res) => {
 res.json(db.prepare("SELECT DISTINCT category FROM expenses WHERE category IS NOT NULL AND category != '' ORDER BY category").all());
});

router.post('/', requireRole('manager', 'admin'), (req, res) => {
 const e = req.body;
 if (!e.title || !e.amount) return res.status(400).json({ error: 'Title and amount required' });
 const info = db.prepare('INSERT INTO expenses (title, category, amount, expense_date, notes, created_by) VALUES (?,?,?,?,?,?)')
  .run(e.title, e.category || null, Number(e.amount), e.expense_date || new Date().toISOString(), e.notes || null, req.user.id);
 audit(req.user.id, 'CREATE', 'expense', Number(info.lastInsertRowid), { title: e.title, amount: e.amount });
 res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.delete('/:id', requireRole('manager', 'admin'), (req, res) => {
 db.prepare('DELETE FROM expenses WHERE id=?').run(req.params.id);
 res.json({ ok: true });
});

module.exports = router;