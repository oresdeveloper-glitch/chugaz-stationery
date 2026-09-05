const { db } = require('./src/db');
const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='products'").all();
for (const i of idx) console.log(i.sql || i.name);
console.log('---');
const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='products'").get();
console.log(table.sql);