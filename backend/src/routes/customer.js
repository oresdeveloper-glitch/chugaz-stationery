const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db, audit, transact } = require('../db');
const { signToken, requireCustomer } = require('../auth');
const { rateLimit, registerFailure, lockState, clearFailures, clientIp } = require('../security');
const { checkEmailReal, sendVerificationCode } = require('../mailer');

const AVATAR_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `avatar-${req.user.id}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images allowed'));
    cb(null, true);
  },
});

const publicRouter = express.Router();
const protectedRouter = express.Router();

const PASSWORD_RULE = 'Password must be at least 8 characters and contain both letters and numbers';
const passwordOk = (p) => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);

function issueVerificationCode(email) {
 const code = String(Math.floor(100000 + Math.random() * 900000));
 db.prepare(`
  INSERT INTO email_verifications (email, code_hash, attempts, expires_at)
  VALUES (?,?,0,datetime('now','+15 minutes'))
  ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, attempts=0, expires_at=excluded.expires_at, created_at=datetime('now')
 `).run(email, bcrypt.hashSync(code, 10));
 return code;
}

// ---- public auth ----

publicRouter.post('/register', async (req, res) => {
 const ip = clientIp(req);
 const rl = rateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
 if (!rl.ok) return res.status(429).json({ error: 'Too many registration attempts — try again later' });
 const { name, email, phone, password } = req.body;
 if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
 if (!passwordOk(password)) return res.status(400).json({ error: PASSWORD_RULE });

 // Real, active email required: format + disposable blocklist + live DNS check.
 const emailCheck = await checkEmailReal(email);
 if (!emailCheck.ok) return res.status(400).json({ error: emailCheck.error });
 const clean = emailCheck.clean;

 const existing = db.prepare('SELECT id, status FROM users WHERE email = ?').get(clean);
 if (existing && existing.status !== 'unverified') {
  return res.status(409).json({ error: 'An account with this email already exists' });
 }
 const roleId = db.prepare("SELECT id FROM roles WHERE name='customer'").get();
 if (!roleId) return res.status(500).json({ error: 'Customer role not configured' });

 const hash = bcrypt.hashSync(password, 10);
 const displayName = String(name).trim().slice(0, 80);
 const cleanPhone = phone ? String(phone).trim().slice(0, 30) : null;
 let userId;
 if (existing) {
  db.prepare("UPDATE users SET name=?, phone=?, password_hash=?, status='unverified' WHERE id=?").run(displayName, cleanPhone, hash, existing.id);
  userId = existing.id;
 } else {
  const info = db.prepare("INSERT INTO users (name, email, phone, password_hash, role_id, status) VALUES (?,?,?,?,?,'unverified')")
   .run(displayName, clean, cleanPhone, hash, roleId.id);
  userId = Number(info.lastInsertRowid);
 }

 const code = issueVerificationCode(clean);
 const sent = await sendVerificationCode(clean, code);

 if (sent.sent) {
  audit(userId, 'REGISTER', 'user', userId, { email: clean, verification: 'code_sent', ip });
  return res.status(201).json({ needs_verification: true, email: clean, message: 'Check your email for the 6-digit verification code' });
 }
 if (sent.reason === 'smtp_not_configured') {
  // Email delivery not set up yet: activate now so the shop stays usable.
  db.prepare("UPDATE users SET status='active' WHERE id=?").run(userId);
  audit(userId, 'REGISTER', 'user', userId, { email: clean, verification: 'auto_active_no_smtp', ip });
  const user = db.prepare(`
   SELECT u.id, u.name, u.email, u.phone, u.status, r.name AS role
   FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?
  `).get(userId);
  return res.status(201).json({ token: signToken(user), user, notice: 'Email verification is not configured yet — account activated directly' });
 }
 // SMTP configured but delivery failed — keep unverified, allow resend.
 audit(userId, 'REGISTER', 'user', userId, { email: clean, verification: 'send_failed', ip });
 return res.status(201).json({ needs_verification: true, email: clean, message: 'We could not deliver the email — use "Resend code"' });
});

publicRouter.post('/verify-email', async (req, res) => {
 const { email, code } = req.body;
 const clean = String(email || '').toLowerCase().trim();
 const ip = clientIp(req);
 const rl = rateLimit(`verify:${ip}:${clean}`, 12, 15 * 60 * 1000);
 if (!rl.ok) return res.status(429).json({ error: 'Too many verification attempts — try again later' });
 if (!clean || !/^\d{6}$/.test(String(code || '').trim())) {
  return res.status(400).json({ error: 'Enter the 6-digit code from your email' });
 }
 const row = db.prepare('SELECT * FROM email_verifications WHERE email=?').get(clean);
 if (!row) return res.status(400).json({ error: 'No verification pending — register or resend the code' });
 if (new Date(row.expires_at + 'Z') < new Date()) {
  db.prepare('DELETE FROM email_verifications WHERE email=?').run(clean);
  return res.status(400).json({ error: 'Code expired — request a new one' });
 }
 if (row.attempts >= 5) {
  db.prepare('DELETE FROM email_verifications WHERE email=?').run(clean);
  return res.status(429).json({ error: 'Too many wrong codes — request a new one' });
 }
 if (!bcrypt.compareSync(String(code).trim(), row.code_hash)) {
  db.prepare('UPDATE email_verifications SET attempts = attempts + 1 WHERE email=?').run(clean);
  return res.status(400).json({ error: 'Incorrect code — check your email and try again' });
 }
 db.prepare('DELETE FROM email_verifications WHERE email=?').run(clean);
 const user = db.prepare(`
  SELECT u.id, u.name, u.email, u.phone, u.status, r.name AS role
  FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?
 `).get(clean);
 if (!user) return res.status(404).json({ error: 'Account not found' });
 if (user.status === 'unverified') db.prepare("UPDATE users SET status='active' WHERE id=?").run(user.id);
 user.status = 'active';
 audit(user.id, 'VERIFY_EMAIL', 'user', user.id, { email: clean, ip });
 res.json({ token: signToken(user), user });
});

publicRouter.post('/resend-verification', async (req, res) => {
 const clean = String(req.body.email || '').toLowerCase().trim();
 const ip = clientIp(req);
 const rl = rateLimit(`resend:${ip}:${clean}`, 3, 10 * 60 * 1000);
 if (!rl.ok) return res.status(429).json({ error: `Please wait ${Math.ceil(rl.retryAfterSec / 60)} minute(s) before requesting another code` });
 const user = db.prepare(`
  SELECT u.id, u.email, u.status, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?
 `).get(clean);
 if (!user || user.role !== 'customer') return res.json({ ok: true }); // don't reveal existence
 if (user.status !== 'unverified') return res.json({ ok: true });
 const code = issueVerificationCode(clean);
 const sent = await sendVerificationCode(clean, code);
 audit(user.id, 'RESEND_VERIFICATION', 'user', user.id, { email: clean, ok: sent.sent, ip });
 if (!sent.sent) return res.status(500).json({ error: 'Could not send the email right now — try again shortly' });
 res.json({ ok: true, message: 'A new code is on its way' });
});

publicRouter.post('/login', (req, res) => {
 const { email, password } = req.body;
 const ip = clientIp(req);
 const clean = String(email || '').toLowerCase().trim();
 if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

 const ipLimit = rateLimit(`ip:${ip}`, 30, 10 * 60 * 1000);
 if (!ipLimit.ok) return res.status(429).json({ error: `Too many attempts from this network — try again in ${Math.ceil(ipLimit.retryAfterSec / 60)} minute(s)` });
 const key = `clogin:${clean}`;
 const emailLimit = rateLimit(key, 8, 10 * 60 * 1000);
 if (!emailLimit.ok) return res.status(429).json({ error: `Too many sign-in attempts — try again in ${Math.ceil(emailLimit.retryAfterSec / 60)} minute(s)` });
 const lock = lockState(key);
 if (lock.locked) return res.status(423).json({ error: `Account temporarily locked after repeated failures — try again in ${lock.minutesLeft} minute(s)` });

 const user = db.prepare(`
  SELECT u.id, u.name, u.email, u.phone, u.password_hash, u.status, u.token_ver, r.name AS role
  FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?
 `).get(clean);
 const valid = user && user.role === 'customer' && bcrypt.compareSync(String(password), user.password_hash);
 if (!valid) {
  registerFailure(key);
  audit(user ? user.id : null, 'LOGIN_FAIL', 'user', user ? user.id : null, { email: clean.slice(0, 80), ip, shop: true });
  return res.status(401).json({ error: 'Invalid email or password' });
 }
 if (user.status === 'unverified') {
  return res.status(403).json({ error: 'Verify your email address to activate your account', code: 'EMAIL_UNVERIFIED' });
 }
 if (user.status !== 'active') return res.status(403).json({ error: 'Account is disabled — contact support' });
 const gid = req.get('x-guest-id');
 if (gid && /^[A-Za-z0-9-]{8,64}$/.test(gid)) {
  try {
   transact(() => {
    const guestCart = db.prepare('SELECT * FROM carts WHERE guest_id = ?').get(gid);
    if (guestCart) {
     let cart = db.prepare('SELECT * FROM carts WHERE user_id = ?').get(user.id);
     if (!cart) {
      const info = db.prepare('INSERT INTO carts (user_id) VALUES (?)').run(user.id);
      cart = { id: Number(info.lastInsertRowid) };
     }
     const guestItems = db.prepare('SELECT * FROM cart_items WHERE cart_id = ?').all(guestCart.id);
     const addItem = db.prepare(
      'INSERT INTO cart_items (cart_id, product_id, quantity, unit_price, unit) VALUES (?,?,?,?,?) ' +
      'ON CONFLICT(cart_id, product_id) DO UPDATE SET quantity = cart_items.quantity + excluded.quantity'
     );
     for (const item of guestItems) addItem.run(cart.id, item.product_id, item.quantity, item.unit_price, item.unit || 'piece');
     db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(guestCart.id);
     db.prepare('DELETE FROM carts WHERE id = ?').run(guestCart.id);
    }
   });
  } catch (e) { /* merge must never break login */ }
 }
 audit(user.id, 'LOGIN', 'user', user.id, { email: clean, ip });
 clearFailures(key);
 res.json({ token: signToken(user), user });
});

// ---- protected (customer) ----

protectedRouter.get('/me', requireCustomer, (req, res) => {
  const user = db.prepare(`
   SELECT u.id, u.name, u.email, u.phone, u.status, u.credit_limit, u.balance, u.avatar, r.name AS role, u.created_at
   FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?
  `).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.avatar) user.avatar_url = `/uploads/avatars/${path.basename(user.avatar)}`;
  res.json({ user });
});

protectedRouter.post('/me/avatar', requireCustomer, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const rel = `/uploads/avatars/${req.file.filename}`;
  // remove old avatar
  const old = db.prepare('SELECT avatar FROM users WHERE id=?').get(req.user.id);
  if (old && old.avatar) {
    const oldPath = path.join(AVATAR_DIR, path.basename(old.avatar));
    try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch {}
  }
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(rel, req.user.id);
  audit(req.user.id, 'UPDATE', 'user', req.user.id, { field: 'avatar' });
  res.json({ ok: true, avatar: rel, avatar_url: rel });
});

protectedRouter.put('/me', requireCustomer, (req, res) => {
 const { name, phone, password, current_password } = req.body;
 const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
 if (!u) return res.status(404).json({ error: 'User not found' });
 if (password && !current_password) {
  return res.status(400).json({ error: 'Enter your current password to change it' });
 }
 if (password && !bcrypt.compareSync(String(current_password), u.password_hash)) {
  audit(req.user.id, 'CHANGE_PASSWORD_FAIL', 'user', req.user.id, { ip: clientIp(req), shop: true });
  return res.status(400).json({ error: 'Current password is incorrect' });
 }
 const fields = [];
 const params = [];
 let token;
 if (name !== undefined) { fields.push('name=?'); params.push(String(name).slice(0, 80)); }
 if (phone !== undefined) { fields.push('phone=?'); params.push(String(phone).slice(0, 30)); }
 if (password) {
  if (!passwordOk(password)) return res.status(400).json({ error: PASSWORD_RULE });
  const ver = (u.token_ver ?? 0) + 1;
  fields.push('password_hash=?'); params.push(bcrypt.hashSync(String(password), 10));
  fields.push('token_ver=?'); params.push(ver);
  token = signToken({ ...req.user, token_ver: ver });
 }
 if (fields.length) db.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).run(...params, req.user.id);
 audit(req.user.id, 'UPDATE', 'user', Number(req.user.id), { fields: fields.map((f) => f.split('=')[0]), ip: clientIp(req) });
 res.json({ ok: true, ...(token ? { token } : {}) });
});

// ---- addresses ----

protectedRouter.get('/addresses', requireCustomer, (req, res) => {
 res.json(db.prepare('SELECT * FROM customer_addresses WHERE user_id = ? ORDER BY is_default DESC, id').all(req.user.id));
});

protectedRouter.post('/addresses', requireCustomer, (req, res) => {
 const a = req.body;
 if (!a.address || !a.city) return res.status(400).json({ error: 'Address and city are required' });
 const id = transact(() => {
  if (a.is_default) db.prepare('UPDATE customer_addresses SET is_default=0 WHERE user_id=?').run(req.user.id);
  const info = db.prepare(`
   INSERT INTO customer_addresses (user_id, address_name, recipient_name, phone, address, city, postal_code, is_default)
   VALUES (?,?,?,?,?,?,?,?)
  `).run(req.user.id, a.address_name || null, a.recipient_name || req.user.name, a.phone || null, a.address, a.city, a.postal_code || null, a.is_default ? 1 : 0);
  audit(req.user.id, 'CREATE', 'address', Number(info.lastInsertRowid));
  return Number(info.lastInsertRowid);
 });
 res.status(201).json({ id });
});

protectedRouter.put('/addresses/:id', requireCustomer, (req, res) => {
 const a = req.body;
 const exists = db.prepare('SELECT id FROM customer_addresses WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
 if (!exists) return res.status(404).json({ error: 'Address not found' });
 transact(() => {
  if (a.is_default) db.prepare('UPDATE customer_addresses SET is_default=0 WHERE user_id=?').run(req.user.id);
  db.prepare(`
   UPDATE customer_addresses SET address_name=?, recipient_name=?, phone=?, address=?, city=?, postal_code=?, is_default=?
   WHERE id=?
  `).run(a.address_name || null, a.recipient_name || null, a.phone || null, a.address, a.city, a.postal_code || null, a.is_default ? 1 : 0, req.params.id);
  audit(req.user.id, 'UPDATE', 'address', Number(req.params.id));
 });
 res.json({ ok: true });
});

protectedRouter.delete('/addresses/:id', requireCustomer, (req, res) => {
 db.prepare('DELETE FROM customer_addresses WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
 res.json({ ok: true });
});

module.exports = { publicRouter, protectedRouter };