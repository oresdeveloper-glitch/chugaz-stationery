const express = require('express');
const { db, audit } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

// Sales/activity notifications are a manager+admin channel.
router.use(requireRole('manager', 'admin'));

router.get('/', (req, res) => {
  // housekeeping: drop acknowledged notifications older than 14 days
  try {
    db.prepare("DELETE FROM notifications WHERE is_read=1 AND created_at < datetime('now','-14 days')").run();
  } catch (e) { /* never fail the feed on cleanup */ }
  const rows = db.prepare(`
    SELECT id, kind, title, body, is_read, created_at
    FROM notifications WHERE user_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 50
  `).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
  res.json({ notifications: rows, unread_count: unread });
});

router.post('/read', (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.filter((n) => Number.isFinite(Number(n))) : [];
  if (ids.length) {
    const upd = db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=? AND id=?');
    for (const id of ids) upd.run(req.user.id, Number(id));
  } else {
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  }
  audit(req.user.id, 'READ', 'notification', 0, { ids: ids.length });
  res.json({ ok: true });
});

module.exports = router;
