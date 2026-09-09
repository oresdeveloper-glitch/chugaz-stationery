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
    const fs = require('fs');
    let dbg={};
    try{ dbg['/var/task']=fs.readdirSync('/var/task').slice(0,20) }catch(e){dbg['/var/task']=e.message}
    try{ dbg['/var/task/backend']=fs.readdirSync('/var/task/backend').slice(0,20) }catch(e){dbg['/var/task/backend']=e.message}
    try{ dbg['/var/task/api']=fs.readdirSync('/var/task/api').slice(0,20) }catch(e){dbg['/var/task/api']=e.message}
    try{ dbg['backend_exists']=fs.existsSync('/var/task/backend/node_modules/express')}catch(e){}
    try{ dbg['root_exists']=fs.existsSync('/var/task/node_modules/express')}catch(e){}
    try{ dbg['api_exists']=fs.existsSync('/var/task/api/node_modules/express')}catch(e){}
    return res.status(200).json({ ok: true, db: 'connected', payment_instructions: '356322054 - CHUGAZ STATIONERY', dbg });
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
