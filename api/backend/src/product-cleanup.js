const { db } = require('./db');

// Rows that make a product part of the shop's accounting history. sale_items
// and purchase_items only store product_id (no name snapshot) and the invoice
// and report queries join products for the name, so deleting the product would
// silently rewrite documents that have already been printed or handed out.
function accountingUse(ids) {
 const count = (sql) => {
  try { return Number(db.prepare(sql).get(...ids).c) || 0; } catch (_) { return 0; }
 };
 if (!ids.length) return { sales: 0, purchases: 0, returns: 0 };
 const marks = ids.map(() => '?').join(',');
 return {
  sales: count(`SELECT COUNT(*) c FROM sale_items WHERE product_id IN (${marks})`),
  purchases: count(`SELECT COUNT(*) c FROM purchase_items WHERE product_id IN (${marks})`),
  returns: count(`SELECT COUNT(*) c FROM sale_return_items WHERE product_id IN (${marks})`)
   + count(`SELECT COUNT(*) c FROM purchase_return_items WHERE product_id IN (${marks})`),
 };
}

function hasAccountingHistory(ids) {
 const used = accountingUse(ids);
 return used.sales + used.purchases + used.returns > 0;
}

// Photo URLs owned by these products, collected before the rows disappear so
// the stored blobs can be dropped afterwards.
function productPhotoUrls(ids) {
 const urls = [];
 for (const pid of ids) {
  const row = db.prepare('SELECT image FROM products WHERE id = ?').get(pid);
  if (row && row.image) urls.push(row.image);
  for (const img of db.prepare('SELECT path FROM product_images WHERE product_id = ?').all(pid)) urls.push(img.path);
 }
 return urls;
}

// Remove every non-accounting row attached to these products: variants, photo
// links, category memberships, cart lines and stock movements. order_items
// keeps its own product_name snapshot, so only the dangling link is cleared.
// Caller owns the transaction.
function purgeProductRows(ids) {
 if (!ids.length) return;
 const marks = ids.map(() => '?').join(',');
 db.prepare(`UPDATE order_items SET product_id = NULL WHERE product_id IN (${marks})`).run(...ids);
 db.prepare(`DELETE FROM cart_items WHERE product_id IN (${marks})`).run(...ids);
 db.prepare(`DELETE FROM stock_movements WHERE product_id IN (${marks})`).run(...ids);
 db.prepare(`DELETE FROM product_categories WHERE product_id IN (${marks})`).run(...ids);
 db.prepare(`DELETE FROM product_images WHERE product_id IN (${marks})`).run(...ids);
 // Children first: products.parent_id has no cascade.
 db.prepare(`DELETE FROM products WHERE parent_id IN (${marks})`).run(...ids);
 db.prepare(`DELETE FROM products WHERE id IN (${marks})`).run(...ids);
}

// Drop the stored bytes once no product or gallery row points at them.
function dropUnusedMedia(url) {
 const m = /^\/api\/media\/([^/?#]+)$/.exec(String(url || ''));
 if (!m) return;
 const name = m[1];
 try {
  const used = db.prepare('SELECT 1 FROM products WHERE image = ? LIMIT 1').get(url)
   || db.prepare('SELECT 1 FROM product_images WHERE path = ? LIMIT 1').get(url);
  if (!used) db.prepare('DELETE FROM product_media WHERE name = ?').run(name);
 } catch (_) { /* cleanup must never fail the request */ }
}

// Remember deleted products by the identity the backup merge uses (sku, else
// name). A browser snapshot taken seconds before the delete is merged back
// after a cold start, and the merge is additive, so without this the product
// reappeared on the next refresh.
function tombstone(ids) {
 const get = db.prepare('SELECT sku, name FROM products WHERE id = ?');
 const ins = db.prepare('INSERT INTO deleted_products (sku, name) VALUES (?,?)');
 for (const id of ids) {
  const row = get.get(id);
  if (row) ins.run(row.sku || null, row.name || '');
 }
 // The list only needs to outlive stale snapshots, not the shop's lifetime.
 try {
  db.prepare('DELETE FROM deleted_products WHERE id NOT IN (SELECT id FROM deleted_products ORDER BY id DESC LIMIT 2000)').run();
 } catch (_) { /* ignore */ }
}

// A product created again with the same identity is not "the deleted one" any
// more: forget the tombstone so merges do not remove the new row.
function clearTombstones(sku, name) {
 try {
  db.prepare('DELETE FROM deleted_products WHERE (sku IS NOT NULL AND sku = ?) OR (sku IS NULL AND name = ?)').run(sku || null, name || '');
 } catch (_) { /* table missing on very old databases */ }
}

// Fold tombstones from a backup file or from the browser doing the merge into
// this database without creating duplicates.
function importTombstones(rows) {
 if (!Array.isArray(rows) || !rows.length) return 0;
 let added = 0;
 const ins = db.prepare(`INSERT INTO deleted_products (sku, name)
  SELECT ?, ? WHERE NOT EXISTS (
   SELECT 1 FROM deleted_products WHERE COALESCE(sku, '') = COALESCE(?, '') AND name = ?
  )`);
 for (const r of rows) {
  if (!r || (!r.sku && !r.name)) continue;
  const sku = r.sku || null;
  const name = String(r.name || '');
  const info = ins.run(sku, name, sku, name);
  added += Number(info.changes) || 0;
 }
 return added;
}

// Remove products that match a tombstone and have no accounting history.
// Returns how many rows were removed. Caller owns the transaction.
function applyTombstones() {
 let rows = [];
 try {
  rows = db.prepare(`SELECT DISTINCT p.id FROM deleted_products dp JOIN products p
   ON (dp.sku IS NOT NULL AND p.sku = dp.sku)
   OR (dp.sku IS NULL AND p.name = dp.name)`).all();
 } catch (_) { return 0; }
 let removed = 0;
 for (const row of rows) {
  const id = Number(row.id);
  if (hasAccountingHistory([id])) continue;
  const urls = productPhotoUrls([id]);
  purgeProductRows([id]);
  for (const url of urls) dropUnusedMedia(url);
  removed += 1;
 }
 return removed;
}

module.exports = {
 accountingUse,
 hasAccountingHistory,
 productPhotoUrls,
 purgeProductRows,
 dropUnusedMedia,
 tombstone,
 clearTombstones,
 importTombstones,
 applyTombstones,
};
