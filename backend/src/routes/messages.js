const express = require('express');
const { db, audit } = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

router.use(requireRole('manager', 'admin'));

router.get('/', (req, res) => {
 const { unread } = req.query;
 const where = unread === '1' ? 'WHERE is_read = 0' : '';
 res.json(db.prepare(`SELECT * FROM contact_messages ${where} ORDER BY created_at DESC, id DESC LIMIT 300`).all());
});

router.put('/:id/read', (req, res) => {
 const isRead = req.body && req.body.is_read !== undefined ? (req.body.is_read ? 1 : 0) : 1;
 db.prepare('UPDATE contact_messages SET is_read=? WHERE id=?').run(isRead, req.params.id);
 audit(req.user.id, 'READ', 'message', Number(req.params.id));
 res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
 db.prepare('DELETE FROM contact_messages WHERE id=?').run(req.params.id);
 res.json({ ok: true });
});

module.exports = router;