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

// The database persisted by the client. Any stored backup is eligible: even a
// backup from an older lineage is better than an empty bootstrap database.
async function restoreFromBackup() {
  try {
    const entry = await idbGet(BACKUP_KEY);
    if (!entry || !entry.blob) return false;
    const fd = new FormData();
    fd.append('file', entry.blob, 'auto-restore.db');
    const res = await fetch(`${apiBase()}/api/system/restore`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    });
    if (!res.ok) return false;
    const h = await health();
    localStorage.setItem(MARKER_KEY, (h && h.db_marker) || entry.marker);
    console.info('[dbkeep] restored backup — reloading');
    window.location.reload();
    return true;
  } catch (e) {
    console.warn('[dbkeep] restore failed:', e && e.message ? e.message : e);
    return false;
  }
}

// Runs on app mount, on focus and after login. Detects an ephemeral-disk
// reset by comparing the server's persisted db_marker with the one stored
// locally; when the fresh server is still empty (no sales/orders) and this
// is an admin session, the last IndexedDB backup is restored automatically
// so real data reappears instead of bootstrap/demo state.
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

    const virgin = Number(h.sales || 0) === 0 && Number(h.orders || 0) === 0;
    if (isAdmin && virgin) {
      const restored = await restoreFromBackup();
      if (restored) return;
      // Restore failed (e.g. transient error): adopt the marker so this page
      // does not retry in a loop, but keep the stored backup untouched — the
      // next reset will attempt the restore again.
      localStorage.setItem(MARKER_KEY, h.db_marker);
      return;
    }
    // The server already holds data (kept as-is): adopt its marker so this
    // browser follows the new lineage, then snapshot it as the new backup.
    localStorage.setItem(MARKER_KEY, h.db_marker);
    if (!virgin) backupNow();
  } catch (e) {
    console.warn('[dbkeep] check failed:', e && e.message ? e.message : e);
  } finally {
    checking = false;
  }
}
