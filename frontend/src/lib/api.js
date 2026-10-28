const TOKEN_KEY = 'sst_token';
const USER_KEY = 'sst_user';
const SHOP_TOKEN_KEY = 'sst_shop_token';
const SHOP_USER_KEY = 'sst_shop_user';
// Persisted instance pin — keeps requests on the instance that holds the data.
const DB_PIN_KEY = 'sst_db_pin';

// Registered by dbkeep.js (cycle-free) to run an urgent backup after each write.
let onWriteFn = null;
export function registerOnWrite(fn) { onWriteFn = fn; }

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}
export function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getShopToken() {
  return localStorage.getItem(SHOP_TOKEN_KEY);
}
export function getShopUser() {
  try {
    return JSON.parse(localStorage.getItem(SHOP_USER_KEY) || 'null');
  } catch {
    return null;
  }
}
export function setShopAuth(token, user) {
  localStorage.setItem(SHOP_TOKEN_KEY, token);
  localStorage.setItem(SHOP_USER_KEY, JSON.stringify(user));
}
export function clearShopAuth() {
    localStorage.removeItem(SHOP_TOKEN_KEY);
    localStorage.removeItem(SHOP_USER_KEY);
    // Announce the dead session so the app drops its signed-in state at once —
    // the UI must never keep showing a contact card while the token is gone.
    try { window.dispatchEvent(new Event('shop-auth-cleared')); } catch {}
}

export async function refreshToken(token) {
  try {
    const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';
    const sig = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined;
    // Carry the instance pin: the refresh handler re-reads the live account
    // row, so it must run on the instance that owns this session — a random
    // twin would 401 and force a needless sign-out.
    const pin = getDbPin();
    const headers = { Authorization: `Bearer ${token}` };
    if (pin) headers['X-Expect-Db-Marker'] = pin;
    let res = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers, signal: sig });
    if (res.status === 409 && pin) {
      // Dead pin (recycled disk) — retry once un-pinned instead of logging out.
      res = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: sig });
    }
    if (!res.ok) return null;
    const d = await res.json().catch(() => null);
    return d && d.token ? d.token : null;
  } catch {
    return null;
  }
}

export function isSessionValid() {
  return !!getToken() && !!getUser();
}

export function isShopSessionValid() {
  return !!getShopToken() && !!getShopUser();
}

function guestCartId() {
  let id = localStorage.getItem('sst_guest_id');
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
      'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    localStorage.setItem('sst_guest_id', id);
  }
  return id;
}

let printLocked = false;
export function lockPrintRedirect() { printLocked = true; }
export function unlockPrintRedirect() { printLocked = false; }

// Instance pin for this session; the server 409s a request that lands elsewhere.
let dbPin = null;
export function getDbPin() {
  if (!dbPin) { try { dbPin = localStorage.getItem(DB_PIN_KEY) || null; } catch (_) { dbPin = null; } }
  return dbPin;
}
export function setDbPin(m) {
  const cur = getDbPin();
  const next = m || null;
  const changed = cur !== next;
  dbPin = next;
  try {
    if (dbPin) localStorage.setItem(DB_PIN_KEY, dbPin);
    else localStorage.removeItem(DB_PIN_KEY);
  } catch (_) { /* private mode etc. — pin just stays in-memory */ }
  // The SSE stream carries the pin as ?marker= (EventSource cannot set
  // headers), so reopen it whenever the pinned instance changes.
  if (changed) {
    try { window.dispatchEvent(new Event('chugaz-pin')); } catch (_) { /* ignore */ }
  }
}

// One re-try against the pinned instance, then a fleet probe that re-pins to
// the instance holding the most data. A dead pin (recycled serverless disk)
// must never heal by gambling on a random instance - that lottery is what
// parked sessions on an EMPTY twin and left dashboards reading 0.

// Every page asks /sync (mount tick, SSE hint, focus, backup check). Concurrent
// callers share ONE request and the answer is reused for a beat, so a burst of
// nudges can no longer turn into a burst of full-table version scans.
const SYNC_TTL_MS = 600;
let syncInFlight = null;
let syncCache = { at: 0, data: null };

export function lastSync() { return syncCache.data; }
export function lastSyncVersion() {
  const s = syncCache.data;
  return s && s.version != null ? String(s.version) : null;
}

function syncOnce() {
  if (syncCache.data && Date.now() - syncCache.at < SYNC_TTL_MS) return Promise.resolve(syncCache.data);
  if (syncInFlight) return syncInFlight;
  syncInFlight = request('/sync', {}, false)
    .then((d) => { syncCache = { at: Date.now(), data: d }; return d; })
    .finally(() => { syncInFlight = null; });
  return syncInFlight;
}

// Identical concurrent GETs collapse into one round trip (two components
// mounting at once used to fetch the same URL twice).
const inFlightGets = new Map();

// A page can start its own data request before it renders (main.jsx does this
// for the dashboard): the request overlaps the route chunk download, and the
// page's own call then consumes that answer instead of issuing a second one -
// even if the prefetch already finished, which the in-flight map cannot cover.
// Consumed exactly once, and ignored if it is older than a few seconds, so a
// later reload never reads stale numbers.
const prefetched = new Map();
const PREFETCH_TTL_MS = 5000;

export function prefetch(path) {
  if (prefetched.has(path)) return;
  const p = request(path, {}, false);
  prefetched.set(path, { at: Date.now(), p });
  p.catch(() => { prefetched.delete(path); });
}

// Probe the fleet in parallel and pin to the instance with the most data.
// A fresher deliberate-reset epoch outranks raw counts: after an admin
// "clear transactions" wipe, an un-reset twin still holding the OLD sales
// must never win the pin (it would serve the deleted history). Ranking is
// reset_at, then sales, then orders, then categories. The anyInstance
// probes never recurse: they skip the affinity path entirely.
async function rePinToRichest() {
  // Concurrent 409s must not each probe the fleet: one shared probe serves them
  // all (the old code fired 3 fleet calls per failed request, which is what
  // multiplied a single stale pin into ~20 /sync calls per page load).
  if (rePinP && Date.now() - rePinAt < 2000) return rePinP;
  rePinAt = Date.now();
  rePinP = probeRichest().finally(() => { rePinP = null; });
  return rePinP;
}
let rePinP = null;
let rePinAt = 0;

async function probeRichest() {
  try {
    const rs = await Promise.all([0, 1, 2].map(() => request('/sync', { anyInstance: true }, false)));
    const w = (x) => [Number(x.reset_at) || 0, Number(x.sales) || 0, Number(x.orders) || 0, Number(x.categories) || 0];
    const cands = [];
    for (const s of rs) {
      if (s && s.db_marker) cands.push({ m: s.db_marker, w: w(s) });
    }
    if (!cands.length) { setDbPin(null); return; }
    // Deterministic order: data weight descending, marker ascending, so two
    // probe runs can never disagree about the winner.
    cands.sort((a, b) => {
      for (let i = 0; i < 4; i++) if (a.w[i] !== b.w[i]) return b.w[i] - a.w[i];
      return a.m < b.m ? -1 : a.m > b.m ? 1 : 0;
    });
    const top = cands[0];
    const cur = getDbPin();
    // Never leave a pin that already holds top-rank data. When every reachable
    // instance ties (empty fleet, fresh twin), "whoever answered first" used to
    // become the new pin - each tab re-rolling the pin made the others 409,
    // re-pin, and drag the whole fleet through a hop/reconnect storm. Holding
    // a tied pin is always safe: same data, no traffic amplification.
    const holdsTop = !!cur && cands.some((c) => c.m === cur &&
      c.w[0] === top.w[0] && c.w[1] === top.w[1] && c.w[2] === top.w[2] && c.w[3] === top.w[3]);
    setDbPin(holdsTop ? cur : top.m);
  } catch (_) {
    setDbPin(null);
  }
}

async function request(path, options = {}, shop = false) {
  const headers = { ...(options.headers || {}) };
  const getTok = shop ? getShopToken : getToken;
  const getUserFn = shop ? getShopUser : getUser;
  const setTok = (t, u) => (shop ? setShopAuth(t, u) : setAuth(t, u));
  const clearTok = () => (shop ? clearShopAuth() : clearAuth());

  let token = getTok();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (shop) {
    headers['x-guest-id'] = guestCartId();
  }
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';
  const url = `${base}/api${shop ? '/shop' : ''}${path}`;
  // Auth endpoints never get the 401-retry/refresh treatment (a 401 there is
  // a real credential answer), but they DO get instance affinity: login must
  // land on the pinned instance that holds the account row, exactly like the
  // register call that created it. A random-instance login after a disk
  // recycle was sending customers into "Invalid email or password".
  const recoverable = !path.startsWith('/auth/');
  const affinity = !options.anyInstance;
  const idempotent = !options.method || options.method === 'GET' || options.method === 'HEAD';
  const send = () => {
    const h = { ...headers };
    // Read the pin via getDbPin(): the in-memory var starts null on a fresh load.
    const pin = getDbPin();
    if (pin && affinity) h['X-Expect-Db-Marker'] = pin;
    const sig = options.signal ||
      ((typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(15000) : undefined);
    return fetch(url, { ...options, headers: h, signal: sig }).catch((e) => {
      // Never surface the browser's raw "Failed to fetch" - say what happened.
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new Error('The server took too long to respond. Please try again.');
      }
      throw new Error('Could not reach the server. Check your connection and try again.');
    });
  };

  let res = await send();
  let data = null;
  // Retry on 409 instance_mismatch: nothing ran server-side, so it is safe.
  // A 409 means this request did not land on the instance we pinned. Retry the
  // SAME pin first: the platform load-balances every request independently, so
  // the pinned instance is often reachable on the next draw. Adopting whichever
  // instance answered on the first mismatch made the pin chase the balancer
  // from one twin to the next - every adoption reopened the event stream and
  // refetched the page, and the dashboard never settled (measured: a 409 on
  // essentially every request, each naming a different instance).
  if (affinity) {
    let hops = 0;
    while (res.status === 409 && hops < 2) {
      hops += 1;
      const body = await res.clone().json().catch(() => null);
      if (!body || body.code !== 'instance_mismatch') break;
      res = await send();
    }
    if (res.status === 409) {
      const body = await res.json().catch(() => null);
      if (body && body.code === 'instance_mismatch') {
        // Two clean retries still missed: the pinned instance is gone (its
        // ephemeral disk was recycled). Adopt the one that answered - it is
        // the only instance we can actually reach - and let the next request
        // proceed against it.
        if (body.db_marker && body.db_marker !== getDbPin()) setDbPin(body.db_marker);
        else { setDbPin(null); await rePinToRichest().catch(() => {}); }
        res = await send();
      }
    }
  }
  const answered = res.headers.get('X-Db-Marker');
  if (answered && !options.anyInstance) {
    const cur = getDbPin();
    if (!cur) setDbPin(answered);
    else if (answered !== cur && affinity && !idempotent) setDbPin(answered);
  }
  if (res.status === 401 && recoverable) {
    // A lone 401 can be transient on serverless (cold instance); the auth gate
    // 401s before any handler runs, so retrying is safe.
    for (let attempt = 1; attempt <= 2 && res.status === 401; attempt++) {
      await new Promise((r) => setTimeout(r, attempt * 700));
      res = await send();
    }
  }
  if (res.status === 401 && recoverable) {
    const user = getUserFn();
    const nt = token ? await refreshToken(token) : null;
    if (nt && user) {
      setTok(nt, user);
      headers.Authorization = `Bearer ${nt}`;
      res = await send();
    } else {
      clearTok();
      if (!shop && !printLocked) window.location.href = '/login';
      throw new Error(shop ? 'Session expired' : 'Your session expired. Please sign in again.');
    }
  }
  if (data === null) data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
   const err = new Error((data && data.error) || `Request failed (${res.status})`);
   if (data && data.code) err.code = data.code;
   throw err;
  }
  // Write landed: nudge the live check so open dashboards resync right away.
  if (!idempotent) {
    try { window.dispatchEvent(new Event('chugaz-mutated')); } catch {}
    try { if (onWriteFn) onWriteFn(); } catch {}
  }
  return data;
}

export async function api(path, options = {}) {
  const isGet = !options.method || options.method === 'GET';
  if (!isGet || options.anyInstance || options.signal) return request(path, options, false);
  if (path === '/sync') return syncOnce();
  // Take a prefetched answer (once) before the in-flight/dedupe path.
  const pre = prefetched.get(path);
  if (pre) {
    prefetched.delete(path);
    if (Date.now() - pre.at < PREFETCH_TTL_MS) return pre.p;
  }
  // Collapse identical concurrent reads (two effects mounting together) into a
  // single request; each completes and leaves the map immediately.
  const pending = inFlightGets.get(path);
  if (pending) return pending;
  const run = request(path, options, false).finally(() => { inFlightGets.delete(path); });
  inFlightGets.set(path, run);
  return run;
}

export async function shopApi(path, options = {}) {
    return request(path, options, true);
}

export async function validateShopSession() {
    try {
        const data = await shopApi('/me');
        // Return the fresh account record so callers can replace any stale login copy.
        return data && data.user ? data.user : null;
    } catch {
        clearShopAuth();
        return null;
    }
}

export const fmt = (n) => {
  const num = Number(n) || 0;
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
};
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US') : '');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-US') : '');
// Compact relative time for tables and feeds: "just now", "12m ago", "Mar 3".
export const fmtAgo = (iso) => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)}d ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Subscribe to the app-wide live channel; debounced so bursts trigger ONE refetch.
export function onLive(cb, ms = 800) {
  let t = null;
  const handler = () => {
    clearTimeout(t);
    t = setTimeout(() => cb(), ms);
  };
  window.addEventListener('chugaz-live', handler);
  return () => {
    clearTimeout(t);
    window.removeEventListener('chugaz-live', handler);
  };
}

// Only the most-recent call publishes its result (stale concurrent loads can't overwrite newer data).
export function latest() {
  let n = 0;
  return async function () {
    const seq = ++n;
    const res = await arguments[0]();
    if (seq === n) arguments[1](res);
    else if (arguments[2]) arguments[2]();
    return res;
  };
}