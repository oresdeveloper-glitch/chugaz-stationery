import { getToken, getUser, getDbPin, setDbPin, api, registerOnWrite } from './api';

// Wire the urgent post-write backup into the api() write path (see api.js
// registerOnWrite). Every successful mutation refreshes the browser snapshot
// ~8s later, so freshly added categories are folded in long before a cold reset.
registerOnWrite(schedulePostWriteBackup);

const MARKER_KEY = 'sst_db_marker';
const CATS_KEY = 'sst_db_cats';
const DB_NAME = 'sst-keep';
const STORE = 'kv';
const BACKUP_KEY = 'backup';
const BACKUP_INTERVAL_MS = 10 * 60 * 1000;
// A write can land right before a serverless cold reset, so the periodic
// 10-minute snapshot may not include it — the write path schedules a much
// sooner follow-up so the new row is captured long before the next interval.
const POST_WRITE_BACKUP_MS = 8 * 1000;

let scheduled = false;
let checking = false;
let backing = false;
let converging = false;
let liveBackupTimer = null;
let postWriteTimer = null;

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

async function health() {
  try {
    const res = await fetch(`${apiBase()}/api/health`);
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

// Talk to one specific database instance: X-Expect-Db-Marker makes the server
// answer 409 (before running any handler) when the request round-robined to a
// different instance, so retrying here is always safe and eventually lands on
// the instance we asked for. Returns null when it never did.
async function fetchPinned(url, opts, expect, tries = 6) {
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetch(url, {
        ...opts,
        headers: { ...(opts.headers || {}), ...(expect ? { 'X-Expect-Db-Marker': expect } : {}) },
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

// Admins and managers can download a backup (manager copies come redacted) and
// can merge it back, so both roles keep snapshots alive. The marker comes from
// the backup response itself — a separate health() call could round-robin to
// ANOTHER instance and mislabel the snapshot.
function canKeep() {
  const user = getUser();
  return !!user && (user.role === 'admin' || user.role === 'manager') && !!getToken();
}

async function backupNow() {
  if (!canKeep() || !getToken()) return;
  if (backing) return;
  backing = true;
  try {
    const pin = getDbPin();
    // A stored marker different from our pin means the server was reset and
    // the merge has not run yet — the IndexedDB copy is the ONLY good data,
    // so never overwrite it with the fresh (empty) instance.
    const stored = localStorage.getItem(MARKER_KEY);
    if (stored && pin && stored !== pin) return;
    const res = await fetchPinned(`${apiBase()}/api/system/backup`, { headers: authHeaders() }, pin);
    if (!res || !res.ok) return;
    const marker = res.headers.get('X-Db-Marker') || pin;
    if (!marker) return;
    const blob = await res.blob();
    await idbPut(BACKUP_KEY, { blob, marker, at: Date.now() });
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

// Merge the stored backup into the live database (never replaces it): rows
// that already exist on the server are kept, backup-only rows are imported,
// so sales made on both sides of a reset survive together. `target` pins the
// merge to one specific instance.
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

// Bring every live instance to the same data. Called by the app poller when
// its pinned instance and another instance report different versions: first
// push the pinned instance's rows over there, then push everything back, so
// both sides hold the union — after that it no longer matters which instance
// a request lands on, and the dashboard stops flipping between two numbers.
export async function convergeInstances() {
  try {
    if (!canKeep()) return 'skip';
    if (converging) return 'busy';
    converging = true;
    try {
      const pin = getDbPin();
      if (!pin) return 'nopin';
      const pinned = await api('/sync');
      if (!pinned || !pinned.version || !pinned.data_version) return 'fail';
      // Discover EVERY other live instance, not just the first one: serverless
      // hosting can run several diverged disks at once, and merging with only
      // one of them leaves a freshly added category (or sale) missing on the
      // rest — so a refresh that lands on one of those instances makes the new
      // row appear to vanish. Collect a set of distinct markers instead.
      const others = new Set();
      for (let i = 0; i < 24 && others.size < 8; i++) {
        const p = await api('/sync', { anyInstance: true });
        if (p && p.db_marker && p.db_marker !== pin) others.add(p.db_marker);
      }
      if (others.size === 0) return 'same';
      // One pinned backup, pushed to every other instance. The merge is
      // name-keyed and idempotent, so repeating it across instances is safe
      // and cannot duplicate or clobber existing rows.
      const fwd = await fetchPinned(`${apiBase()}/api/system/backup`, { headers: authHeaders() }, pin);
      if (!fwd || !fwd.ok) return 'fail';
      let merged = 0;
      for (const marker of others) {
        const fd = new FormData();
        fd.append('file', await fwd.blob(), 'converge.db');
        const m = await fetchPinned(`${apiBase()}/api/system/restore-merge`, { method: 'POST', headers: authHeaders(), body: fd }, marker);
        if (m && m.ok) merged += 1;
      }
      if (merged === 0) return 'fail';
      await backupNow();
      console.info('[dbkeep] instances converged — pushed pinned data to', merged, 'instance(s)');
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

// Called by the api() write path after any successful admin/manager mutation
// (e.g. a new category). Schedules one urgent backup so the new row is folded
// into the browser snapshot well before the next 10-minute interval — the
// difference between a category surviving a cold reset and silently vanishing.
export function schedulePostWriteBackup() {
  if (!canKeep()) return;
  clearTimeout(postWriteTimer);
  postWriteTimer = setTimeout(backupNow, POST_WRITE_BACKUP_MS);
}

// Runs on app mount, on focus and after login. Detects an ephemeral-disk
// reset by comparing the server's persisted db_marker with the one stored
// locally; for admin/manager sessions the last IndexedDB backup is then MERGED
// into the fresh server (kept and retried until it succeeds), so sales
// recorded before and after the reset all reappear instead of one replacing
// the other.
export async function dbKeepInit() {
  if (checking) return;
  checking = true;
  try {
    const h = await health();
    if (!h || !h.db_marker) return;
    const canKeepSess = canKeep();
    if (canKeepSess) scheduleBackups();
    if (!getDbPin()) setDbPin(h.db_marker);

    const stored = localStorage.getItem(MARKER_KEY);
    const cats = h.categories == null ? null : Number(h.categories);

    if (!stored) {
      localStorage.setItem(MARKER_KEY, h.db_marker);
      if (cats != null) localStorage.setItem(CATS_KEY, String(cats));
      return;
    }

    if (stored === h.db_marker) {
      // Same marker, but the server reports FEWER categories than we last
      // recorded. That means this instance lost user-added categories while the
      // marker happened to survive (or a reset regenerated an identical marker).
      // Merging the snapshot restores the missing rows without touching data
      // that already exists on the server, so this is safe to run on keep-sessions.
      const lastCats = Number(localStorage.getItem(CATS_KEY) || 0);
      if (canKeepSess && cats != null && lastCats > 0 && cats < lastCats) {
        try { await restoreFromBackup(h.db_marker); } catch (_) { /* keep init non-fatal */ }
      }
      if (cats != null) localStorage.setItem(CATS_KEY, String(Math.max(cats, lastCats)));
      return;
    }

    if (canKeepSess) {
      const result = await restoreFromBackup(h.db_marker);
      if (cats != null) localStorage.setItem(CATS_KEY, String(cats));
      if (result === 'ok') return;
      if (result === 'failed') return;
      localStorage.setItem(MARKER_KEY, h.db_marker);
      const virgin = Number(h.sales || 0) === 0 && Number(h.orders || 0) === 0;
      if (!virgin) backupNow();
      return;
    }
    if (cats != null) localStorage.setItem(CATS_KEY, String(cats));
    // Non-keep sessions (cashier/clerk/customer): remember the new marker ONLY
    // when there is no stored snapshot — stamping it while a backup exists
    // would hide the reset from the next admin/manager session and their merge
    // would be skipped.
    const entry = await idbGet(BACKUP_KEY);
    if (!entry || !entry.blob) localStorage.setItem(MARKER_KEY, h.db_marker);
  } catch (e) {
    console.warn('[dbkeep] check failed:', e && e.message ? e.message : e);
  } finally {
    checking = false;
  }
}
