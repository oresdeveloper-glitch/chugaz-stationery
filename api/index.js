module.exports = (req, res) => {
  if (req.url && req.url.includes('/health')) {
    return res.status(200).json({ ok: true, db: 'connected', payment_instructions: '356322054 - CHUGAZ STATIONERY' });
  }
  let app;
  try {
    try { app = require('./backend/server'); } catch (_) { app = require('../backend/server'); }
  } catch (e) {
    console.error('load error', e);
    return res.status(500).json({ error: 'load failed', message: e.message, stack: e.stack });
  }
  return app(req, res);
};
