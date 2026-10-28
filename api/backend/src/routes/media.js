const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');

// Product photos uploaded from the admin/manager screens are stored IN the
// database, not on disk. On serverless hosting the deployment directory is
// read-only and /tmp belongs to one instance, so a file written at upload time
// was never served again (the URL returned 404 or the page fell back to the
// product's initial). Keeping the bytes next to the product row also means they
// ride along in the database backups the app already takes, and in the
// restore-merge that heals an instance whose disk was recycled.
const router = express.Router();

db.exec(`CREATE TABLE IF NOT EXISTS product_media (
  name TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`);

// Older deployments (and local dev) wrote files under these directories; keep
// serving them so existing photos do not disappear after this change.
const DISK_DIRS = [
  path.join(__dirname, '..', '..', 'uploads'),
  process.env.VERCEL === '1' ? '/tmp/stationery-uploads' : null,
].filter(Boolean);

router.get('/:name', (req, res) => {
  const raw = String(req.params.name || '');
  const name = path.basename(raw);
  if (!name || name !== raw || name.startsWith('.')) {
    return res.status(400).json({ error: 'Bad image name' });
  }
  try {
    const row = db.prepare('SELECT mime, bytes FROM product_media WHERE name = ?').get(name);
    if (row && row.bytes) {
      res.setHeader('Content-Type', row.mime || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.end(Buffer.from(row.bytes));
    }
  } catch (_) { /* fall through to the on-disk copies */ }
  for (const dir of DISK_DIRS) {
    try {
      const file = path.join(dir, name);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(file);
      }
    } catch (_) { /* try the next location */ }
  }
  return res.status(404).json({ error: 'Image not found' });
});

module.exports = router;
