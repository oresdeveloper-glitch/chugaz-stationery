// Native bcrypt, not bcryptjs: cost-12 verify in pure JS blocked the event
// loop for ~1.4s on EVERY login (all other requests queued behind it on the
// single-threaded server); the native build measured 574ms for the same
// verify on this machine and less on server CPUs. Hash formats are
// interchangeable ($2a$/$2b$), so existing rows verify as-is.
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { JWT_SECRET } = require('./auth');
const { db } = require('./db');

const COST = 12;
// Per-deployment pepper mixed into every hash: a stolen database file alone
// can no longer be brute-forced offline — the attacker also needs this secret.
// Derived from the shared JWT secret so all serverless instances agree without
// any extra configuration; AUTH_PEPPER overrides it when provided.
const PEPPER = process.env.AUTH_PEPPER ||
  crypto.createHmac('sha256', JWT_SECRET).update('chugaz-pwd-pepper-v1').digest('hex').slice(0, 32);

function peppered(plain) {
  return crypto.createHash('sha256').update(String(plain) + PEPPER, 'utf8').digest('hex');
}

function tryCompare(plain, hash) {
  try { return bcrypt.compareSync(plain, hash); } catch (_) { return false; }
}

function costOf(hash) {
  const m = /^\$2[aby]\$(\d{2})\$/.exec(hash || '');
  return m ? Number(m[1]) : 0;
}

function hashPassword(plain) {
  return bcrypt.hashSync(peppered(plain), COST);
}

// Accepts peppered cost-12 hashes and legacy raw cost-10 hashes; a legacy
// match asks the caller to rehash through upgradeUserPassword().
function verifyPassword(plain, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('$2')) return { ok: false, needsRehash: false };
  if (tryCompare(peppered(plain), stored)) return { ok: true, needsRehash: costOf(stored) < COST };
  if (tryCompare(String(plain), stored)) return { ok: true, needsRehash: true };
  return { ok: false, needsRehash: false };
}

function upgradeUserPassword(userId, plain) {
  try {
    const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId);
    if (!row) return;
    const v = verifyPassword(plain, row.password_hash);
    if (v.ok && v.needsRehash) db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(plain), userId);
  } catch (_) { /* best-effort upgrade — the login itself already succeeded */ }
}

const PASSWORD_RULE = 'Password must be at least 10 characters with a capital letter or a symbol, plus letters and numbers';
const LEGACY_RULE = 'Password must be at least 8 characters and contain both letters and numbers';

const COMMON = [
  'password', 'password1', 'password12', 'password123', 'password1234', 'password12345',
  '123456789', '1234567890', 'qwerty123', 'qwertyuiop', 'letmein123', 'welcome123',
  'iloveyou123', 'admin12345', 'administrator1', 'changeme123', 'football123',
  'monkey12345', 'dragon12345', 'sunshine123', 'princess123', 'trustno1234',
  'starwars123', 'baseball123', 'superman123', 'michael123', 'shadow12345',
  'master12345', 'jennifer123', 'jordan12345', 'hunter12345', 'harley12345',
  'ranger12345', 'buster12345', 'thomas12345', 'robert12345', 'soccer12345',
  'batman12345', 'passw0rd123', 'p@ssw0rd123', 'test12345678', 'testtest123',
  'stationery1', 'chugaz12345', 'qwerty12345', 'welcome1234', 'letmein1234',
];

// Strong policy for every place a password is CHOSEN (register, password
// change, admin reset). Sign-in/recovery gates keep the legacy rule so
// accounts created before this hardening can still sign in and recover.
function passwordPolicy(plain, { email, name } = {}) {
  const pw = String(plain == null ? '' : plain);
  if (pw.length < 10 || pw.length > 200) return { ok: false, error: PASSWORD_RULE };
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return { ok: false, error: PASSWORD_RULE };
  if (!/[A-Z]/.test(pw) && !/[^A-Za-z0-9]/.test(pw)) {
    return { ok: false, error: 'Add a capital letter or a symbol to the password' };
  }
  const low = pw.toLowerCase();
  if (COMMON.includes(low)) return { ok: false, error: 'That password is too common — choose something unique' };
  if (email) {
    const local = String(email).toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '');
    if (local.length >= 3 && low.replace(/[^a-z0-9]/g, '').includes(local)) {
      return { ok: false, error: 'Password must not contain your email address' };
    }
  }
  if (name) {
    const nm = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (nm.length >= 4 && low.replace(/[^a-z0-9]/g, '').includes(nm)) {
      return { ok: false, error: 'Password must not contain your name' };
    }
  }
  return { ok: true };
}

const legacyPasswordOk = (p) => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);

module.exports = {
  COST,
  PASSWORD_RULE,
  LEGACY_RULE,
  hashPassword,
  verifyPassword,
  upgradeUserPassword,
  passwordPolicy,
  legacyPasswordOk,
};
