const path = require('path');
try { require('dotenv').config(); } catch (e) {}

const express = require('express');
const cors = require('cors');

const { db } = require('./src/db');
const { requireAuth, requireRole } = require('./src/auth');

const app = express();
const PORT = process.env.PORT || 4000;

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

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Public
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/shop', require('./src/routes/shop'));
const customerRoutes = require('./src/routes/customer');
app.use('/api/shop', customerRoutes.publicRouter);
app.use('/api/shop/cart', require('./src/routes/cart'));
app.use('/api/shop', requireAuth, customerRoutes.protectedRouter);

// Customer (requires customer token)
app.use('/api/shop/orders', requireAuth, require('./src/routes/customerOrders'));

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
app.use('/api/system', staff, require('./src/routes/system'));

app.get('/api/health', (req, res) => res.json({ ok: true, db: 'connected' }));

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
<p><a class="dl" href="/cert.crt">â¬‡ Download the certificate (localhost.crt)</a></p>
<h2>Android (Chrome / Edge / Firefox)</h2><ol><li>Tap the download above and open the file.</li><li>Android shows a "Certificate" screen â€” confirm installing it as a <b>CA certificate</b> (enter your phone PIN if asked).</li><li>After it says <b>Certificate installed</b>, open the app at <code>https://192.168.100.14:${HTTPS_PORT}</code> â€” no warning, and the camera works.</li><li>If Chrome still warns, use <b>Edge</b> or <b>Firefox</b> (they trust installed certificates).</li></ol>
<h2>iPhone / iPad (Safari)</h2><ol><li>Tap the download above â€” Safari downloads the profile.</li><li>Open <b>Settings â†’ General â†’ VPN & Device Management</b>, tap the profile, tap <b>Install</b>.</li><li>Go to <b>Settings â†’ General â†’ About â†’ Certificate Trust Settings</b> and switch <b>Full Trust</b> on for <b>localhost</b>.</li><li>Open <code>https://192.168.100.14:${HTTPS_PORT}</code> in Safari â€” no warning, and the camera works.</li></ol>
<p style="color:#666">This certificate only works on your local network and can only identify this server â€” it is safe to install.</p></body></html>`);
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

db.initialize();

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });

  const ALT_PORT = Number(process.env.ALT_PORT || 4002);
  if ((process.env.SERVE_FRONTEND || '1') === '1') {
    app.listen(ALT_PORT, () => {
      console.log(`App also running on http://localhost:${ALT_PORT} (fresh camera permission origin)`);
    });
  }

  const HTTPS_PORT = Number(process.env.HTTPS_PORT || 4001);
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
            {
              days: 825,
              keySize: 2048,
              algorithm: 'sha256',
              extensions: [
                { name: 'basicConstraints', cA: false },
                { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
                { name: 'extKeyUsage', serverAuth: true },
                { name: 'subjectAltName', altNames: [
                  { type: 2, value: 'localhost' },
                  { type: 7, ip: '127.0.0.1' },
                  ...lanIPs.map((ip) => ({ type: 7, ip })),
                ] },
              ],
            },
          );
          key = pems.private;
          cert = pems.cert;
          fs.writeFileSync(keyPath, key);
          fs.writeFileSync(certPath, cert);
        }

        httpsCert = cert;

        https.createServer({ key, cert }, app).listen(HTTPS_PORT, () => {
          console.log(`HTTPS server running on https://localhost:${HTTPS_PORT} (SAN: ${sanNames.join(', ')})`);
        });
      } catch (e) {
        console.error('HTTPS server failed to start:', e.message);
      }
    })();
  }
}