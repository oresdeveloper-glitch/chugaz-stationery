const express = require('express');
const { db, audit } = require('../db');
const { requireRole } = require('../auth');
const { record, forget, identityKeys } = require('../tombstones');
const sharedUsers = require('../shared-users');
const { hashPassword, passwordPolicy } = require('../pwd');
const { checkEmailReal } = require('../mailer');

const router = express.Router();

// Express 4 doesn't forward async rejections to the error middleware.
function asyncRoute(fn) {
 return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

router.get('/', requireRole('manager', 'admin'), async (req, res) => {
 const roles = new Map(db.prepare('SELECT id, name FROM roles').all().map((r) => [r.id, r.name]));
 const offices = new Map(db.prepare('SELECT id, name FROM offices').all().map((o) => [o.id, o.name]));
 const shared = await sharedUsers.overrides();
 const rows = db.prepare(`
  SELECT u.id, u.name, u.email, u.status, u.created_at, u.office_id, u.role_id, r.name AS role, o.name AS office
  FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN offices o ON o.id = u.office_id ORDER BY u.id
 `).all();
 const out = [];
 for (const r of rows) {
  if (sharedUsers.apply(shared, r)) continue; // deleted on another instance
  if (roles.has(r.role_id)) r.role = roles.get(r.role_id);
  if (offices.has(r.office_id)) r.office = offices.get(r.office_id);
  out.push(r);
 }
 res.json(out);
});

router.get('/roles', (req, res) => {
 res.json(db.prepare('SELECT * FROM roles').all());
});

router.post('/', requireRole('admin'), asyncRoute(async (req, res) => {
 const { name, email, password, role_id, office_id } = req.body;
 if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
 if (!role_id) return res.status(400).json({ error: 'Role required' });
 const pol = passwordPolicy(password, { email, name });
 if (!pol.ok) return res.status(400).json({ error: pol.error });
 const check = await checkEmailReal(email);
 if (!check.ok) return res.status(400).json({ error: check.error });
 const hash = hashPassword(password);
 try {
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role_id, office_id) VALUES (?,?,?,?,?)')
   .run(name, check.clean, hash, role_id, office_id ? Number(office_id) : null);
   forget('users', identityKeys('users', { email: check.clean }));
   await sharedUsers.remember({ email: check.clean }, { name, role_id: Number(role_id), status: 'active', office_id: office_id ? Number(office_id) : null, deleted: false });
   audit(req.user.id, 'CREATE', 'user', Number(info.lastInsertRowid), { email: check.clean });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (e) {
   if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
   throw e;
  }
}));

router.put('/:id', requireRole('admin'), async (req, res) => {
 const { name, email, role_id, status, password, office_id } = req.body;
 const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
 if (!u) return res.status(404).json({ error: 'User not found' });
 if (req.params.id == req.user.id && status === 'inactive') {
  return res.status(400).json({ error: 'You cannot disable your own account' });
 }
 if (password) {
  const pol = passwordPolicy(password, { email: email ?? u.email, name: name ?? u.name });
  if (!pol.ok) return res.status(400).json({ error: pol.error });
  const hash = hashPassword(password);
  // Bumping token_ver signs the target out everywhere: an admin password reset
  // must kill sessions opened with the old password.
  const ver = (u.token_ver ?? 0) + 1;
  db.prepare('UPDATE users SET name=?, email=?, role_id=?, status=?, office_id=?, password_hash=?, token_ver=? WHERE id=?')
   .run(name ?? u.name, (email ?? u.email).toLowerCase().trim(), role_id ?? u.role_id, status ?? u.status, office_id === undefined ? u.office_id : (office_id ? Number(office_id) : null), hash, ver, req.params.id);
 } else {
  db.prepare('UPDATE users SET name=?, email=?, role_id=?, status=?, office_id=? WHERE id=?')
   .run(name ?? u.name, (email ?? u.email).toLowerCase().trim(), role_id ?? u.role_id, status ?? u.status, office_id === undefined ? u.office_id : (office_id ? Number(office_id) : null), req.params.id);
 }
 forget('users', identityKeys('users', { email: (email ?? u.email) }));
 await sharedUsers.remember({ email: (email ?? u.email) }, {
  name: name ?? u.name,
  role_id: Number(role_id ?? u.role_id),
  status: status ?? u.status,
  office_id: office_id === undefined ? u.office_id : (office_id ? Number(office_id) : null),
  deleted: false,
 });
 audit(req.user.id, 'UPDATE', 'user', Number(req.params.id), { fields: Object.keys(req.body) });
 res.json({ ok: true });
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
 if (req.params.id == req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
 // A user with sales/orders/audit history hits FK constraints — deactivate instead.
 const id = Number(req.params.id);
 const target = db.prepare('SELECT id, email FROM users WHERE id=?').get(id);
 if (!target) return res.status(404).json({ error: 'User not found' });
 const busy = db.prepare(`SELECT
   (SELECT COUNT(*) FROM sales WHERE created_by=?) s,
   (SELECT COUNT(*) FROM orders WHERE user_id=?) o,
   (SELECT COUNT(*) FROM audit_logs WHERE user_id=?) a`).get(id, id, id);
 if ((busy.s + busy.o + busy.a) > 0) {
  return res.status(409).json({ error: 'This user has activity — set their status to inactive instead of deleting' });
 }
 try {
  db.prepare('DELETE FROM users WHERE id=?').run(id);
 } catch (e) {
  if (String(e.message).includes('FOREIGN KEY')) return res.status(409).json({ error: 'This user is referenced elsewhere — set their status to inactive instead' });
  throw e;
 }
 await sharedUsers.remember(target, { deleted: true });
 const keys = record('users', identityKeys('users', target));
 res.json({ ok: true, tombstone: { entity: 'users', keys } });
});

module.exports = router;