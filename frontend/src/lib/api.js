const TOKEN_KEY = 'sst_token';
const USER_KEY = 'sst_user';
const SHOP_TOKEN_KEY = 'sst_shop_token';
const SHOP_USER_KEY = 'sst_shop_user';

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
}

export async function refreshToken(token) {
  try {
    const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) || '';
    const res = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
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
  let res = await fetch(`${base}/api${shop ? '/shop' : ''}${path}`, { ...options, headers });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const user = getUserFn();
    const nt = token ? await refreshToken(token) : null;
    if (nt && user) {
      setTok(nt, user);
      headers.Authorization = `Bearer ${nt}`;
      res = await fetch(`${base}/api${shop ? '/shop' : ''}${path}`, { ...options, headers });
    } else {
      clearTok();
      if (!shop && !printLocked) window.location.href = '/login';
      throw new Error(shop ? 'Session expired' : 'Your session expired. Please sign in again.');
    }
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

export async function api(path, options = {}) {
  return request(path, options, false);
}

export async function shopApi(path, options = {}) {
    return request(path, options, true);
}

export async function validateShopSession() {
    try {
        const data = await shopApi('/me');
        return data ? true : false;
    } catch {
        clearShopAuth();
        return false;
    }
}

export const fmt = (n) => {
  const num = Number(n) || 0;
  return num.toLocaleString('en-US', { maximumFractionDigits: 0 });
};
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US') : '');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-US') : '');