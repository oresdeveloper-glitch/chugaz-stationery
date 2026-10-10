const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Instance affinity for diverged serverless databases: every response carries
// X-Db-Marker (which instance answered), and a request carrying
// X-Expect-Db-Marker that landed elsewhere is rejected with a 409 BEFORE any
// handler runs — so the client can safely retry until it is back on its own
// instance. That keeps reads and writes pinned to one database: the dashboard
// numbers only move when data really changes, never because a round-robin
// request hit a stale instance.
app.use((req, res, next) => {
  try {
    // eslint-disable-next-line no-eval
    const m = eval('require')('./backend/src/db');
    if (!m || !m.dbReady) return next();
    const row = m.db.prepare("SELECT value FROM settings WHERE key='db_marker'").get();
    const marker = row && row.value ? row.value : null;
    if (marker) res.setHeader('X-Db-Marker', marker);
    const expect = req.get('X-Expect-Db-Marker');
    if (marker && expect && expect !== marker) {
      return res.status(409).json({ error: 'instance_mismatch', code: 'instance_mismatch', db_marker: marker });
    }
  } catch (_) { /* affinity bookkeeping must never block a request */ }
  next();
});

// Instance identity for diagnostics (ephemeral on serverless: a changing id
// across calls proves requests land on different instances).
const INSTANCE_ID = require('crypto').randomBytes(4).toString('hex');
const BOOT_TIME = new Date().toISOString();

// Health endpoint FIRST: never depends on DB/routes so the serverless
// function always responds even if a route module fails to load.
app.get('/api/health', (req, res) => {
  let dbReady = false;
  let users = null;
  let db_marker = null;
  let sales = null;
  let orders = null;
  try {
    // eslint-disable-next-line no-eval
    const m = eval('require')('./backend/src/db');
    dbReady = !!m.dbReady;
    if (dbReady) {
      try { const r = m.db.prepare('SELECT COUNT(*) AS c FROM users').get(); users = r ? r.c : null; } catch (_) { users = null; }
      try { const r = m.db.prepare("SELECT value FROM settings WHERE key='db_marker'").get(); db_marker = r ? r.value : null; } catch (_) { db_marker = null; }
      try { sales = m.db.prepare('SELECT COUNT(*) AS c FROM sales').get().c; } catch (_) { sales = null; }
      try { orders = m.db.prepare('SELECT COUNT(*) AS c FROM orders').get().c; } catch (_) { orders = null; }
    }
  } catch (_) {
    dbReady = false;
  }
  // 'env' = stable shared secret; 'local' = per-instance generated secret
  // (sessions die across instances). Never exposes the value itself.
  let secret = 'unknown';
  try {
    // eslint-disable-next-line no-eval
    secret = eval('require')('./backend/src/auth').JWT_SECRET_SOURCE || 'unknown';
  } catch (_) {
    secret = 'unknown';
  }
  res.json({ ok: true, db: dbReady ? 'connected' : 'degraded', users, secret, instance: INSTANCE_ID, boot: BOOT_TIME, db_marker, sales, orders, payment_instructions: '356322054 - CHUGAZ STATIONERY' });
});

const SYNC_SQL = "SELECT (SELECT COUNT(*) FROM sales) || ':' || COALESCE((SELECT SUM(total) FROM sales),0) || ':' || COALESCE((SELECT SUM(paid_amount) FROM sales),0) || ':' || (SELECT COUNT(*) FROM sale_returns) || '|' || (SELECT COUNT(*) FROM orders) || ':' || COALESCE((SELECT MAX(updated_at) FROM orders),'') || '|' || (SELECT COUNT(*) FROM order_status_history) || '|' || (SELECT COUNT(*) FROM stock_movements) || '|' || (SELECT COUNT(*) FROM products) || ':' || COALESCE((SELECT SUM(selling_price) FROM products),0) || ':' || COALESCE((SELECT SUM(current_stock) FROM products),0) || '|' || (SELECT COUNT(*) FROM purchases) || '|' || (SELECT COUNT(*) FROM expenses) || '|' || (SELECT COUNT(*) FROM customers) || '|' || (SELECT COUNT(*) FROM users) || '|' || (SELECT COUNT(*) FROM payments) || '|' || (SELECT COUNT(*) FROM notifications) || '|' || (SELECT COUNT(*) FROM contact_messages) || '|' || (SELECT COUNT(*) FROM order_returns) || ':' || COALESCE((SELECT MAX(processed_at) FROM order_returns),'') || '|' || (SELECT COUNT(*) FROM audit_logs WHERE action NOT IN ('LOGIN','LOGIN_FAIL','LOGIN_RESTORE','READ','RESTORE','RESTORE_MERGE')) || '|' || (SELECT COUNT(*) FROM categories) || ':' || (SELECT COUNT(*) FROM product_categories) || ':' || (SELECT COUNT(*) FROM brands) || ':' || (SELECT COUNT(*) FROM suppliers) || '|' || (SELECT COALESCE(SUM(LENGTH(COALESCE(name,''))+LENGTH(COALESCE(sku,''))+LENGTH(COALESCE(status,''))+LENGTH(COALESCE(image,''))+LENGTH(COALESCE(description,''))+LENGTH(COALESCE(unit,''))),0) FROM products) || ':' || (SELECT COALESCE(SUM(LENGTH(COALESCE(name,''))+LENGTH(COALESCE(phone,''))+LENGTH(COALESCE(email,''))),0) FROM customers) || ':' || (SELECT COALESCE(SUM(LENGTH(COALESCE(name,''))+LENGTH(COALESCE(email,''))+LENGTH(COALESCE(status,''))+LENGTH(COALESCE(avatar,''))),0) FROM users) AS v";
const SYNC_DATA_SQL = "SELECT (SELECT COUNT(*) FROM sales) || ':' || COALESCE((SELECT SUM(total) FROM sales),0) || ':' || COALESCE((SELECT SUM(paid_amount) FROM sales),0) || ':' || (SELECT COUNT(*) FROM sale_returns) || '|' || (SELECT COUNT(*) FROM orders) || ':' || COALESCE((SELECT MAX(updated_at) FROM orders),'') || '|' || (SELECT COUNT(*) FROM order_status_history) || '|' || (SELECT COUNT(*) FROM stock_movements) || '|' || (SELECT COUNT(*) FROM products) || ':' || COALESCE((SELECT SUM(selling_price) FROM products),0) || ':' || COALESCE((SELECT SUM(current_stock) FROM products),0) || '|' || (SELECT COUNT(*) FROM purchases) || '|' || (SELECT COUNT(*) FROM expenses) || '|' || (SELECT COUNT(*) FROM customers) || '|' || (SELECT COUNT(*) FROM users) || '|' || (SELECT COUNT(*) FROM payments) || '|' || (SELECT COUNT(*) FROM notifications) || '|' || (SELECT COUNT(*) FROM contact_messages) || '|' || (SELECT COUNT(*) FROM order_returns) || ':' || COALESCE((SELECT MAX(processed_at) FROM order_returns),'') || '|' || '0' || '|' || (SELECT COUNT(*) FROM categories) || ':' || (SELECT COUNT(*) FROM product_categories) || ':' || (SELECT COUNT(*) FROM brands) || ':' || (SELECT COUNT(*) FROM suppliers) || '|' || (SELECT COALESCE(SUM(LENGTH(COALESCE(name,''))+LENGTH(COALESCE(sku,''))+LENGTH(COALESCE(status,''))+LENGTH(COALESCE(image,''))+LENGTH(COALESCE(description,''))+LENGTH(COALESCE(unit,''))),0) FROM products) || ':' || (SELECT COALESCE(SUM(LENGTH(COALESCE(name,''))+LENGTH(COALESCE(phone,''))+LENGTH(COALESCE(email,''))),0) FROM customers) || ':' || (SELECT COALESCE(SUM(LENGTH(COALESCE(name,''))+LENGTH(COALESCE(email,''))+LENGTH(COALESCE(status,''))+LENGTH(COALESCE(avatar,''))),0) FROM users) AS v";

app.get('/api/sync', (req, res) => {
  let version = null, dataVersion = null;
  try {
    // eslint-disable-next-line no-eval
    const m = eval('require')('./backend/src/db');
    if (m && m.dbReady) {
      try {
        const r = m.db.prepare(SYNC_SQL).get();
        version = r && r.v != null ? String(r.v) : null;
      } catch (_) {
        try { version = 's' + m.db.prepare('SELECT COUNT(*) c FROM sales').get().c; dataVersion = version; } catch (__) { version = null; }
      }
      try {
        const d = m.db.prepare(SYNC_DATA_SQL).get();
        dataVersion = d && d.v != null ? String(d.v) : null;
      } catch (_) {}
    }
  } catch (_) { version = null; }
  res.json({ ok: true, version, data_version: dataVersion, db_marker: res.getHeader('X-Db-Marker') || null });
});

function safeRoute(routePath) {
  try {
    return require(routePath);
  } catch (err) {
    console.error('[api] failed to load ' + routePath + ':', err && err.message ? err.message : err);
    const router = express.Router();
    router.use((req, res) => res.status(503).json({ error: 'Service temporarily unavailable' }));
    return router;
  }
}

let requireAuth = (req, res, next) => next();
let optionalAuth = (req, res, next) => next();
let requireRole = () => (req, res, next) => next();
let staff = [(req, res, next) => next()];
try {
  const auth = require('./backend/src/auth');
  requireAuth = auth.requireAuth;
  optionalAuth = auth.optionalAuth;
  requireRole = auth.requireRole;
  staff = [requireAuth, requireRole('clerk', 'cashier', 'manager', 'admin')];
} catch (err) {
  console.error('[api] auth module failed to load:', err && err.message ? err.message : err);
}

let customerRoutes = null;
try {
  customerRoutes = require('./backend/src/routes/customer');
} catch (err) {
  console.error('[api] customer routes failed to load:', err && err.message ? err.message : err);
}

app.use('/api/auth', safeRoute('./backend/src/routes/auth'));
app.use('/api/shop', safeRoute('./backend/src/routes/shop'));
// Orders BEFORE the protectedRouter mount: its requireAuth would otherwise
// reject guest checkouts before they reach the guest-aware orders router.
app.use('/api/shop/orders', optionalAuth, safeRoute('./backend/src/routes/customerOrders'));
if (customerRoutes) {
  if (customerRoutes.publicRouter) app.use('/api/shop', customerRoutes.publicRouter);
  app.use('/api/shop/cart', safeRoute('./backend/src/routes/cart'));
  if (customerRoutes.protectedRouter) app.use('/api/shop', requireAuth, customerRoutes.protectedRouter);
} else {
  app.use('/api/shop/cart', safeRoute('./backend/src/routes/cart'));
}
app.use('/api/products', staff, safeRoute('./backend/src/routes/products'));
app.use('/api/suppliers', staff, safeRoute('./backend/src/routes/suppliers'));
app.use('/api/customers', staff, safeRoute('./backend/src/routes/customers'));
app.use('/api/purchases', requireAuth, requireRole('admin'), safeRoute('./backend/src/routes/purchases'));
app.use('/api/sales', staff, safeRoute('./backend/src/routes/sales'));
app.use('/api/stock', staff, safeRoute('./backend/src/routes/stock'));
app.use('/api/expenses', staff, safeRoute('./backend/src/routes/expenses'));
app.use('/api/users', staff, safeRoute('./backend/src/routes/users'));
app.use('/api/offices', staff, safeRoute('./backend/src/routes/offices'));
app.use('/api/reports', staff, safeRoute('./backend/src/routes/reports'));
app.use('/api/orders', staff, safeRoute('./backend/src/routes/orderAdmin'));
app.use('/api/messages', staff, safeRoute('./backend/src/routes/messages'));
app.use('/api/notifications', staff, safeRoute('./backend/src/routes/notifications'));
app.use('/api/system', staff, safeRoute('./backend/src/routes/system'));

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

module.exports = app;
module.exports.default = app;
