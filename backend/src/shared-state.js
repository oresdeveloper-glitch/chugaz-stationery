// Cross-instance product state (main photo / archived / deleted).
//
// On Vercel every serverless instance has its own copy of the SQLite file in
// /tmp. A photo change made on the instance that answered admin A therefore
// never reached the instance that later answered admin B, so the new photo (or
// the delete) looked like it "did not apply" to the other account until the
// whole database happened to be merged back.
//
// Vercel Blob is shared by every instance, so the last deliberate change to a
// product is mirrored there and applied when products are read. It is a small
// presentation overlay - it never replaces the database and never touches
// accounting rows - so a failed Blob call can only delay propagation, it can
// never lose a sale.
//
// One blob per product (not one shared document): two admins editing different
// products can never overwrite each other's mirror, which a single shared
// document could do because Blob writes take a moment to become visible.
// Identity is the same key the backup merge uses: SKU when present, else name.

const crypto = require('crypto');

const PREFIX = 'state/products/';
// Cached in memory per instance. The catalog polls every 30 s, so an 8 s cache
// keeps Blob traffic negligible while still making another account's change
// visible on the next poll.
const TTL_MS = 8 * 1000;
const COLD_WAIT_MS = 2500;

let cache = { at: 0, map: {} };
// hash -> { at, entry } so a refresh only downloads the products that changed.
let known = new Map();
let loading = null;

// Static require at module scope: Vercel's function bundler only traces
// dependencies it can see as literals, and a require buried in a function is
// what made the deployed build fail with "Cannot find module '@vercel/blob'".
let blobSdk = null;
try { blobSdk = require('@vercel/blob'); } catch (_) { blobSdk = null; }

function enabled() {
  return !!process.env.BLOB_READ_WRITE_TOKEN && !!blobSdk;
}

function client() {
  if (!blobSdk) throw new Error('@vercel/blob is not available in this deployment');
  return blobSdk;
}

function clean(v) {
  return v == null ? '' : String(v).trim();
}

// Same identity the database merge uses for products.
function identityKey(row) {
  if (!row) return null;
  const sku = clean(row.sku);
  if (sku) return `sku:${sku}`;
  const name = clean(row.name);
  return name ? `name:${name}` : null;
}

function hashKey(key) {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
}

function pathnameFor(key) {
  return `${PREFIX}${hashKey(key)}.json`;
}

function isNotFound(e) {
  return !!e && (e.name === 'BlobNotFoundError'
    || /not found|does not exist|404/i.test(String(e.message || '')));
}

// Read straight from origin storage: a public Blob URL is CDN-cached, and a
// cached copy is exactly what makes another instance's write look like it never
// happened.
async function readBlob(blob) {
  const { get } = client();
  const name = blob && blob.pathname ? blob.pathname : blob;
  let res;
  try {
    res = await get(name, { access: 'public', useCache: false });
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  try {
    return JSON.parse(await new Response(res.stream).text());
  } catch (_) {
    return null;
  }
}

async function readAll() {
  if (!enabled()) return cache.map;
  const { list } = client();
  const items = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, limit: 1000, cursor });
    for (const b of page.blobs) items.push(b);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const nextKnown = new Map();
  const nextMap = { ...cache.map };
  const refreshes = [];
  for (const b of items) {
    const hash = String(b.pathname || '').slice(PREFIX.length).replace(/\.json$/, '');
    if (!hash) continue;
    const at = new Date(b.uploadedAt || 0).getTime();
    const prev = known.get(hash);
    if (prev && prev.at === at) {
      nextKnown.set(hash, prev);
      continue;
    }
    refreshes.push(readBlob(b).then((entry) => {
      if (!entry || !entry.key) return;
      nextKnown.set(hash, { at, entry });
      nextMap[entry.key] = entry;
    }).catch(() => { /* one unreadable file must not hide the rest */ }));
  }
  await Promise.all(refreshes);
  known = nextKnown;
  return nextMap;
}

// Start (or reuse) a background refresh of the overlay.
function refresh() {
  if (loading) return loading;
  loading = readAll()
    .then((map) => { cache = { at: Date.now(), map }; return map; })
    .catch((e) => {
      console.warn('[shared-state] read failed:', e && e.message ? e.message : e);
      cache = { at: Date.now(), map: cache.map };
      return cache.map;
    })
    .finally(() => { loading = null; });
  return loading;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cached overlay. Once this instance has a copy, readers never wait for Blob:
// a stale copy is served while the refresh runs in the background, so a slow
// object store can never stall the catalog. Only the very first read on a
// cold instance waits, and even that is capped.
async function overrides(force) {
  if (!enabled()) return cache.map;
  const stale = force || !cache.at || Date.now() - cache.at >= TTL_MS;
  if (stale) {
    const p = refresh();
    if (!cache.at) await Promise.race([p, sleep(COLD_WAIT_MS)]);
  }
  return cache.map;
}

// Mirror one deliberate change. Never throws: the request that made the change
// has already been committed locally and must not fail because Blob is down.
async function remember(row, patch) {
  if (!enabled()) return;
  const key = identityKey(row);
  if (!key) return;
  const pathname = pathnameFor(key);
  const payload = { key, at: Date.now(), ...patch };
  try {
    const { put } = client();
    await put(pathname, JSON.stringify(payload), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 0,
    });
    // This instance already knows the new value; do not wait for a refresh.
    cache = { at: cache.at, map: { ...cache.map, [key]: payload } };
    known.set(hashKey(key), { at: Date.now(), entry: payload });
  } catch (e) {
    console.warn('[shared-state] write failed:', e && e.message ? e.message : e);
  }
}

function forRow(map, row) {
  if (!map || !row) return null;
  const sku = clean(row.sku);
  if (sku && map[`sku:${sku}`]) return map[`sku:${sku}`];
  const name = clean(row.name);
  return name && map[`name:${name}`] ? map[`name:${name}`] : null;
}

// Mutates the row in place. Returns true when the product must be hidden
// because another instance deleted it.
function apply(map, row) {
  const o = forRow(map, row);
  if (!o) return false;
  if (o.image !== undefined) row.image = o.image;
  if (o.status) row.status = o.status;
  return !!o.deleted;
}

// Storefront helper: the photo set most recently anywhere in the system.
function firstImage(map, row) {
  const o = forRow(map, row);
  return o && o.image !== undefined ? o.image : undefined;
}

// Read-only diagnostics: proves the shared overlay store is reachable from the
// deployed function (and how many product entries it holds).
async function diagnose() {
  if (!enabled()) return { ok: false, error: 'BLOB_READ_WRITE_TOKEN not configured' };
  try {
    const map = await readAll();
    cache = { at: Date.now(), map };
    return { ok: true, entries: Object.keys(map).length };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

module.exports = { identityKey, overrides, remember, apply, firstImage, enabled, diagnose };
