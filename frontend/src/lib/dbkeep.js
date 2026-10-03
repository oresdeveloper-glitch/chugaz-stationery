import { getToken, getUser } from './api';

const MARKER_KEY = 'sst_db_marker';
const DB_NAME = 'sst-keep';
const STORE = 'kv';
const BACKUP_KEY = 'backup';
const BACKUP_INTERVAL_MS = 10 * 60 * 1000;

let scheduled = false;
let checking = false;

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

// Snapshot the live database into IndexedDB, tagged with the db_marker of the
// server it came from. Runs only for admin sessions (they can download the
// backup and can restore it again).
async function backupNow() {
  const user = getUser();
  if (!user || user.role !== 'admin' || !getToken()) return;
  try {
    const res = await fetch(`${apiBase()}/api/system/backup`, { headers: authHeaders() });
    if (!res.ok) return;
    const blob = await res.blob();
    const h = await health();
    if (!h || !h.db_marker) return;
    await idbPut(BACKUP_KEY, { blob, marker: h.db_marker, at: Date.now() });
    localStorage.setItem(MARKER_KEY, h.db_marker);
  } catch (e) {
    console.warn('[dbkeep] backup failed:', e && e.message ? e.message : e);
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
}

// Merge the stored backup into the live database (never replaces it): rows
// that already exist on the server are kept, backup-only rows are imported,
// so sales made on both sides of a reset survive together.
async function restoreFromBackup() {
  try {
    const entry = await idbGet(BACKUP_KEY);
    if (!entry || !entry.blob) return 'none';
    const fd = new FormData();
    fd.append('file', entry.blob, 'auto-restore.db');
    const res = await fetch(`${apiBase()}/api/system/restore-merge`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    });
    if (!res.ok) return 'failed';
    const h = await health();
    localStorage.setItem(MARKER_KEY, (h && h.db_marker) || entry.marker);
    console.info('[dbkeep] merged backup — reloading');
    window.location.reload();
    return 'ok';
  } catch (e) {
    console.warn('[dbkeep] restore failed:', e && e.message ? e.message : e);
    return 'failed';
  }
}

// Runs on app mount, on focus and after login. Detects an ephemeral-disk
// reset by comparing the server's persisted db_marker with the one stored
// locally; for admin sessions the last IndexedDB backup is then MERGED into
// the fresh server (kept and retried until it succeeds), so sales recorded
// before and after the reset all reappear instead of one replacing the other.
export async function dbKeepInit() {
  if (checking) return;
  checking = true;
  try {
    const h = await health();
    if (!h || !h.db_marker) return;
    const user = getUser();
    const isAdmin = !!user && user.role === 'admin' && !!getToken();
    if (isAdmin) scheduleBackups();

    const stored = localStorage.getItem(MARKER_KEY);
    if (!stored) {
      localStorage.setItem(MARKER_KEY, h.db_marker);
      return;
    }
    if (stored === h.db_marker) return;

    if (isAdmin) {
      const result = await restoreFromBackup();
      if (result === 'ok') return;
      if (result === 'failed') return;
      localStorage.setItem(MARKER_KEY, h.db_marker);
      const virgin = Number(h.sales || 0) === 0 && Number(h.orders || 0) === 0;
      if (!virgin) backupNow();
      return;
    }
    localStorage.setItem(MARKER_KEY, h.db_marker);
  } catch (e) {
    console.warn('[dbkeep] check failed:', e && e.message ? e.message : e);
  } finally {
    checking = false;
  }
}
