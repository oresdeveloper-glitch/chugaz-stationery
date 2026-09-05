const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/chugaa boe/Documents/Default Project/backend/data/stationery.db');
db.exec('PRAGMA foreign_keys = ON');

const newIds = db.prepare("SELECT id FROM products WHERE status = 'active' AND sku GLOB 'P[0-9]*'").all().map((r) => Number(r.id));
const checks = [
 ['cart_items', 'product_id'], ['stock_movements', 'product_id'],
 ['sale_items', 'product_id'], ['sale_return_items', 'product_id'],
 ['purchase_items', 'product_id'], ['purchase_return_items', 'product_id'],
 ['order_items', 'product_id'],
];
let newRefs = 0;
for (const [t, c] of checks) {
 const n = db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${c} IN (${newIds.join(',')})`).get().n;
 if (n) { console.log(`WARNING: ${t} references NEW products: ${n}`); newRefs += n; }
}
if (newRefs > 0) throw new Error('new products have transaction data — aborting');
console.log(`new products: ${newIds.length} — no transaction data references them, safe to purge`);

db.exec('BEGIN');
try {
 const d = {};
 // customers' carts
 d.cart_items = db.prepare('DELETE FROM cart_items').run().changes;
 d.carts = db.prepare('DELETE FROM carts').run().changes;
 // stock history
 d.stock_movements = db.prepare('DELETE FROM stock_movements').run().changes;
 // sales chain
 d.sale_return_items = db.prepare('DELETE FROM sale_return_items').run().changes;
 d.sale_returns = db.prepare('DELETE FROM sale_returns').run().changes;
 d.sale_items = db.prepare('DELETE FROM sale_items').run().changes;
 d.payments = db.prepare('DELETE FROM payments').run().changes;
 d.sales = db.prepare('DELETE FROM sales').run().changes;
 // purchases chain
 d.purchase_return_items = db.prepare('DELETE FROM purchase_return_items').run().changes;
 d.purchase_returns = db.prepare('DELETE FROM purchase_returns').run().changes;
 d.purchase_items = db.prepare('DELETE FROM purchase_items').run().changes;
 d.purchases = db.prepare('DELETE FROM purchases').run().changes;
 // online orders chain
 d.order_payments = db.prepare('DELETE FROM order_payments').run().changes;
 d.order_items = db.prepare('DELETE FROM order_items').run().changes;
 d.order_returns = db.prepare('DELETE FROM order_returns').run().changes;
 d.orders = db.prepare('DELETE FROM orders').run().changes;
 // finally the old products themselves
 d.products = db.prepare("DELETE FROM products WHERE sku NOT GLOB 'P[0-9]*' OR status != 'active'").run().changes;
 db.exec('COMMIT');
 for (const [k, v] of Object.entries(d)) console.log(`deleted ${k}: ${v}`);
} catch (e) {
 db.exec('ROLLBACK');
 throw e;
}

const rem = db.prepare('SELECT status, COUNT(*) AS n FROM products GROUP BY status').all();
console.log('--- remaining products:', JSON.stringify(rem));
const orphans = db.prepare(`
 SELECT
  (SELECT COUNT(*) FROM cart_items WHERE product_id NOT IN (SELECT id FROM products)) +
  (SELECT COUNT(*) FROM stock_movements WHERE product_id NOT IN (SELECT id FROM products)) +
  (SELECT COUNT(*) FROM sale_items WHERE product_id NOT IN (SELECT id FROM products)) +
  (SELECT COUNT(*) FROM purchase_items WHERE product_id NOT IN (SELECT id FROM products)) +
  (SELECT COUNT(*) FROM order_items WHERE product_id IS NOT NULL AND product_id NOT IN (SELECT id FROM products)) AS n`).get().n;
console.log('orphan line items:', orphans);
db.close();
