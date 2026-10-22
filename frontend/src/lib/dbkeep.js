import { getToken, getUser, getDbPin, setDbPin, api, registerOnWrite } from './api';

// Wire the post-write backup hook so fresh rows are folded in before a cold reset.
registerOnWrite(schedulePostWriteBackup);

const MARKER_KEY = 'sst_db_marker';
const CATS_KEY = 'sst_db_cats';
const SO_KEY = 'sst_db_so';
// Epoch of the last deliberate admin transaction-wipe this browser has
// acknowledged (server advertises it as `reset_at` on /health and /sync).
const RESET_KEY = 'sst_reset_at';
const DB_NAME = 'sst-keep';
const STORE = 'kv';
const BACKUP_KEY = 'backup';
const BACKUP_INTERVAL_MS = 3 * 60 * 1000;
// A write near a cold reset may miss the 3-minute snapshot — schedule an 8s follow-up.
const POST_WRITE_BACKUP_MS = 8 * 1000;

let scheduled = false;
let checkingP = null;
let backing = false;
let converging = false;
let liveBackupTimer = null;
let postWriteTimer = null;
let restoreRetry = 0;
let restoreRetryTimer = null;

// High-water mark of the transaction counts this browser has ever seen
// ("sales:orders"). Monotonic on purpose: a disk wipe only lowers the live
// numbers, never this memory, so every check can recognise "the data
// vanished" even when a fresh instance re-seeded 26 categories and a stale
// stamp made the marker look unchanged.
function readSo() {
  try {
    const p = (localStorage.getItem(SO_KEY) || '').split(':');
    return { sales: Number(p[0]) || 0, orders: Number(p[1]) || 0 };
  } catch (_) {
    return { sales: 0, orders: 0 };
  }
}
function bumpSo(sales, orders) {
  try {
    const prev = readSo();
    localStorage.setItem(SO_KEY, `${Math.max(prev.sales, Number(sales) || 0)}:${Math.max(prev.orders, Number(orders) || 0)}`);
  } catch (_) { /* private mode etc. */ }
}
function bumpCats(n) {
  if (n == null) return;
  try {
    const last = Number(localStorage.getItem(CATS_KEY) || 0);
    localStorage.setItem(CATS_KEY, String(Math.max(Number(n) || 0, last)));
  } catch (_) { /* private mode etc. */ }
}
// Known-good totals for the wipe detector (read by the dashboard's first load).
export function knownCounts() { return readSo(); }

function readResetAt() {
  try { return Number(localStorage.getItem(RESET_KEY)) || 0; } catch (_) { return 0; }
}
function storeResetAt(n) {
  try { localStorage.setItem(RESET_KEY, String(n)); } catch (_) { /* private mode etc. */ }
}

function apiBase() {
  return (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';
}

function openStore() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('indexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, val) {
  const s = await openStore();
  return new Promise((resolve, reject) => {
    const tx = s.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const s = await openStore();
  return new Promise((resolve, reject) => {
    const tx = s.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function idbDel(key) {
  const s = await openStore();
  return new Promise((resolve, reject) => {
    const tx = s.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// A deliberate admin wipe stamps a NEWER `reset_at` than this browser has
// ever acknowledged. When that happens, the local snapshot and the high-water
// marks are FORGOTTEN — otherwise the recovery mesh would dutifully merge
// every deleted sale/order/expense straight back in. Runs for every session
// (pure client-side forget: no server writes), before bumpSo could max the
// stale high-water back into place.
async function applyResetEpoch(h) {
  const server = Number(h && h.reset_at) || 0;
  if (!server || server <= readResetAt()) return false;
  storeResetAt(server);
  try { await idbDel(BACKUP_KEY); } catch (_) { /* private mode etc. */ }
  try { localStorage.setItem(SO_KEY, `${Number(h.sales) || 0}:${Number(h.orders) || 0}`); } catch (_) { /* private mode etc. */ }
  console.info('[dbkeep] deliberate reset epoch', server, '— snapshot and high-water forgotten');
  return true;
}

async function health() {
  try {
    const res = await fetch(`${apiBase()}/api/health`, {
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(12000) : undefined,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// Pin a request to one instance via X-Expect-Db-Marker; null when it never lands there.
// Bounded: 3 tries with a timeout each, so a reset instance can never hang a
// backup/restore for tens of seconds (the caller treats null as "skip safely").
async function fetchPinned(url, opts, expect, tries = 3) {
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetch(url, {
        ...opts,
        headers: { ...(opts.headers || {}), ...(expect ? { 'X-Expect-Db-Marker': expect } : {}) },
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(12000) : undefined,
      });
    } catch (e) {
      return null;
    }
    if (res.status !== 409) return res;
    const b = await res.json().catch(() => null);
    if (!b || b.code !== 'instance_mismatch') return res;
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 140));
  }
  return null;
}

// Every staff session keeps a snapshot and merges it back after a disk reset
// (customers never hold server data). The server strips password hashes from
// non-admin downloads and only admins rewrite accounts, so widening the mesh
// simply multiplies the number of replicas that can heal the shop.
export function canKeep() {
  const user = getUser();
  return !!user && !!getToken() &&
    (user.role === 'admin' || user.role === 'manager' ||
      user.role === 'cashier' || user.role === 'clerk');
}

async function backupNow() {
  if (!canKeep() || !getToken()) return;
  if (backing) return;
  backing = true;
  try {
    const pin = getDbPin();
    // Marker drift means the server reset — never overwrite the IndexedDB copy with an empty instance.
    const stored = localStorage.getItem(MARKER_KEY);
    if (stored && pin && stored !== pin) return;
    // Count the instance before snapshotting it. A freshly-reset instance
    // re-seeds the catalog (26 categories), so marker checks alone cannot
    // see that every sale is gone - and replacing the good snapshot with
    // that emptier copy was the irrecoverable-loss path. Refuse any downgrade.
    let counts = null;
    try {
      const s = await api('/sync');
      if (s) counts = { sales: Number(s.sales) || 0, orders: Number(s.orders) || 0 };
    } catch (_) { /* counts unknown - fall back to the stored high-water */ }
    const snap = await idbGet(BACKUP_KEY);
    const known = readSo();
    const keepSales = Math.max(Number(snap && snap.sales) || 0, known.sales);
    const keepOrders = Math.max(Number(snap && snap.orders) || 0, known.orders);
    if (counts && (counts.sales < keepSales || (counts.sales === keepSales && counts.orders < keepOrders))) return;
    const res = await fetchPinned(`${apiBase()}/api/system/backup`, { headers: authHeaders() }, pin);
    if (!res || !res.ok) return;
    const marker = res.headers.get('X-Db-Marker') || pin;
    if (!marker) return;
    const blob = await res.blob();
    await idbPut(BACKUP_KEY, {
      blob, marker, at: Date.now(),
      sales: counts ? counts.sales : keepSales,
      orders: counts ? counts.orders : keepOrders,
    });
    if (counts) bumpSo(counts.sales, counts.orders);
    localStorage.setItem(MARKER_KEY, marker);
  } catch (e) {
    console.warn('[dbkeep] backup failed:', e && e.message ? e.message : e);
  } finally {
    backing = false;
  }
}

function scheduleBackups() {
  if (scheduled) return;
  scheduled = true;
  setInterval(backupNow, BACKUP_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') backupNow();
  });
  setTimeout(backupNow, 20000);
  window.addEventListener('chugaz-live', () => {
    clearTimeout(liveBackupTimer);
    liveBackupTimer = setTimeout(backupNow, 1500);
  });
}

// Merge the stored backup into the live DB (never replaces); `target` pins the merge.
async function restoreFromBackup(target) {
  try {
    const entry = await idbGet(BACKUP_KEY);
    if (!entry || !entry.blob) return 'none';
    const fd = new FormData();
    fd.append('file', entry.blob, 'auto-restore.db');
    const res = await fetchPinned(`${apiBase()}/api/system/restore-merge`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    }, target);
    if (!res || !res.ok) return 'failed';
    const marker = res.headers.get('X-Db-Marker') || target;
    if (marker) {
      localStorage.setItem(MARKER_KEY, marker);
      setDbPin(marker);
    }
    console.info('[dbkeep] merged backup — refreshing open pages in place');
    try { window.dispatchEvent(new CustomEvent('chugaz-live', { detail: { kinds: ['sync'] } })); } catch (e) { /* ignore */ }
    return 'ok';
  } catch (e) {
    console.warn('[dbkeep] restore failed:', e && e.message ? e.message : e);
    return 'failed';
  }
}

// Bring every live instance to the same data (leader = most sales; ties: orders, categories).
export async function convergeInstances() {
  try {
    if (!canKeep()) return 'skip';
    if (converging) return 'busy';
    converging = true;
    try {
      // Discover every live instance — an empty twin can answer first while another holds real data.
      const mine = await api('/sync');
      if (!mine || !mine.db_marker) return 'fail';
      const seen = new Map();
      seen.set(mine.db_marker, mine);
      for (let i = 0; i < 24 && seen.size < 8; i++) {
        const p = await api('/sync', { anyInstance: true });
        if (p && p.db_marker && !seen.has(p.db_marker)) seen.set(p.db_marker, p);
      }
      if (seen.size <= 1) return 'same';

      // Elect the canonical leader. A fresher deliberate-reset epoch outranks
      // raw counts: an un-reset twin still holding the OLD sales must never
      // win the election after an admin wipe, or the deleted history would be
      // announced (and pushed) back into the fleet.
      const weight = (s) => [
        Number(s.reset_at) || 0,
        Number(s.sales) || 0,
        Number(s.orders) || 0,
        Number(s.categories) || 0,
      ];
      const cmp = (a, b) => {
        const wa = weight(a), wb = weight(b);
        for (let i = 0; i < wa.length; i++) if (wa[i] !== wb[i]) return wa[i] - wb[i];
        return 0;
      };
      let leader = mine;
      for (const s of seen.values()) if (cmp(s, leader) > 0) leader = s;

      // Total wipe: every live instance is poorer than what this browser
      // holds. Stamping the empty leader as the session marker used to break
      // drift detection and let the next backup overwrite the only good
      // copy, so merge the snapshot back into the served instance instead —
      // unless the leader carries a NEWER deliberate-reset epoch than this
      // browser has acknowledged: then the wipe was intentional and the
      // snapshot must be forgotten, never merged.
      const snap = await idbGet(BACKUP_KEY);
      if (snap && snap.blob) {
        const leaderReset = Number(leader.reset_at) || 0;
        if (leaderReset > readResetAt()) {
          await applyResetEpoch({ reset_at: leaderReset, sales: leader.sales, orders: leader.orders });
          setDbPin(leader.db_marker);
          localStorage.setItem(MARKER_KEY, leader.db_marker);
          try { window.dispatchEvent(new CustomEvent('chugaz-live', { detail: { kinds: ['sync'] } })); } catch (e) { /* ignore */ }
          return 'reset';
        }
        const known = readSo();
        const l = [Number(leader.sales) || 0, Number(leader.orders) || 0];
        const k = [Math.max(Number(snap.sales) || 0, known.sales), Math.max(Number(snap.orders) || 0, known.orders)];
        if (l[0] < k[0] || (l[0] === k[0] && l[1] < k[1])) {
          const rr = await restoreFromBackup(getDbPin() || leader.db_marker);
          if (rr === 'failed') scheduleRestoreRetry();
          return 'restored';
        }
      }

      // Push the leader's rows into every other instance; the merge is name-keyed and idempotent.
      const fwd = await fetchPinned(`${apiBase()}/api/system/backup`, { headers: authHeaders() }, leader.db_marker);
      if (!fwd || !fwd.ok) return 'fail';
      let merged = 0;
      for (const [marker, s] of seen) {
        if (marker === leader.db_marker) continue;
        // An instance already at least as full as the leader needs no push.
        if (cmp(s, leader) >= 0) continue;
        const fd = new FormData();
        fd.append('file', await fwd.blob(), 'converge.db');
        const m = await fetchPinned(`${apiBase()}/api/system/restore-merge`, { method: 'POST', headers: authHeaders(), body: fd }, marker);
        if (m && m.ok) merged += 1;
      }

      // Re-pin to the leader so every subsequent read is answered by the instance holding the data.
      setDbPin(leader.db_marker);
      localStorage.setItem(MARKER_KEY, leader.db_marker);

      if (merged > 0) {
        await backupNow();
        console.info('[dbkeep] instances converged — leader', leader.db_marker.slice(0, 8), 'pushed to', merged, 'instance(s)');
      }
      try { window.dispatchEvent(new CustomEvent('chugaz-live', { detail: { kinds: ['sync'] } })); } catch (e) { /* ignore */ }
      return 'ok';
    } finally {
      converging = false;
    }
  } catch (e) {
    console.warn('[dbkeep] converge failed:', e && e.message ? e.message : e);
    return 'fail';
  }
}

// After any successful staff write, schedule one urgent backup so the new row is captured.
export function schedulePostWriteBackup() {
  if (!canKeep()) return;
  clearTimeout(postWriteTimer);
  postWriteTimer = setTimeout(backupNow, POST_WRITE_BACKUP_MS);
}

// Bounded retry: a failed merge (cold instance, brief 5xx) gets up to three
// more automatic attempts a few seconds later; success resets the counter.
function scheduleRestoreRetry() {
  if (restoreRetry >= 3) return;
  restoreRetry += 1;
  clearTimeout(restoreRetryTimer);
  restoreRetryTimer = setTimeout(() => { try { dbKeepInit(); } catch (_) { /* ignore */ } }, 4000);
}

// On mount/focus/login: detect an ephemeral-disk reset and merge the last backup back in.
export function dbKeepInit() {
  // Concurrent callers (mount, focus, pin change, wipe-recovery) await the
  // SAME in-flight check, so a recovery can never race past a restore.
  if (checkingP) return checkingP;
  checkingP = runKeepCheck().finally(() => { checkingP = null; });
  return checkingP;
}

async function runKeepCheck() {
  try {
    const h = await health();
    if (!h || !h.db_marker) return;
    // Deliberate admin wipe first: forget old state so neither bumpSo below
    // nor the lostTx restore further down can resurrect the deleted rows.
    await applyResetEpoch(h);
    bumpSo(h.sales, h.orders);
    const canKeepSess = canKeep();
    if (canKeepSess) scheduleBackups();
    if (!getDbPin()) setDbPin(h.db_marker);

    const stored = localStorage.getItem(MARKER_KEY);
    const cats = h.categories == null ? null : Number(h.categories);

    if (!stored) {
      localStorage.setItem(MARKER_KEY, h.db_marker);
      bumpCats(cats);
      return;
    }

    if (stored === h.db_marker) {
      // Same marker but rows are missing: fewer categories, or - the case a
      // seeded catalog hides - transaction counts below what this browser has
      // ever seen. Merge the snapshot back so the totals never sit at 0.
      const lastCats = Number(localStorage.getItem(CATS_KEY) || 0);
      const known = readSo();
      const sales = Number(h.sales) || 0;
      const orders = Number(h.orders) || 0;
      const lostCats = canKeepSess && cats != null && lastCats > 0 && cats < lastCats;
      const lostTx = canKeepSess &&
        ((known.sales > 0 && sales < known.sales) || (known.orders > 0 && orders < known.orders));
      if (lostCats || lostTx) {
        try {
          const r = await restoreFromBackup(h.db_marker);
          if (r === 'ok') restoreRetry = 0;
          else if (r === 'failed') scheduleRestoreRetry();
        } catch (_) { /* keep init non-fatal */ }
      }
      bumpCats(cats);
      return;
    }

    if (canKeepSess) {
      const result = await restoreFromBackup(h.db_marker);
      bumpCats(cats);
      if (result === 'ok') { restoreRetry = 0; return; }
      if (result === 'failed') { scheduleRestoreRetry(); return; }
      localStorage.setItem(MARKER_KEY, h.db_marker);
      const virgin = Number(h.sales || 0) === 0 && Number(h.orders || 0) === 0;
      if (!virgin) backupNow();
      return;
    }
    bumpCats(cats);
    // Non-keep sessions: stamp the new marker only when no snapshot exists yet.
    const entry = await idbGet(BACKUP_KEY);
    if (!entry || !entry.blob) localStorage.setItem(MARKER_KEY, h.db_marker);
  } catch (e) {
    console.warn('[dbkeep] check failed:', e && e.message ? e.message : e);
  }
}

// Admin "clear transactions": wipe sales/orders/purchases/expenses/payments/
// returns/movements on EVERY live instance with ONE shared epoch, then
// forget this browser's snapshot so the recovery mesh can never merge the
// deleted rows back. Discovery mirrors convergeInstances (serverless runs
// several instances on independent disks; a straggler that misses the first
// pass would keep serving the old history and win the epoch-first ranking).
export async function resetTransactions() {
  const user = getUser();
  if (!user || user.role !== 'admin') throw new Error('Only an admin can clear transactions');
  const epoch = Date.now();
  const auth = authHeaders();
  const body = JSON.stringify({ confirm: 'RESET', reset_at: epoch });
  const targets = new Map();
  const discover = async () => {
    targets.clear();
    try {
      const mine = await api('/sync');
      if (mine && mine.db_marker) targets.set(mine.db_marker, Number(mine.reset_at) || 0);
    } catch (_) { /* unreachable now - a later pass retries */ }
    for (let i = 0; i < 16 && targets.size < 8; i++) {
      try {
        const p = await api('/sync', { anyInstance: true });
        if (p && p.db_marker && !targets.has(p.db_marker)) targets.set(p.db_marker, Number(p.reset_at) || 0);
      } catch (_) { /* skip unreachable */ }
    }
  };
  const wipe = async (marker) => {
    const res = await fetchPinned(`${apiBase()}/api/system/reset-transactions`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body,
    }, marker);
    return !!(res && res.ok);
  };
  await discover();
  let cleared = 0;
  const failed = new Set();
  for (const [marker, seen] of targets) {
    if (seen >= epoch) continue;
    if (await wipe(marker)) cleared += 1; else failed.add(marker);
  }
  // Instances can scale up mid-purge: re-discover a few times and clear
  // anything still carrying an older epoch (an already-wiped instance shows
  // seen >= epoch, so successes are never double-counted).
  for (let round = 0; round < 3; round++) {
    await discover();
    const stale = [...targets.keys()].filter((m) => (targets.get(m) || 0) < epoch);
    if (!stale.length) break;
    for (const marker of stale) {
      if (await wipe(marker)) cleared += 1; else failed.add(marker);
    }
  }
  if (!cleared) throw new Error('The reset did not reach any live instance — an admin session is required');
  // Forget this browser's copy AFTER the fleet agreed, never before: until
  // then the snapshot was still the safety net for an instance that refused.
  storeResetAt(epoch);
  try { await idbDel(BACKUP_KEY); } catch (_) { /* private mode etc. */ }
  try { localStorage.setItem(SO_KEY, '0:0'); } catch (_) { /* private mode etc. */ }
  // Re-pin to an instance that actually carries the new epoch (epoch-first
  // ranking, same as rePinToRichest) so reads never land on a straggler.
  try {
    const rs = await Promise.all([0, 1, 2].map(() => api('/sync', { anyInstance: true })));
    const w = (x) => [Number(x.reset_at) || 0, Number(x.sales) || 0, Number(x.orders) || 0, Number(x.categories) || 0];
    let best = null;
    for (const s of rs) {
      if (!s || !s.db_marker) continue;
      if (!best) { best = s; continue; }
      const a = w(s), b = w(best);
      for (let i = 0; i < a.length; i++) {
        if (a[i] === b[i]) continue;
        if (a[i] > b[i]) best = s;
        break;
      }
    }
    if (best && best.db_marker) {
      setDbPin(best.db_marker);
      localStorage.setItem(MARKER_KEY, best.db_marker);
    }
  } catch (_) { /* keep the current pin - convergence will correct it */ }
  try { window.dispatchEvent(new CustomEvent('chugaz-live', { detail: { kinds: ['sync'] } })); } catch (_) { /* ignore */ }
  return { ok: true, epoch, cleared, failed: failed.size };
}
