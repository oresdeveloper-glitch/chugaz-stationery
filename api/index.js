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

// Health endpoint FIRST: never depends on DB/routes so the serverless
// function always responds even if a route module fails to load.
app.get('/api/health', (req, res) => {
  let dbReady = false;
  try {
    // eslint-disable-next-line no-eval
    dbReady = !!eval('require')('./backend/src/db').dbReady;
  } catch (_) {
    dbReady = false;
  }
  res.json({ ok: true, db: dbReady ? 'connected' : 'degraded', payment_instructions: '356322054 - CHUGAZ STATIONERY' });
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
let requireRole = () => (req, res, next) => next();
let staff = [(req, res, next) => next()];
try {
  const auth = require('./backend/src/auth');
  requireAuth = auth.requireAuth;
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
if (customerRoutes) {
  if (customerRoutes.publicRouter) app.use('/api/shop', customerRoutes.publicRouter);
  app.use('/api/shop/cart', safeRoute('./backend/src/routes/cart'));
  if (customerRoutes.protectedRouter) app.use('/api/shop', requireAuth, customerRoutes.protectedRouter);
} else {
  app.use('/api/shop/cart', safeRoute('./backend/src/routes/cart'));
}
app.use('/api/shop/orders', requireAuth, safeRoute('./backend/src/routes/customerOrders'));
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
app.use('/api/system', staff, safeRoute('./backend/src/routes/system'));

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

module.exports = app;
module.exports.default = app;
