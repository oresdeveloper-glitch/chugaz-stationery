// Cross-instance user account state (role / status / office / name).
//
// Every serverless instance has its own SQLite copy, so a role change made on
// one instance never reached the others: the user list and /auth/me kept
// serving the old role until a whole-database merge happened to run. This
// overlay mirrors deliberate account edits to Vercel Blob and applies them on
// read, exactly like the product overlay, so a role change is visible to every
// instance within seconds.
//
// Identity is email (the same key the database merge uses for users).

const crypto = require('crypto');

const PREFIX = 'state/users/';
const TTL_MS = 8 * 1000;
const COLD_WAIT_MS = 2500;

let cache = { at: 0, map: {} };
let known = new Map();
let loading = null;

let blobSdk = null;
let blobSdkError = null;
try {
  blobSdk = require('./vendor/vercel-blob.cjs');
} catch (e) {
  blobSdk = null;
  blobSdkError = String((e && e.message) || e);
}

function enabled() {
  return !!process.env.BLOB_READ_WRITE_TOKEN && !!blobSdk;
}

function client() {
  if (!blobSdk) throw new Error('@vercel/blob is not available in this deployment');
  return blobSdk;
}

function clean(v) {
  return v == null ? '' : String(v).trim().toLowerCase();
}

function identityKey(row) {
  if (!row) return null;
  const email = clean(row.email);
  return email ? `email:${email}` : null;
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
  const nextMap = {};
  const refreshes = [];
  for (const b of items) {
    const hash = String(b.pathname || '').slice(PREFIX.length).replace(/\.json$/, '');
    if (!hash) continue;
    const at = new Date(b.uploadedAt || 0).getTime();
    const prev = known.get(hash);
    if (prev && prev.at === at) {
      nextKnown.set(hash, prev);
      nextMap[prev.entry.key] = prev.entry;
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

function refresh() {
  if (loading) return loading;
  loading = readAll()
    .then((map) => { cache = { at: Date.now(), map }; return map; })
    .catch((e) => {
      console.warn('[shared-users] read failed:', e && e.message ? e.message : e);
      cache = { at: Date.now(), map: cache.map };
      return cache.map;
    })
    .finally(() => { loading = null; });
  return loading;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function overrides(force) {
  if (!enabled()) return cache.map;
  const stale = force || !cache.at || Date.now() - cache.at >= TTL_MS;
  if (stale) {
    const p = refresh();
    if (!cache.at) await Promise.race([p, sleep(COLD_WAIT_MS)]);
  }
  return cache.map;
}

async function remember(row, patch) {
  if (!enabled()) return;
  const key = identityKey(row);
  if (!key) return;
  const pathname = pathnameFor(key);
  const email = clean(row.email);
  const payload = { key, email, at: Date.now(), ...patch };
  try {
    const { put } = client();
    await put(pathname, JSON.stringify(payload), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 0,
    });
    cache = { at: cache.at, map: { ...cache.map, [key]: payload } };
    known.set(hashKey(key), { at: Date.now(), entry: payload });
  } catch (e) {
    console.warn('[shared-users] write failed:', e && e.message ? e.message : e);
  }
}

function forRow(map, row) {
  if (!map || !row) return null;
  const email = clean(row.email);
  return email && map[`email:${email}`] ? map[`email:${email}`] : null;
}

// Mutates the row in place. Returns true when the account must be treated as
// deleted (another instance removed it).
function apply(map, row) {
  const o = forRow(map, row);
  if (!o) return false;
  if (o.role_id !== undefined) row.role_id = o.role_id;
  if (o.status) row.status = o.status;
  if (o.name) row.name = o.name;
  if (o.office_id !== undefined) row.office_id = o.office_id;
  return !!o.deleted;
}

async function diagnose() {
  const hasToken = !!process.env.BLOB_READ_WRITE_TOKEN;
  const hasSdk = !!blobSdk;
  if (!hasSdk) return { ok: false, sdk: false, token: hasToken, error: blobSdkError || '@vercel/blob not bundled' };
  if (!hasToken) return { ok: false, sdk: true, token: false, error: 'BLOB_READ_WRITE_TOKEN not configured' };
  try {
    const map = await readAll();
    cache = { at: Date.now(), map };
    return { ok: true, sdk: true, token: true, entries: Object.keys(map).length };
  } catch (e) {
    return { ok: false, sdk: true, token: true, error: String((e && e.message) || e) };
  }
}

// Synchronous view of the cached overlay (may be up to TTL_MS stale). Used on
// hot paths such as verifyLive that cannot await an async refresh.
function cached() { return cache.map; }
module.exports = { identityKey, overrides, remember, apply, cached, enabled, diagnose };
