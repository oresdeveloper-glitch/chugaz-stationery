const express = require('express');
const { db, audit } = require('../db');
const { requireRole } = require('../auth');
const bcrypt = require('bcryptjs');
const { checkEmailReal } = require('../mailer');

const router = express.Router();

router.get('/', requireRole('manager', 'admin'), (req, res) => {
 res.json(db.prepare(`
  SELECT u.id, u.name, u.email, u.status, u.created_at, u.office_id, r.name AS role, o.name AS office
  FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN offices o ON o.id = u.office_id ORDER BY u.id
 `).all());
});

router.get('/roles', (req, res) => {
 res.json(db.prepare('SELECT * FROM roles').all());
});

router.post('/', requireRole('admin'), async (req, res) => {
 const { name, email, password, role_id, office_id } = req.body;
 if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
 if (!role_id) return res.status(400).json({ error: 'Role required' });
 if (String(password).length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers' });
 }
 const check = await checkEmailReal(email);
 if (!check.ok) return res.status(400).json({ error: check.error });
 const hash = bcrypt.hashSync(password, 10);
 try {
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role_id, office_id) VALUES (?,?,?,?,?)')
   .run(name, check.clean, hash, role_id, office_id ? Number(office_id) : null);
  audit(req.user.id, 'CREATE', 'user', Number(info.lastInsertRowid), { email: check.clean });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
 } catch (e) {
  if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
  throw e;
 }
});

router.put('/:id', requireRole('admin'), (req, res) => {
 const { name, email, role_id, status, password, office_id } = req.body;
 const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
 if (!u) return res.status(404).json({ error: 'User not found' });
 if (req.params.id == req.user.id && status === 'inactive') {
  return res.status(400).json({ error: 'You cannot disable your own account' });
 }
 if (password) {
  if (String(password).length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
   return res.status(400).json({ error: 'Password must be at least 8 characters with letters and numbers' });
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET name=?, email=?, role_id=?, status=?, office_id=?, password_hash=? WHERE id=?')
   .run(name ?? u.name, (email ?? u.email).toLowerCase().trim(), role_id ?? u.role_id, status ?? u.status, office_id === undefined ? u.office_id : (office_id ? Number(office_id) : null), hash, req.params.id);
 } else {
  db.prepare('UPDATE users SET name=?, email=?, role_id=?, status=?, office_id=? WHERE id=?')
   .run(name ?? u.name, (email ?? u.email).toLowerCase().trim(), role_id ?? u.role_id, status ?? u.status, office_id === undefined ? u.office_id : (office_id ? Number(office_id) : null), req.params.id);
 }
 audit(req.user.id, 'UPDATE', 'user', Number(req.params.id), { fields: Object.keys(req.body) });
 res.json({ ok: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
 if (req.params.id == req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
 db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
 res.json({ ok: true });
});

module.exports = router;