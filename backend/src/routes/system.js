const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db, DB_PATH, audit } = require('../db');
const { requireRole } = require('../auth');

const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const router = express.Router();

router.get('/settings', (req, res) => {
 const rows = db.prepare('SELECT key, value FROM settings').all();
 const settings = {};
 rows.forEach((r) => (settings[r.key] = r.value));
 res.json(settings);
});

router.put('/settings', requireRole('admin'), (req, res) => {
 const allowed = ['shop_name', 'shop_address', 'shop_phone', 'shop_email', 'currency', 'receipt_footer', 'allow_negative_stock', 'delivery_fee', 'free_delivery_threshold', 'pickup_available', 'payment_instructions', 'app_theme', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from'];
 const upd = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
 for (const k of allowed) {
  if (req.body[k] !== undefined) upd.run(k, String(req.body[k]));
 }
 audit(req.user.id, 'UPDATE', 'settings', null, { fields: allowed.filter((k) => req.body[k] !== undefined) });
 res.json({ ok: true });
});

router.post('/test-email', requireRole('admin'), async (req, res) => {
 const { sendTestEmail } = require('../mailer');
 const to = req.body.to || db.prepare("SELECT value FROM settings WHERE key='shop_email'").get()?.value;
 if (!to) return res.status(400).json({ error: 'No recipient — enter an email or set the shop email in settings' });
 const result = await sendTestEmail(String(to).trim());
 if (result.sent) {
  audit(req.user.id, 'TEST_EMAIL', 'settings', null, { to });
  return res.json({ ok: true, message: `Test email sent to ${to}` });
 }
 res.status(400).json({ error: result.reason === 'smtp_not_configured'
  ? 'SMTP is not configured — fill the host, user and password first'
  : `Send failed: ${result.reason}` });
});

router.get('/backup', requireRole('admin'), (req, res) => {
 const data = fs.readFileSync(DB_PATH);
 res.setHeader('Content-Type', 'application/octet-stream');
 res.setHeader('Content-Disposition', `attachment; filename="stationery-backup-${Date.now()}.db"`);
 res.send(data);
});

router.post('/restore', requireRole('admin'), uploadMem.single('file'), (req, res) => {
 if (!req.files || !req.files.file) return res.status(400).json({ error: 'No backup file uploaded' });
 const file = req.files.file;
 try {
  const backup = path.join(path.dirname(DB_PATH), 'stationery-pre-restore.db');
  fs.copyFileSync(DB_PATH, backup);
  const data = Buffer.from(file.data);
  // Validate it's a SQLite database
  if (data.slice(0, 16).toString() !== 'SQLite format 3\x00') {
   return res.status(400).json({ error: 'Not a valid SQLite backup file' });
  }
  fs.writeFileSync(DB_PATH, data);
  audit(req.user.id, 'RESTORE', 'database', null, { restored_from: file.name });
  res.json({ ok: true, message: 'Database restored. Previous database saved as stationery-pre-restore.db' });
 } catch (e) {
  res.status(500).json({ error: 'Restore failed: ' + e.message });
 }
});

module.exports = router;