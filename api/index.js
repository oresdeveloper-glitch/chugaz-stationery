let app;
try {
  try { app = require('./backend/server'); } catch (_) { app = require('../backend/server'); }
} catch (e) {
  console.error('load error', e);
  module.exports = (req, res) => res.status(500).json({ error: 'load failed', message: e.message, stack: e.stack });
  return;
}
module.exports = app;
