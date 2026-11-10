// Remember, per browser, which products the shop deleted on purpose.
//
// After a cold start the app merges its last IndexedDB snapshot back into the
// live database. That merge is additive, so a snapshot taken a few seconds
// before the delete used to re-create the product - it looked like the delete
// "did nothing" until the page was refreshed. The server keeps its own
// tombstones, but a snapshot can also be merged by a browser whose last write
// happened before the tombstone existed, so the hint is sent along too.
//
// Identity matches the server's merge key: SKU when present, else name.

const KEY = 'sst_deleted_products';
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX = 200;

function read() {
  try {
    const rows = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

function write(rows) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX)));
  } catch (_) { /* private mode / quota: the server tombstone still applies */ }
}

function keyOf(row) {
  return `${row.sku ? `sku:${row.sku}` : ''}|name:${row.name || ''}`;
}

function live(rows, now = Date.now()) {
  return rows.filter((r) => r && (r.name || r.sku) && now - Number(r.at || 0) < TTL_MS);
}

export function noteProductDeleted(product) {
  if (!product) return;
  const row = {
    sku: product.sku || null,
    name: product.name || '',
    at: Date.now(),
  };
  if (!row.name && !row.sku) return;
  const rows = live(read()).filter((r) => keyOf(r) !== keyOf(row));
  rows.push(row);
  write(rows);
}

// A product created (or renamed back) with the same identity is a real product
// again, so the hint must not keep deleting it.
export function forgetProductTombstone(product) {
  if (!product) return;
  const sku = product.sku || null;
  const name = product.name || '';
  write(live(read()).filter((r) => {
    if (sku && r.sku && r.sku === sku) return false;
    if (name && r.name === name) return false;
    return true;
  }));
}

export function deletedProductHints() {
  return live(read()).map((r) => ({ sku: r.sku || null, name: r.name || '', at: Number(r.at) || 0 }));
}
