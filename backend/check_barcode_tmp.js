const { db } = require('./src/db');
const cats = db.prepare('SELECT c.id, c.name, COUNT(p.id) n FROM categories c LEFT JOIN products p ON p.category_id=c.id GROUP BY c.id ORDER BY c.id').all();
for (const c of cats) {
 const rows = db.prepare('SELECT id, name, barcode FROM products WHERE category_id=? ORDER BY id LIMIT 6').all(c.id);
 const withBc = db.prepare("SELECT COUNT(*) c FROM products WHERE category_id=? AND barcode IS NOT NULL AND barcode != ''").get(c.id).c;
 const distinct = db.prepare("SELECT COUNT(DISTINCT barcode) c FROM products WHERE category_id=? AND barcode IS NOT NULL AND barcode != ''").get(c.id).c;
 console.log(`== ${c.name} (${c.n} prods, ${withBc} w/ barcode, ${distinct} distinct)`);
 for (const r of rows) console.log(`  ${r.id}\t${JSON.stringify(r.barcode)}\t${r.name.slice(0, 45)}`);
}