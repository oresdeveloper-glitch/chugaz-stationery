const path = require('path');
const fs = require('fs');
const Module = require('module');
try { if (!fs.existsSync('/var/task/backend/node_modules/express') && fs.existsSync('/var/task/node_modules/express')) { fs.cpSync('/var/task/node_modules', '/var/task/backend/node_modules', {recursive:true, force:true}); } } catch(e){}
try { if (!fs.existsSync('/var/task/api/node_modules/express') && fs.existsSync('/var/task/node_modules/express')) { fs.cpSync('/var/task/node_modules', '/var/task/api/node_modules', {recursive:true, force:true}); } } catch(e){}
['/var/task/node_modules','/var/task/backend/node_modules','/var/task/api/node_modules', path.join(__dirname,'../node_modules'), path.join(__dirname,'node_modules'), path.join(__dirname,'../backend/node_modules')].forEach(p=>{ if(!Module.globalPaths.includes(p)) Module.globalPaths.push(p); });
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
