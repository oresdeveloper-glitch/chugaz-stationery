import { getToken, getUser, getDbPin, setDbPin, api, registerOnWrite } from './api';

// Wire the post-write backup hook so fresh rows are folded in before a cold reset.
registerOnWrite(schedulePostWriteBackup);

const MARKER_KEY = 'sst_db_marker';
const CATS_KEY = 'sst_db_cats';
const DB_NAME = 'sst-keep';
const STORE = 'kv';
const BACKUP_KEY = 'backup';
const BACKUP_INTERVAL_MS = 10 * 60 * 1000;
// A write near a cold reset may miss the 10-minute snapshot — schedule an 8s follow-up.
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

// Pin a request to one instance via X-Expect-Db-Marker; null when it never lands there.
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

// Admins and managers can download (redacted for managers) and merge backups.
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
    // Marker drift means the server reset — never overwrite the IndexedDB copy with an empty instance.
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

      // Elect the canonical leader: most sales wins, so the session pins to the instance that has the data.
      const weight = (s) => [
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

// After any successful admin/manager write, schedule one urgent backup so the new row is captured.
export function schedulePostWriteBackup() {
  if (!canKeep()) return;
  clearTimeout(postWriteTimer);
  postWriteTimer = setTimeout(backupNow, POST_WRITE_BACKUP_MS);
}

// On mount/focus/login: detect an ephemeral-disk reset and merge the last backup back in.
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
      // Same marker but fewer categories: the instance lost rows — merge the snapshot back.
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
    // Non-keep sessions: stamp the new marker only when no snapshot exists yet.
    const entry = await idbGet(BACKUP_KEY);
    if (!entry || !entry.blob) localStorage.setItem(MARKER_KEY, h.db_marker);
  } catch (e) {
    console.warn('[dbkeep] check failed:', e && e.message ? e.message : e);
  } finally {
    checking = false;
  }
}
