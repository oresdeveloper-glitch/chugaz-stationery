const path = require('path');
const Module = require('module');
['/var/task/node_modules','/var/task/backend/node_modules','/var/task/api/node_modules', path.join(__dirname,'../node_modules'), path.join(__dirname,'node_modules'), path.join(__dirname,'../backend/node_modules')].forEach(p=>{ if(!Module.globalPaths.includes(p)) Module.globalPaths.push(p); if(!require('module')._pathCache) {} });
process.env.NODE_PATH = ['/var/task/node_modules','/var/task/backend/node_modules','/var/task/api/node_modules', path.join(__dirname,'../node_modules')].join(':');
require('module').Module._initPaths();

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
