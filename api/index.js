const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

const { requireAuth, requireRole } = require('../backend/src/auth');
const customerRoutes = require('../backend/src/routes/customer');
const staff = [requireAuth, requireRole('clerk', 'cashier', 'manager', 'admin')];

app.use('/api/auth', require('../backend/src/routes/auth'));
app.use('/api/shop', require('../backend/src/routes/shop'));
app.use('/api/shop', customerRoutes.publicRouter);
app.use('/api/shop/cart', require('../backend/src/routes/cart'));
app.use('/api/shop', requireAuth, customerRoutes.protectedRouter);
app.use('/api/shop/orders', requireAuth, require('../backend/src/routes/customerOrders'));
app.use('/api/products', staff, require('../backend/src/routes/products'));
app.use('/api/suppliers', staff, require('../backend/src/routes/suppliers'));
app.use('/api/customers', staff, require('../backend/src/routes/customers'));
app.use('/api/purchases', requireAuth, requireRole('admin'), require('../backend/src/routes/purchases'));
app.use('/api/sales', staff, require('../backend/src/routes/sales'));
app.use('/api/stock', staff, require('../backend/src/routes/stock'));
app.use('/api/expenses', staff, require('../backend/src/routes/expenses'));
app.use('/api/users', staff, require('../backend/src/routes/users'));
app.use('/api/offices', staff, require('../backend/src/routes/offices'));
app.use('/api/reports', staff, require('../backend/src/routes/reports'));
app.use('/api/orders', staff, require('../backend/src/routes/orderAdmin'));
app.use('/api/messages', staff, require('../backend/src/routes/messages'));
app.use('/api/system', staff, require('../backend/src/routes/system'));

app.get('/api/health', (req, res) => res.json({ ok: true, db: 'connected', payment_instructions: '356322054 - CHUGAZ STATIONERY' }));

const dist = path.join(__dirname, '..', 'frontend', 'dist');
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
app.use(express.static(dist));
app.get('*', (req, res) => { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); res.sendFile(path.join(dist, 'index.html')); });

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

module.exports = app;