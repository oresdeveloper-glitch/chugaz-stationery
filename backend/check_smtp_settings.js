const db = require('better-sqlite3')('./data/stationery.db');
console.log(db.prepare("SELECT key, value FROM settings WHERE key LIKE 'smtp_%'").all());