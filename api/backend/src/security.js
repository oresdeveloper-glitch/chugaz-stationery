// In-memory brute-force protection: per-key sliding window limiter + account lockout.
const windows = new Map();  // key -> { count, firstAt }
const failures = new Map(); // key -> { count, lockedUntil }

function prune() {
 const now = Date.now();
 for (const [k, w] of windows) if (now - w.firstAt > 60 * 60 * 1000) windows.delete(k);
 for (const [k, f] of failures) if (f.lockedUntil && f.lockedUntil < now - 60 * 60 * 1000) failures.delete(k);
}

// Generic rate limit: max requests per windowMs per key.
function rateLimit(key, max, windowMs) {
 prune();
 const now = Date.now();
 let w = windows.get(key);
 if (!w || now - w.firstAt > windowMs) {
  w = { count: 0, firstAt: now };
  windows.set(key, w);
 }
 w.count += 1;
 if (w.count > max) {
  const retryAfterSec = Math.ceil((w.firstAt + windowMs - now) / 1000);
  return { ok: false, retryAfterSec };
 }
 return { ok: true, remaining: max - w.count };
}

// Lockout: after maxFails failures inside failWindowMs, key is locked lockMs.
function registerFailure(key, { maxFails = 5, failWindowMs = 10 * 60 * 1000, lockMs = 15 * 60 * 1000 } = {}) {
 prune();
 const now = Date.now();
 let f = failures.get(key) || { count: 0, firstAt: now, lockedUntil: 0 };
 if (now - f.firstAt > failWindowMs) { f = { count: 0, firstAt: now, lockedUntil: 0 }; }
 f.count += 1;
 if (f.count >= maxFails) {
  f.lockedUntil = now + lockMs;
  f.count = 0;
  f.firstAt = now;
 }
 failures.set(key, f);
 return f;
}

function lockState(key) {
 const f = failures.get(key);
 if (!f || !f.lockedUntil) return { locked: false };
 const remainingMs = f.lockedUntil - Date.now();
 if (remainingMs <= 0) return { locked: false };
 return { locked: true, minutesLeft: Math.ceil(remainingMs / 60000) };
}

function clearFailures(key) {
 failures.delete(key);
}

function clientIp(req) {
 const xf = req.headers['x-forwarded-for'];
 if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
 return req.socket?.remoteAddress || 'unknown';
}

module.exports = { rateLimit, registerFailure, lockState, clearFailures, clientIp };
