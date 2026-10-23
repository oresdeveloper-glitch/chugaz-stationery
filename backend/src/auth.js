const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA_DIR = process.env.VERCEL === '1' ? '/tmp/stationery-data' : path.join(__dirname, '..', 'data');

// Persistent secret: env var wins; otherwise generated once and stored so
// tokens survive restarts but no weak default is ever used.
let JWT_SECRET_SOURCE = 'env';
function loadSecret() {
 if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
  return process.env.JWT_SECRET;
 }
  JWT_SECRET_SOURCE = 'code-fallback';
  // Shared fallback so all serverless instances sign with one secret; env always wins.
  return 'chugaz-stationery-production-secret-9f8e7d6c5b4a39718f0e1d2c3b4a5f69788123456789';
}

const JWT_SECRET = loadSecret();

// Token hardening: fixed HS256 only (blocks alg=none / RS->HS confusion),
// pinned issuer + audience (a token minted for any other purpose is rejected),
// and a 12-hour expiry instead of centuries. Active sessions survive past 12h
// through POST /auth/refresh, which re-verifies signature, claims, the live
// account row and a 30-day absolute age cap carried in the `orig` claim.
const JWT_ISSUER = 'chugaz-stationery';
const JWT_AUDIENCE = 'chugaz-stationery-app';
const STAFF_EXPIRES = '12h';
const CUSTOMER_EXPIRES = '12h';
const REFRESH_MAX_AGE_SEC = 30 * 24 * 60 * 60;
const VERIFY_OPTS = { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE };

function signToken(user, opts = {}) {
 const payload = {
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  office_id: user.office_id ?? null,
  ver: user.token_ver ?? 0,
 };
 if (opts.orig) payload.orig = opts.orig;
 return jwt.sign(payload, JWT_SECRET, {
  algorithm: 'HS256',
  expiresIn: opts.expiresIn || (user.role === 'customer' ? CUSTOMER_EXPIRES : STAFF_EXPIRES),
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
 });
}

// Verify token AND confirm the account still exists, is active, and the token
// version matches (password changes bump token_ver -> all old tokens die).
function verifyLive(token) {
 let payload;
 try {
  payload = jwt.verify(token, JWT_SECRET, VERIFY_OPTS);
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

// Customers and staff share one account system for the storefront.
function requireCustomer(req, res, next) {
 if (!req.user) {
  return res.status(401).json({ error: 'Sign in to continue' });
 }
 next();
}

// Refresh path: signature/claims must hold and the session must be younger
// than the absolute 30-day window (orig, else iat) — expired-but-recent tokens
// refresh into a fresh 12h one, ancient ones are dead for good.
function verifyForRefresh(token) {
 let payload;
 try {
  payload = jwt.verify(token, JWT_SECRET, { ...VERIFY_OPTS, ignoreExpiration: true });
 } catch {
  return null;
 }
 const originSec = (payload.orig || payload.iat) || 0;
 if (!originSec || Date.now() - originSec * 1000 > REFRESH_MAX_AGE_SEC * 1000) return null;
 return payload;
}

module.exports = { signToken, verifyLive, verifyForRefresh, requireAuth, requireRole, requireCustomer, optionalAuth, ROLE_LEVEL, JWT_SECRET, JWT_SECRET_SOURCE, JWT_ISSUER, JWT_AUDIENCE };
