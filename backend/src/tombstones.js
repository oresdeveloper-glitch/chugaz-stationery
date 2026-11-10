// Durable delete markers for entities that the browser recovery mesh merges
// back additively. Without them a snapshot taken before a delete re-creates the
// row on the next cold start, so the delete looks undone after a refresh.
//
// Keys mirror the identity the merge uses (name for categories/brands/suppliers,
// email for users, phone/email/name for customers). Products keep their older
// dedicated deleted_products table.
const { db } = require('./db');

const MAX = 5000;

function cleanKeys(keys) {
  if (!Array.isArray(keys)) return [];
  return [...new Set(keys.map((k) => String(k == null ? '' : k).trim()).filter(Boolean))];
}

function record(entity, keys, at) {
  const clean = cleanKeys(keys);
  if (!entity || !clean.length) return [];
  try {
    // Prefer the caller's original delete time so a row re-created after the
    // delete is not removed again by applyAll. Fall back to the database clock.
    const ts = at ? String(at) : db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t").get().t;
    const ins = db.prepare(`INSERT INTO deleted_records (entity, key, deleted_at)
      VALUES (?, ?, ?)
      ON CONFLICT(entity, key) DO UPDATE SET deleted_at =
        CASE WHEN excluded.deleted_at > deleted_records.deleted_at
             THEN excluded.deleted_at ELSE deleted_records.deleted_at END`);
    for (const key of clean) ins.run(entity, key, ts);
    // A marker only needs to outlive snapshots taken before the delete.
    db.prepare(`DELETE FROM deleted_records WHERE rowid NOT IN (
      SELECT rowid FROM deleted_records ORDER BY deleted_at DESC LIMIT ?
    )`).run(MAX);
  } catch (e) {
    console.warn('[tombstones] record failed:', e && e.message ? e.message : e);
  }
  return clean;
}

function forget(entity, keys) {
  const clean = cleanKeys(keys);
  if (!entity || !clean.length) return;
  try {
    const del = db.prepare('DELETE FROM deleted_records WHERE entity = ? AND key = ?');
    for (const key of clean) del.run(entity, key);
  } catch (_) { /* table missing on very old databases */ }
}

function identityKeys(entity, row) {
  if (!row) return [];
  const s = (v) => (v == null ? '' : String(v).trim());
  switch (entity) {
    case 'products': {
      const sku = s(row.sku);
      if (sku) return [`sku:${sku}`];
      const name = s(row.name);
      return name ? [`name:${name}`] : [];
    }
    case 'categories':
    case 'brands':
    case 'suppliers': {
      const name = s(row.name);
      return name ? [`name:${name}`] : [];
    }
    case 'customers': {
      const keys = [];
      if (s(row.phone)) keys.push(`phone:${s(row.phone)}`);
      if (s(row.email)) keys.push(`email:${s(row.email).toLowerCase()}`);
      if (!keys.length && s(row.name)) keys.push(`name:${s(row.name)}`);
      return keys;
    }
    case 'users': {
      const email = s(row.email).toLowerCase();
      return email ? [`email:${email}`] : [];
    }
    case 'expenses': {
      return [`exp:${s(row.title)}|${Number(row.amount) || 0}|${s(row.expense_date)}|${s(row.notes)}`];
    }
    default:
      return [];
  }
}

function isDeleted(entity, keys) {
  const clean = cleanKeys(keys);
  if (!entity || !clean.length) return false;
  try {
    const q = `SELECT 1 FROM deleted_records WHERE entity = ? AND key IN (${clean.map(() => '?').join(',')}) LIMIT 1`;
    return !!db.prepare(q).get(entity, ...clean);
  } catch (_) {
    return false;
  }
}

// Accepts rows shaped { entity, key } (from a backup file) or
// { entity, keys: [...] } (from the browser that performed the delete).
function importHints(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let n = 0;
  const toSql = (r) => {
    if (r.deleted_at) return String(r.deleted_at);
    const ms = Number(r.at);
    if (!ms) return null;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().replace('T', ' ').replace('Z', '');
  };
  for (const r of rows) {
    if (!r) continue;
    const entity = String(r.entity || '');
    const keys = Array.isArray(r.keys) ? r.keys : r.key ? [r.key] : [];
    n += record(entity, keys, toSql(r)).length;
  }
  return n;
}

const TABLES = {
  categories: { table: 'categories', cols: { 'name:': 'name' } },
  brands: { table: 'brands', cols: { 'name:': 'name' } },
  suppliers: { table: 'suppliers', cols: { 'name:': 'name' } },
  users: { table: 'users', cols: { 'email:': 'email' }, lower: ['email'] },
  customers: { table: 'customers', cols: { 'phone:': 'phone', 'email:': 'email', 'name:': 'name' }, lower: ['email'] },
};

// Belt-and-suspenders after a merge: remove a resurrected row, but keep it when
// the live row was deliberately re-created after the delete (newer clock).
function applyAll() {
  let removed = 0;
  let rows = [];
  try {
    rows = db.prepare('SELECT entity, key, deleted_at FROM deleted_records').all();
  } catch (_) {
    return 0;
  }
  for (const r of rows) {
    const def = TABLES[r.entity];
    if (!def) continue;
    const key = String(r.key || '');
    let col = null;
    let value = null;
    for (const p of Object.keys(def.cols)) {
      if (key.startsWith(p)) { col = def.cols[p]; value = key.slice(p.length); break; }
    }
    if (!col) continue;
    const lowered = def.lower && def.lower.includes(col);
    let row = null;
    try {
      row = lowered
        ? db.prepare(`SELECT id, updated_at FROM ${def.table} WHERE LOWER(${col}) = ? LIMIT 1`).get(String(value).toLowerCase())
        : db.prepare(`SELECT id, updated_at FROM ${def.table} WHERE ${col} = ? LIMIT 1`).get(value);
    } catch (_) {
      continue;
    }
    if (!row) continue;
    if (row.updated_at && String(row.updated_at) > String(r.deleted_at)) continue;
    try {
      db.prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(row.id);
      removed += 1;
    } catch (_) { /* still referenced: the delete guard would have refused */ }
  }
  return removed;
}

module.exports = { record, forget, identityKeys, isDeleted, importHints, applyAll };
