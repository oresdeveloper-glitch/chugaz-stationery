const express = require('express');
const { db, audit } = require('../db');
const { signToken, requireAuth } = require('../auth');
const { rateLimit, registerFailure, lockState, clearFailures, clientIp } = require('../security');
const bcrypt = require('bcryptjs');

const router = express.Router();

const PASSWORD_RULE = 'Password must be at least 8 characters and contain both letters and numbers';
function passwordOk(p) {
 return typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);
}

function findUserByEmail(email) {
 return db.prepare(`
  SELECT u.id, u.name, u.email, u.password_hash, u.status, u.token_ver, u.failed_attempts, u.locked_until, u.office_id, r.name AS role, o.name AS office
  FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN offices o ON o.id = u.office_id WHERE u.email = ?
 `).get(String(email).toLowerCase().trim());
}

router.post('/login', (req, res) => {
 const { email, password } = req.body;
 const ip = clientIp(req);
 if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

 // IP-wide throttle (stops spraying many accounts)
 const ipLimit = rateLimit(`ip:${ip}`, 30, 10 * 60 * 1000);
 if (!ipLimit.ok) {
  return res.status(429).json({ error: `Too many attempts from this network — try again in ${Math.ceil(ipLimit.retryAfterSec / 60)} minute(s)` });
 }

 const key = `login:${String(email).toLowerCase().trim()}`;
 const emailLimit = rateLimit(key, 8, 10 * 60 * 1000);
 if (!emailLimit.ok) {
  return res.status(429).json({ error: `Too many sign-in attempts — try again in ${Math.ceil(emailLimit.retryAfterSec / 60)} minute(s)` });
 }

 const lock = lockState(key);
 if (lock.locked) {
  return res.status(423).json({ error: `Account temporarily locked after repeated failures — try again in ${lock.minutesLeft} minute(s)` });
 }

 const user = findUserByEmail(email);
 const valid = user && bcrypt.compareSync(String(password), user.password_hash);
 if (!valid) {
  registerFailure(key);
  const dbFailed = user ? db.prepare('UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id=?').run(user.id) : null;
  audit(user ? user.id : null, 'LOGIN_FAIL', 'user', user ? user.id : null, { email: String(email).slice(0, 80), ip });
  return res.status(401).json({ error: 'Invalid email or password' });
 }
 if (user.status !== 'active') return res.status(403).json({ error: 'Account is disabled — contact the administrator' });
 if (user.role === 'customer') return res.status(403).json({ error: 'Customer accounts sign in from CHUGAZ STATIONERY' });

 clearFailures(key);
 db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id=?').run(user.id);
 const token = signToken(user);
 audit(user.id, 'LOGIN', 'user', user.id, { email: user.email, ip });
 res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, office: user.office, office_id: user.office_id } });
});

router.post('/refresh', requireAuth, (req, res) => {
 const token = signToken(req.user);
 res.json({ token });
});

router.get('/me', requireAuth, (req, res) => {
 const user = db.prepare(`
  SELECT u.id, u.name, u.email, u.status, u.office_id, r.name AS role, o.name AS office
  FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN offices o ON o.id = u.office_id WHERE u.id = ?
 `).get(req.user.id);
 if (!user) return res.status(404).json({ error: 'User not found' });
 res.json({ user });
});

router.put('/password', requireAuth, (req, res) => {
 const { current, next } = req.body;
 if (!current || !next) return res.status(400).json({ error: 'Current and new password are required' });
 if (!passwordOk(next)) return res.status(400).json({ error: PASSWORD_RULE });
 const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
 if (!u || !bcrypt.compareSync(String(current), u.password_hash)) {
  audit(req.user.id, 'CHANGE_PASSWORD_FAIL', 'user', req.user.id, { ip: clientIp(req) });
  return res.status(400).json({ error: 'Current password is incorrect' });
 }
 const ver = (u.token_ver ?? 0) + 1;
 db.prepare('UPDATE users SET password_hash=?, token_ver=? WHERE id=?').run(bcrypt.hashSync(String(next), 10), ver, req.user.id);
 audit(req.user.id, 'CHANGE_PASSWORD', 'user', req.user.id, { ip: clientIp(req), sessions_revoked: true });
 // Fresh token so this session survives; every OTHER session is now revoked.
 res.json({ ok: true, token: signToken({ ...req.user, token_ver: ver }) });
});

module.exports = router;
