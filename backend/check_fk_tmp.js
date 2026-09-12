const { db } = require('./src/db');
console.log('Tables referencing products:');
db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql LIKE '%REFERENCES products%'").all().forEach((t) => console.log('---', t.name, '\n', t.sql));
console.log('\nAll table names:');
db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().forEach((t) => console.log(' ', t.name));
console.log('\nproducts.id referenced by order_items?');
console.log(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('order_items','cart_items','sales','purchases','order_returns')").all().map((x)=>x.sql).join('\n---\n'));