const path = require('path');
try { require('dotenv').config(); } catch (e) {}

const express = require('express');
const cors = require('cors');

const { db } = require('./src/db');
const { requireAuth, requireRole, optionalAuth } = require('./src/auth');

const app = express();
const PORT = process.env.PORT || 7860;
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 4001);
const isHuggingFace = process.env.SPACE_ID || process.env.HF_SPACE || process.env.HUGGINGFACE_SPACE;
const isProduction = process.env.NODE_ENV === 'production' || isHuggingFace;

// An error in an async route must never take the whole server down.
process.on('unhandledRejection', (reason) => {
 console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
 console.error('[uncaughtException]', err);
});

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Basic security headers
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
  const m = require('./src/db');
  if (!m || !m.dbReady) return next();
  const row = m.db.prepare("SELECT value FROM settings WHERE key='db_marker'").get();
  const marker = row && row.value ? row.value : null;
  if (marker) res.setHeader('X-Db-Marker', marker);
  // EventSource cannot send custom headers, so the SSE channel passes its
  // pinned marker as ?marker= instead; the same 409 rule applies to it - the
  // browser then retries the stream until it lands on the pinned instance.
  const q = req.path === '/api/events' ? req.query.marker : null;
  const expect = req.get('X-Expect-Db-Marker') || (typeof q === 'string' && q ? q : null);
  if (marker && expect && expect !== marker) {
   return res.status(409).json({ error: 'instance_mismatch', code: 'instance_mismatch', db_marker: marker });
  }
 } catch (_) { /* affinity bookkeeping must never block a request */ }
 next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Public
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/shop', require('./src/routes/shop'));
const customerRoutes = require('./src/routes/customer');
app.use('/api/shop', customerRoutes.publicRouter);
app.use('/api/shop/cart', require('./src/routes/cart'));
// Orders BEFORE the protectedRouter mount: its requireAuth would otherwise
// reject guest checkouts before they reach the guest-aware orders router.
// Customer orders: signed-in customers AND guests (guest checkout needs no token)
app.use('/api/shop/orders', optionalAuth, require('./src/routes/customerOrders'));
app.use('/api/shop', requireAuth, customerRoutes.protectedRouter);

// Staff protected (all staff roles; individual routes may require more)
const staff = [requireAuth, requireRole('clerk', 'cashier', 'manager', 'admin')];
app.use('/api/products', staff, require('./src/routes/products'));
app.use('/api/suppliers', staff, require('./src/routes/suppliers'));
app.use('/api/customers', staff, require('./src/routes/customers'));
app.use('/api/purchases', requireAuth, requireRole('admin'), require('./src/routes/purchases'));
app.use('/api/sales', staff, require('./src/routes/sales'));
app.use('/api/stock', staff, require('./src/routes/stock'));
app.use('/api/expenses', staff, require('./src/routes/expenses'));
app.use('/api/users', staff, require('./src/routes/users'));
app.use('/api/offices', staff, require('./src/routes/offices'));
app.use('/api/reports', staff, require('./src/routes/reports'));
app.use('/api/orders', staff, require('./src/routes/orderAdmin'));
app.use('/api/messages', staff, require('./src/routes/messages'));
app.use('/api/notifications', staff, require('./src/routes/notifications'));
app.use('/api/system', staff, require('./src/routes/system'));

app.get('/api/health', (req, res) => {
  try {
    const m = require('./src/db');
    let users = null, db_marker = null, sales = null, orders = null, categories = null, reset_at = null;
    if (m.dbReady) {
      try { users = m.db.prepare('SELECT COUNT(*) c FROM users').get().c; } catch (_) {}
      try { db_marker = m.db.prepare("SELECT value FROM settings WHERE key='db_marker'").get()?.value || null; } catch (_) {}
      try { sales = m.db.prepare('SELECT COUNT(*) c FROM sales').get().c; } catch (_) {}
      try { orders = m.db.prepare('SELECT COUNT(*) c FROM orders').get().c; } catch (_) {}
      try { categories = m.db.prepare('SELECT COUNT(*) c FROM categories').get().c; } catch (_) {}
      // Epoch of the last deliberate admin transaction-wipe. A browser that
      // has seen a NEWER epoch than its own stamp must forget its snapshot
      // instead of merging the deleted rows back (see POST /reset-transactions).
      try { reset_at = Number(m.db.prepare("SELECT value FROM settings WHERE key='reset_at'").get()?.value) || null; } catch (_) {}
    }
    res.json({ ok: true, db: m.dbReady ? 'connected' : 'degraded', users, db_marker, sales, orders, categories, reset_at });
  } catch (_) {
    res.json({ ok: true, db: 'connected', users: null, db_marker: null, sales: null, orders: null, reset_at: null });
  }
});

const SYNC_SQL = "SELECT (SELECT COUNT(*) FROM sales) || ':' || COALESCE((SELECT SUM(total) FROM sales),0) || ':' || COALESCE((SELECT SUM(paid_amount) FROM sales),0) || ':' || (SELECT COUNT(*) FROM sale_returns) || '|' || (SELECT COUNT(*) FROM orders) || ':' || COALESCE((SELECT MAX(updated_at) FROM orders),'') || '|' || (SELECT COUNT(*) FROM order_status_history) || '|' || (SELECT COUNT(*) FROM stock_movements) || '|' || (SELECT COUNT(*) FROM products) || ':' || COALESCE((SELECT SUM(selling_price) FROM products),0) || ':' || COALESCE((SELECT SUM(current_stock) FROM products),0) || '|' || (SELECT COUNT(*) FROM purchases) || '|' || (SELECT COUNT(*) FROM expenses) || '|' || (SELECT COUNT(*) FROM customers) || '|' || (SELECT COUNT(*) FROM users) || '|' || (SELECT COUNT(*) FROM payments) || '|' || (SELECT COUNT(*) FROM notifications) || '|' || (SELECT COUNT(*) FROM contact_messages) || '|' || (SELECT COUNT(*) FROM order_returns) || ':' || COALESCE((SELECT MAX(processed_at) FROM order_returns),'') || '|' || (SELECT COUNT(*) FROM audit_logs WHERE action NOT IN ('LOGIN','LOGIN_FAIL','LOGIN_RESTORE','READ','RESTORE','RESTORE_MERGE')) || '|' || (SELECT COUNT(*) FROM categories) || ':' || (SELECT COUNT(*) FROM product_categories) || ':' || (SELECT COUNT(*) FROM brands) || ':' || (SELECT COUNT(*) FROM suppliers) || '|' || (SELECT COALESCE(SUM(LENGTH(COALESCE(name,''))+LENGTH(COALESCE(sku,''))+LENGTH(COALESCE(status,''))+LENGTH(COALESCE(image,''))+LENGTH(COALESCE(description,''))+LENGTH(COALESCE(unit,''))),0) FROM products) || ':' || (SELECT COALESCE(SUM(LENGTH(COALESCE(name,''))+LENGTH(COALESCE(phone,''))+LENGTH(COALESCE(email,''))),0) FROM customers) || ':' || (SELECT COALESCE(SUM(LENGTH(COALESCE(name,''))+LENGTH(COALESCE(email,''))+LENGTH(COALESCE(status,''))+LENGTH(COALESCE(avatar,''))),0) FROM users) AS v";
const SYNC_DATA_SQL = "SELECT (SELECT COUNT(*) FROM sales) || ':' || COALESCE((SELECT SUM(total) FROM sales),0) || ':' || COALESCE((SELECT SUM(paid_amount) FROM sales),0) || ':' || (SELECT COUNT(*) FROM sale_returns) || '|' || (SELECT COUNT(*) FROM orders) || ':' || COALESCE((SELECT MAX(updated_at) FROM orders),'') || '|' || (SELECT COUNT(*) FROM order_status_history) || '|' || (SELECT COUNT(*) FROM stock_movements) || '|' || (SELECT COUNT(*) FROM products) || ':' || COALESCE((SELECT SUM(selling_price) FROM products),0) || ':' || COALESCE((SELECT SUM(current_stock) FROM products),0) || '|' || (SELECT COUNT(*) FROM purchases) || '|' || (SELECT COUNT(*) FROM expenses) || '|' || (SELECT COUNT(*) FROM customers) || '|' || (SELECT COUNT(*) FROM users) || '|' || (SELECT COUNT(*) FROM payments) || '|' || (SELECT COUNT(*) FROM notifications) || '|' || (SELECT COUNT(*) FROM contact_messages) || '|' || (SELECT COUNT(*) FROM order_returns) || ':' || COALESCE((SELECT MAX(processed_at) FROM order_returns),'') || '|' || '0' || '|' || (SELECT COUNT(*) FROM categories) || ':' || (SELECT COUNT(*) FROM product_categories) || ':' || (SELECT COUNT(*) FROM brands) || ':' || (SELECT COUNT(*) FROM suppliers) || '|' || (SELECT COALESCE(SUM(LENGTH(COALESCE(name,''))+LENGTH(COALESCE(sku,''))+LENGTH(COALESCE(status,''))+LENGTH(COALESCE(image,''))+LENGTH(COALESCE(description,''))+LENGTH(COALESCE(unit,''))),0) FROM products) || ':' || (SELECT COALESCE(SUM(LENGTH(COALESCE(name,''))+LENGTH(COALESCE(phone,''))+LENGTH(COALESCE(email,''))),0) FROM customers) || ':' || (SELECT COALESCE(SUM(LENGTH(COALESCE(name,''))+LENGTH(COALESCE(email,''))+LENGTH(COALESCE(status,''))+LENGTH(COALESCE(avatar,''))),0) FROM users) AS v";

app.get('/api/sync', (req, res) => {
  let version = null, dataVersion = null, sales = null, orders = null, categories = null, reset_at = null;
  try {
    const m = require('./src/db');
    if (m.dbReady) {
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
      // Row counts let the client ELECT a canonical leader: serverless runs
      // several instances on independent ephemeral disks, and the instance a
      // session happens to pin first can be an empty twin (sales=0) while
      // another holds the real data. Reporting counts here lets the client
      // discover the instance with the most data, merge everything into it,
      // and re-pin there — so the POS total stops snapping back to 0.
      try { sales = m.db.prepare('SELECT COUNT(*) c FROM sales').get().c; } catch (_) {}
      try { orders = m.db.prepare('SELECT COUNT(*) c FROM orders').get().c; } catch (_) {}
      try { categories = m.db.prepare('SELECT COUNT(*) c FROM categories').get().c; } catch (_) {}
      // Deliberate-wipe epoch: instance ranking must put a fresher reset_at
      // above raw counts, or an un-reset twin (old sales) would win the
      // election and the deleted history would come back.
      try { reset_at = Number(m.db.prepare("SELECT value FROM settings WHERE key='reset_at'").get()?.value) || null; } catch (_) {}
    }
  } catch (_) { version = null; }
  res.json({ ok: true, version, data_version: dataVersion, db_marker: res.getHeader('X-Db-Marker') || null, sales, orders, categories, reset_at });
});

// Live push channel (SSE). The browser opens this once and the server sends
// an event the instant the data-version hash changes, so every open page
// learns about a new sale/order/stock write as soon as it is generated - the
// client runs no polling timers at all. The event is only a HINT: the client
// re-runs its authoritative pinned /sync check before announcing anything, so
// a push from a diverged instance can never show wrong numbers - it can only
// make the truth arrive sooner. EventSource cannot send custom headers, so
// affinity passes the pinned marker as ?marker= (same 409 rule as
// X-Expect-Db-Marker above). Unauthenticated, exactly like /api/sync (same
// information level: hash-change notices, no data payloads).
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2500\n\n');
  let ownMarker = null;
  try {
    const m = require('./src/db');
    if (m && m.dbReady) {
      const row = m.db.prepare("SELECT value FROM settings WHERE key='db_marker'").get();
      ownMarker = row && row.value ? row.value : null;
    }
  } catch (_) { /* degraded db: hello still carries version */ }
  const readVersion = () => {
    try {
      const m = require('./src/db');
      if (!m || !m.dbReady) return null;
      const r = m.db.prepare(SYNC_SQL).get();
      return r && r.v != null ? String(r.v) : null;
    } catch (_) { return null; }
  };
  let last = readVersion();
  let closed = false;
  let iv = null;
  const stop = () => {
    if (closed) return;
    closed = true;
    if (iv) clearInterval(iv);
    try { res.end(); } catch (_) { /* already gone */ }
  };
  res.write('data: ' + JSON.stringify({ type: 'hello', version: last, db_marker: ownMarker }) + '\n\n');
  iv = setInterval(() => {
    if (closed) return;
    const v = readVersion();
    if (v !== last) {
      last = v;
      try { res.write('data: ' + JSON.stringify({ type: 'change', version: v }) + '\n\n'); } catch (_) { stop(); }
    } else {
      try { res.write(': ping\n\n'); } catch (_) { stop(); }
    }
  }, 1500);
  req.on('close', stop);
  req.on('error', stop);
});

// Serve built frontend in production (after `npm run build` in frontend/)
const dist = path.join(__dirname, '..', 'frontend', 'dist');
let httpsCert = null;
app.get('/cert.crt', (req, res) => {
 if (!httpsCert) return res.status(503).send('Certificate not ready yet, retry in a moment.');
 res.setHeader('Content-Type', 'application/x-x509-ca-cert');
 res.setHeader('Content-Disposition', 'attachment; filename="localhost.crt"');
 res.send(httpsCert);
});
app.get('/install-cert', (req, res) => {
 res.setHeader('Content-Type', 'text/html; charset=utf-8');
 res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Install local certificate</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;line-height:1.55}code{background:#f0f0f0;padding:2px 6px;border-radius:4px}li{margin:8px 0}h2{margin-top:28px}</style></head>
<body><h1>Install the local certificate on your phone</h1><p>This removes the "not private" warning when you open <code>https://192.168.100.14:${HTTPS_PORT}</code> from your phone.</p>
<p><a class="dl" href="/cert.crt">⬇ Download the certificate (localhost.crt)</a></p>
<h2>Android (Chrome / Edge / Firefox)</h2><ol><li>Tap the download above and open the file.</li><li>Android shows a "Certificate" screen — confirm installing it as a <b>CA certificate</b> (enter your phone PIN if asked).</li><li>After it says <b>Certificate installed</b>, open the app at <code>https://192.168.100.14:${HTTPS_PORT}</code> — no warning, and the camera works.</li><li>If Chrome still warns, use <b>Edge</b> or <b>Firefox</b> (they trust installed certificates).</li></ol>
<h2>iPhone / iPad (Safari)</h2><ol><li>Tap the download above — Safari downloads the profile.</li><li>Open <b>Settings → General → VPN & Device Management</b>, tap the profile, tap <b>Install</b>.</li><li>Go to <b>Settings → General → About → Certificate Trust Settings</b> and switch <b>Full Trust</b> on for <b>localhost</b>.</li><li>Open <code>https://192.168.100.14:${HTTPS_PORT}</code> in Safari — no warning, and the camera works.</li></ol>
<p style="color:#666">This certificate only works on your local network and can only identify this server — it is safe to install.</p></body></html>`);
});
if ((process.env.SERVE_FRONTEND || '1') === '1' && require('fs').existsSync(dist)) {
 // Unknown API paths must return a clean JSON 404 — never the HTML app.
 app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found' }));
 app.use(express.static(dist, {
  setHeaders: (res, filePath) => {
   if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
   else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  },
 }));
 app.get('*', (req, res) => { res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); res.sendFile(path.join(dist, 'index.html')); });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

module.exports = app;

if (!module.parent) {
  const PORT = process.env.PORT || 7860;
  const isHuggingFace = process.env.SPACE_ID || process.env.HF_SPACE || process.env.HUGGINGFACE_SPACE;
  const ALT_PORT = Number(process.env.ALT_PORT || 4002);
  if ((process.env.SERVE_FRONTEND || '1') === '1') {
    app.listen(ALT_PORT, () => {
      console.log(`App also running on http://localhost:${ALT_PORT}`);
    });
  }
  if ((process.env.SERVE_FRONTEND || '1') === '1') {
    (async () => {
      try {
        const fs = require('fs');
        const os = require('os');
        const https = require('https');
        const crypto = require('crypto');
        const selfsigned = require('selfsigned');
        const certDir = path.join(__dirname, '..', 'certs');
        const keyPath = path.join(certDir, 'key.pem');
        const certPath = path.join(certDir, 'cert.pem');
        const lanIPs = [];
        const ifaces = os.networkInterfaces();
        for (const name of Object.keys(ifaces || {})) {
          for (const iface of ifaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) lanIPs.push(iface.address);
          }
        }
        const sanNames = ['localhost', '127.0.0.1', ...lanIPs];
        const sanIncludes = (sanStr, name) => sanStr.includes(name === 'localhost' ? 'DNS:localhost' : `IP Address:${name}`);
        let key, cert;
        if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
          key = fs.readFileSync(keyPath);
          cert = fs.readFileSync(certPath);
          let currentSan = '';
          try { currentSan = new crypto.X509Certificate(cert).subjectAltName || ''; } catch (e) { /* regenerate below */ }
          if (!sanNames.every((n) => sanIncludes(currentSan, n))) cert = null;
        }
        if (!cert) {
          fs.mkdirSync(certDir, { recursive: true });
          const pems = await selfsigned.generate(
            [{ name: 'commonName', value: 'localhost' }],
            { days: 825, keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...lanIPs.map((ip) => ({ type: 7, ip }))] }] },
          );
          key = pems.private;
          cert = pems.cert;
          fs.writeFileSync(keyPath, key);
          fs.writeFileSync(certPath, cert);
        }
        httpsCert = cert;
        https.createServer({ key, cert }, app).listen(HTTPS_PORT, () => {
          console.log(`HTTPS server running on https://localhost:${HTTPS_PORT}`);
        });
      } catch (e) {
        console.error('HTTPS server failed to start:', e.message);
      }
    })();
  }
  if (isHuggingFace) {
    app.listen(PORT, '0.0.0.0', () => { console.log(`API server running on http://0.0.0.0:${PORT} (HF Spaces)`); });
  } else {
    app.listen(PORT, () => { console.log(`API server running on http://localhost:${PORT}`); });
  }
}