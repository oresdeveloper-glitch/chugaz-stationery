const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA_DIR = process.env.VERCEL === '1' ? '/tmp/stationery-data' : path.join(__dirname, '..', 'data');

// Persistent secret: env var wins; otherwise generated once and stored so
// tokens survive restarts but no weak default is ever used.
function loadSecret() {
 if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
  return process.env.JWT_SECRET;
 }
 const keyPath = path.join(DATA_DIR, 'secret.key');
 try {
  const existing = fs.readFileSync(keyPath, 'utf8').trim();
  if (existing.length >= 32) return existing;
 } catch {}
 const generated = require('crypto').randomBytes(48).toString('hex');
 fs.mkdirSync(DATA_DIR, { recursive: true });
 fs.writeFileSync(keyPath, generated, { mode: 0o600 });
 return generated;
}

const JWT_SECRET = loadSecret();
const STAFF_EXPIRES = process.env.JWT_EXPIRES || '12h';  // one shift
const CUSTOMER_EXPIRES = '7d';

function signToken(user, opts = {}) {
 const customer = user.role === 'customer';
 return jwt.sign(
  {
   id: user.id,
   email: user.email,
   name: user.name,
   role: user.role,
   office_id: user.office_id ?? null,
   ver: user.token_ver ?? 0,
  },
  JWT_SECRET,
  { expiresIn: opts.expiresIn || (customer ? CUSTOMER_EXPIRES : STAFF_EXPIRES) }
 );
}

// Verify token AND confirm the account still exists, is active, and the token
// version matches (password changes bump token_ver -> all old tokens die).
function verifyLive(token) {
 let payload;
 try {
  payload = jwt.verify(token, JWT_SECRET);
 } catch {
  return null;
 }
 const row = db.db.prepare(`
  SELECT u.id, u.name, u.email, u.status, u.token_ver, u.office_id, r.name AS role, o.name AS office
  FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN offices o ON o.id = u.office_id WHERE u.id = ?
 `).get(payload.id);
 if (!row || row.status !== 'active') return null;
 if ((row.token_ver ?? 0) !== (payload.ver ?? 0)) return null;
 return { id: row.id, email: row.email, name: row.name, role: row.role, office_id: row.office_id ?? null, office: row.office };
}

function requireAuth(req, res, next) {
 const header = req.headers.authorization || '';
 const token = header.startsWith('Bearer ') ? header.slice(7) : null;
 if (!token) return res.status(401).json({ error: 'Authentication required' });
 const user = verifyLive(token);
 if (!user) return res.status(401).json({ error: 'Invalid, expired or revoked session — sign in again' });
 req.user = user;
 next();
}

const ROLE_LEVEL = { admin: 4, manager: 3, cashier: 2, clerk: 1, customer: 0 };

function requireRole(...roles) {
 return (req, res, next) => {
  const level = ROLE_LEVEL[req.user.role];
  const allowed = roles.some((r) => level >= ROLE_LEVEL[r]);
  if (!allowed) return res.status(403).json({ error: 'Insufficient permissions' });
  next();
 };
}

function optionalAuth(req, res, next) {
 const header = req.headers.authorization || '';
 const token = header.startsWith('Bearer ') ? header.slice(7) : null;
 if (token) {
  const user = verifyLive(token);
  if (user) req.user = user;
 }
 next();
}

function requireCustomer(req, res, next) {
 if (!req.user || req.user.role !== 'customer') {
  return res.status(403).json({ error: 'Customer account required' });
 }
 next();
}

module.exports = { signToken, verifyLive, requireAuth, requireRole, requireCustomer, optionalAuth, ROLE_LEVEL, JWT_SECRET };
