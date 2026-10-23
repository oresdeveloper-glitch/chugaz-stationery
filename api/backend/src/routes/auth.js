const express = require('express');
const { db, audit } = require('../db');
const { signToken, requireAuth, verifyForRefresh } = require('../auth');
const { rateLimit, registerFailure, lockState, clearFailures, clientIp, registerIpFailure, ipLockState } = require('../security');
const { hashPassword, verifyPassword, upgradeUserPassword, passwordPolicy } = require('../pwd');
const { sendVerificationCode, smtpReady } = require('../mailer');
const bcrypt = require('bcrypt');

const router = express.Router();

// Express 4 doesn't forward async rejections to the error middleware.
function asyncRoute(fn) {
 return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function findUserByEmail(email) {
 return db.prepare(`
  SELECT u.id, u.name, u.email, u.phone, u.password_hash, u.status, u.token_ver, u.failed_attempts, u.locked_until, u.office_id, r.name AS role, o.name AS office
  FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN offices o ON o.id = u.office_id WHERE u.email = ?
 `).get(String(email).toLowerCase().trim());
}

function twoFactorEnabled() {
 const row = db.prepare("SELECT value FROM settings WHERE key='two_factor'").get();
 return !!(row && row.value === '1');
}

function issue2faCode(email) {
 const code = String(Math.floor(100000 + Math.random() * 900000));
 db.prepare(`
  INSERT INTO email_verifications (email, code_hash, attempts, expires_at)
  VALUES (?,?,0,datetime('now','+10 minutes'))
  ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, attempts=0, expires_at=excluded.expires_at, created_at=datetime('now')
 `).run(`2fa:${email}`, bcrypt.hashSync(code, 12));
 return code;
}

router.post('/login', asyncRoute(async (req, res, next) => {
 const { email, password } = req.body;
 const ip = clientIp(req);
 if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

 // Customers (and unknown emails the shop may still recover) run through the
 // customer handler: it owns self-heal, unverified handling, guest-cart merge
 // and its own rate/lock keys. Lazy require avoids a cycle.
 const user = findUserByEmail(email);
 if (!user || user.role === 'customer') {
  const { handleCustomerLogin } = require('./customer');
  return handleCustomerLogin(req, res);
 }

 // IP-wide throttle (stops spraying many accounts) + escalating network lock.
 const ipLimit = rateLimit(`ip:${ip}`, 30, 10 * 60 * 1000);
 if (!ipLimit.ok) {
  return res.status(429).json({ error: `Too many attempts from this network — try again in ${Math.ceil(ipLimit.retryAfterSec / 60)} minute(s)` });
 }
 const ipLock = ipLockState(ip);
 if (ipLock.locked) {
  return res.status(429).json({ error: `Too many failed sign-ins from this network — try again in ${ipLock.minutesLeft} minute(s)` });
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

 const pw = verifyPassword(password, user.password_hash);
 if (!pw.ok) {
  registerFailure(key);
  const ipf = registerIpFailure(ip);
  db.prepare('UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id=?').run(user.id);
  audit(user.id, 'LOGIN_FAIL', 'user', user.id, { email: String(email).slice(0, 80), ip, ip_locked: ipf.lockedUntil > Date.now() ? 1 : undefined });
  return res.status(401).json({ error: 'Invalid email or password' });
 }
 if (user.status !== 'active') return res.status(403).json({ error: 'Account is disabled — contact the administrator' });

 clearFailures(key);
 db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id=?').run(user.id);
 if (pw.needsRehash) upgradeUserPassword(user.id, password);

 // Optional emailed second factor for staff (Settings > two-factor sign-in,
 // requires working SMTP). Password already proved; challenge before issue.
 if (twoFactorEnabled() && smtpReady()) {
  const chal = rateLimit(`2fa-send:${key}`, 5, 15 * 60 * 1000);
  if (!chal.ok) {
   return res.status(429).json({ error: `Too many code requests — try again in ${Math.ceil(chal.retryAfterSec / 60)} minute(s)` });
  }
  const code = issue2faCode(user.email);
  const sent = await sendVerificationCode(user.email, code);
  if (!sent.sent) {
   audit(user.id, 'LOGIN', 'user', user.id, { email: user.email, ip, two_factor_code: 'send_failed' });
   return res.status(503).json({ error: 'Could not send the sign-in code — try again in a moment', code: 'TWO_FACTOR_SEND_FAILED' });
  }
  audit(user.id, 'LOGIN', 'user', user.id, { email: user.email, ip, two_factor_code: 'sent' });
  return res.status(403).json({ error: 'Enter the 6-digit code we emailed you to finish signing in', code: 'TWO_FACTOR_REQUIRED', email: user.email });
 }

 const token = signToken(user);
 audit(user.id, 'LOGIN', 'user', user.id, { email: user.email, ip });
 res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone || null, role: user.role, office: user.office, office_id: user.office_id } });
}));

router.post('/login-2fa', asyncRoute(async (req, res) => {
 const { email, code } = req.body;
 const clean = String(email || '').toLowerCase().trim();
 const ip = clientIp(req);
 if (!clean || !/^\d{6}$/.test(String(code || '').trim())) {
  return res.status(400).json({ error: 'Enter the 6-digit code from your email' });
 }
 const ipLimit = rateLimit(`ip:${ip}`, 30, 10 * 60 * 1000);
 if (!ipLimit.ok) {
  return res.status(429).json({ error: `Too many attempts from this network — try again in ${Math.ceil(ipLimit.retryAfterSec / 60)} minute(s)` });
 }
 const key = `2fa:${clean}`;
 const rl = rateLimit(key, 12, 15 * 60 * 1000);
 if (!rl.ok) {
  return res.status(429).json({ error: `Too many code attempts — try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s)` });
 }
 const row = db.prepare('SELECT * FROM email_verifications WHERE email=?').get(key);
 if (!row) return res.status(400).json({ error: 'No sign-in code pending — sign in again', code: 'TWO_FACTOR_EXPIRED' });
 if (new Date(row.expires_at + 'Z') < new Date()) {
  db.prepare('DELETE FROM email_verifications WHERE email=?').run(key);
  return res.status(400).json({ error: 'Code expired — sign in again to get a new one', code: 'TWO_FACTOR_EXPIRED' });
 }
 if (row.attempts >= 5) {
  db.prepare('DELETE FROM email_verifications WHERE email=?').run(key);
  return res.status(429).json({ error: 'Too many wrong codes — sign in again to get a new one', code: 'TWO_FACTOR_EXPIRED' });
 }
 if (!bcrypt.compareSync(String(code).trim(), row.code_hash)) {
  db.prepare('UPDATE email_verifications SET attempts = attempts + 1 WHERE email=?').run(key);
  audit(null, 'LOGIN_FAIL', 'user', null, { email: clean, ip, two_factor: true });
  return res.status(400).json({ error: 'Incorrect code — check your email and try again' });
 }
 db.prepare('DELETE FROM email_verifications WHERE email=?').run(key);

 const user = findUserByEmail(clean);
 if (!user || user.status !== 'active') {
  return res.status(401).json({ error: 'Invalid, expired or revoked session — sign in again' });
 }
 clearFailures(`login:${clean}`);
 db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id=?').run(user.id);
 const token = signToken(user);
 audit(user.id, 'LOGIN', 'user', user.id, { email: clean, ip, two_factor: true });
 res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone || null, role: user.role, office: user.office, office_id: user.office_id } });
}));

// Exchange an aged (or expired-but-recent) token for a fresh 12h one without
// re-entering credentials: signature, claims, the 30-day absolute age cap and
// the live account row (active + token_ver match) must all hold. The pin
// header is honoured by the affinity layer so the row check runs on the
// instance that actually owns this session.
router.post('/refresh', (req, res) => {
 const header = req.headers.authorization || '';
 const token = header.startsWith('Bearer ') ? header.slice(7) : null;
 if (!token) return res.status(401).json({ error: 'Authentication required' });
 const payload = verifyForRefresh(token);
 if (!payload) return res.status(401).json({ error: 'Session expired — sign in again' });
 const row = db.prepare(`
  SELECT u.id, u.name, u.email, u.phone, u.status, u.token_ver, u.office_id, r.name AS role, o.name AS office
  FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN offices o ON o.id = u.office_id WHERE u.id = ?
 `).get(payload.id);
 if (!row || row.status !== 'active' || (row.token_ver ?? 0) !== (payload.ver ?? 0)) {
  return res.status(401).json({ error: 'Session expired — sign in again' });
 }
 res.json({ token: signToken(row, { orig: payload.orig || payload.iat }) });
});

// Kill every other session for this account by bumping token_ver; the caller
// receives a replacement token that survives the bump.
router.post('/logout-all', requireAuth, (req, res) => {
 const u = db.prepare('SELECT token_ver FROM users WHERE id=?').get(req.user.id);
 const ver = ((u && u.token_ver) || 0) + 1;
 db.prepare('UPDATE users SET token_ver=? WHERE id=?').run(ver, req.user.id);
 audit(req.user.id, 'UPDATE', 'user', req.user.id, { sessions_revoked: true, ip: clientIp(req) });
 res.json({ ok: true, token: signToken({ ...req.user, token_ver: ver }) });
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
 const pol = passwordPolicy(next, { email: req.user.email, name: req.user.name });
 if (!pol.ok) return res.status(400).json({ error: pol.error });
 const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
 const cur = u ? verifyPassword(current, u.password_hash) : { ok: false };
 if (!u || !cur.ok) {
  audit(req.user.id, 'CHANGE_PASSWORD_FAIL', 'user', req.user.id, { ip: clientIp(req) });
  return res.status(400).json({ error: 'Current password is incorrect' });
 }
 const ver = (u.token_ver ?? 0) + 1;
 db.prepare('UPDATE users SET password_hash=?, token_ver=? WHERE id=?').run(hashPassword(String(next)), ver, req.user.id);
 audit(req.user.id, 'CHANGE_PASSWORD', 'user', req.user.id, { ip: clientIp(req), sessions_revoked: true });
 // Fresh token so this session survives; every OTHER session is now revoked.
 res.json({ ok: true, token: signToken({ ...req.user, token_ver: ver }) });
});

module.exports = router;
