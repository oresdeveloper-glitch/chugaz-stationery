const express = require('express');
const { db, audit } = require('../db');
const { requireRole } = require('../auth');
const { record, forget, identityKeys } = require('../tombstones');

const router = express.Router();

router.get('/', requireRole('manager', 'admin'), (req, res) => {
 const { category, from, to } = req.query;
 const conds = [];
 const params = [];
 if (category) { conds.push('category = ?'); params.push(category); }
 if (from && to) { conds.push("expense_date >= date(?) AND expense_date < date(?, '+1 day')"); params.push(from, to); }
 const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
 res.json(db.prepare(`SELECT e.*, u.name AS created_by_name FROM expenses e LEFT JOIN users u ON u.id=e.created_by ${where} ORDER BY expense_date DESC, id DESC`).all(...params));
});

router.get('/categories', requireRole('manager', 'admin'), (req, res) => {
 res.json(db.prepare("SELECT DISTINCT category FROM expenses WHERE category IS NOT NULL AND category != '' ORDER BY category").all());
});

router.post('/', requireRole('manager', 'admin'), (req, res) => {
 const e = req.body;
 if (!e.title || !e.amount) return res.status(400).json({ error: 'Title and amount required' });
 const when = e.expense_date || new Date().toISOString();
 const info = db.prepare('INSERT INTO expenses (title, category, amount, expense_date, notes, created_by) VALUES (?,?,?,?,?,?)')
  .run(e.title, e.category || null, Number(e.amount), when, e.notes || null, req.user.id);
 forget('expenses', identityKeys('expenses', { ...e, expense_date: when }));
 audit(req.user.id, 'CREATE', 'expense', Number(info.lastInsertRowid), { title: e.title, amount: e.amount });
 res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.delete('/:id', requireRole('manager', 'admin'), (req, res) => {
 const row = db.prepare('SELECT id, title, amount, expense_date, notes FROM expenses WHERE id=?').get(req.params.id);
 if (!row) return res.status(404).json({ error: 'Expense not found' });
 db.prepare('DELETE FROM expenses WHERE id=?').run(req.params.id);
 const keys = record('expenses', identityKeys('expenses', row));
 audit(req.user.id, 'DELETE', 'expense', Number(req.params.id));
 res.json({ ok: true, tombstone: { entity: 'expenses', keys } });
});

module.exports = router;