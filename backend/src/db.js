const fs = require('fs');
const path = require('path');

const isVercel = process.env.VERCEL === '1';
const DATA_DIR = isVercel ? '/tmp/stationery-data' : path.join(__dirname, '..', 'data');
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (_) { /* /tmp may be cleaned between invocations */ }

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'stationery.db');

// Load node:sqlite dynamically so @vercel/node (esbuild) does not rewrite
// the mandatory 'node:' prefix to a bare 'sqlite' package at build time.
function loadDatabaseSync() {
  try {
    // eslint-disable-next-line no-eval
    const m = eval('require')('node:' + 'sqlite');
    return m && m.DatabaseSync ? m.DatabaseSync : null;
  } catch (_) {
    return null;
  }
}

function createStubDb() {
  const stmt = { get: () => undefined, all: () => [], run: () => ({ lastID: 0, changes: 0 }) };
  return {
    exec: () => {},
    prepare: () => stmt,
    close: () => {},
    __stub: true,
  };
}

let db = createStubDb();
let dbReady = false;

try {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) throw new Error('node:sqlite unavailable');
  const real = new DatabaseSync(DB_PATH);
  real.exec('PRAGMA journal_mode = WAL');
  real.exec('PRAGMA foreign_keys = ON');

  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    if (schema && schema.trim()) real.exec(schema);
  }

  function hasColumn(table, column) {
    try {
      const row = real.prepare('SELECT COUNT(*) AS c FROM pragma_table_info(?) WHERE name = ?').get(table, column);
      return row && row.c > 0;
    } catch (_) {
      return true;
    }
  }

  function migrate() {
    if (!hasColumn('users', 'phone')) real.exec('ALTER TABLE users ADD COLUMN phone TEXT');
    if (!hasColumn('users', 'credit_limit')) real.exec('ALTER TABLE users ADD COLUMN credit_limit REAL NOT NULL DEFAULT 0');
    if (!hasColumn('users', 'balance')) real.exec('ALTER TABLE users ADD COLUMN balance REAL NOT NULL DEFAULT 0');
    if (!hasColumn('users', 'token_ver')) real.exec('ALTER TABLE users ADD COLUMN token_ver INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('users', 'failed_attempts')) real.exec('ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0');
    if (!hasColumn('users', 'locked_until')) real.exec('ALTER TABLE users ADD COLUMN locked_until TEXT');
    if (!hasColumn('users', 'office_id')) real.exec('ALTER TABLE users ADD COLUMN office_id INTEGER REFERENCES offices(id)');
    real.exec('CREATE TABLE IF NOT EXISTS offices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
    real.exec('CREATE TABLE IF NOT EXISTS email_verifications (\n email TEXT PRIMARY KEY,\n code_hash TEXT NOT NULL,\n attempts INTEGER NOT NULL DEFAULT 0,\n expires_at TEXT NOT NULL,\n created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))\n)');
    if (!hasColumn('products', 'reserved_stock')) real.exec('ALTER TABLE products ADD COLUMN reserved_stock REAL NOT NULL DEFAULT 0');
    if (!hasColumn('products', 'description')) real.exec('ALTER TABLE products ADD COLUMN description TEXT');
    if (!hasColumn('products', 'specifications')) real.exec('ALTER TABLE products ADD COLUMN specifications TEXT');
    if (!hasColumn('products', 'unit_prices')) real.exec('ALTER TABLE products ADD COLUMN unit_prices TEXT');
    if (!hasColumn('products', 'parent_id')) real.exec('ALTER TABLE products ADD COLUMN parent_id INTEGER REFERENCES products(id)');
    if (!hasColumn('products', 'office_id')) real.exec('ALTER TABLE products ADD COLUMN office_id INTEGER REFERENCES offices(id)');
    if (!hasColumn('carts', 'guest_id')) {
      real.exec('DROP TABLE IF EXISTS cart_items');
      real.exec('DROP TABLE IF EXISTS carts');
      real.exec('CREATE TABLE carts (\n id INTEGER PRIMARY KEY AUTOINCREMENT,\n user_id INTEGER UNIQUE REFERENCES users(id),\n guest_id TEXT UNIQUE,\n created_at TEXT NOT NULL DEFAULT (datetime(\'now\')),\n updated_at TEXT NOT NULL DEFAULT (datetime(\'now\'))\n);\nCREATE TABLE cart_items (\n id INTEGER PRIMARY KEY AUTOINCREMENT,\n cart_id INTEGER NOT NULL REFERENCES carts(id),\n product_id INTEGER NOT NULL REFERENCES products(id),\n quantity REAL NOT NULL,\n unit_price REAL NOT NULL DEFAULT 0,\n created_at TEXT NOT NULL DEFAULT (datetime(\'now\')),\n UNIQUE(cart_id, product_id)\n);');
    }
    real.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_items_unique ON cart_items(cart_id, product_id)');
    if (!hasColumn('cart_items', 'unit')) real.exec("ALTER TABLE cart_items ADD COLUMN unit TEXT NOT NULL DEFAULT 'piece'");
    real.exec('CREATE TABLE IF NOT EXISTS order_status_history (\n id INTEGER PRIMARY KEY AUTOINCREMENT,\n order_id INTEGER NOT NULL REFERENCES orders(id),\n from_status TEXT,\n to_status TEXT,\n action TEXT NOT NULL,\n changed_by INTEGER REFERENCES users(id),\n changed_by_name TEXT,\n changed_by_role TEXT,\n office_id INTEGER REFERENCES offices(id),\n office_name TEXT,\n notes TEXT,\n created_at TEXT NOT NULL DEFAULT (datetime(\'now\'))\n)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_status_history(order_id)');
    if (!hasColumn('users', 'avatar')) real.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
  }
  migrate();

  try {
    real.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('payment_instructions', '356322054 - CHUGAZ STATIONERY');
  } catch (_) { /* settings table may not exist yet on fresh stub */ }

  // First-run bootstrap: serverless disks (/tmp) start empty and seed.js
  // never runs there, so create roles + default logins when no users exist.
  // Idempotent — skipped on warm instances that already have users.
  try {
    real.exec("INSERT OR IGNORE INTO roles (id, name) VALUES (1,'admin'),(2,'manager'),(3,'cashier'),(4,'clerk'),(5,'customer')");
    const userCount = real.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    if (!userCount) {
      const bcrypt = require('bcryptjs');
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@shop.com';
      const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
      const add = real.prepare("INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?,?,?,?,'active')");
      add.run('Administrator', adminEmail, bcrypt.hashSync(adminPass, 10), 1);
      add.run('Manager', 'manager@shop.com', bcrypt.hashSync('manager123', 10), 2);
      add.run('Cashier', 'cashier@shop.com', bcrypt.hashSync('cashier123', 10), 3);
      add.run('Clerk', 'clerk@shop.com', bcrypt.hashSync('clerk123', 10), 4);
      add.run('Online Customer', 'customer@shop.com', bcrypt.hashSync('cust123', 10), 5);
    }
  } catch (e) {
    console.error('[db] bootstrap seed skipped:', e && e.message ? e.message : e);
  }

  // Catalog bootstrap: ship the real store catalog so the customer shop
  // is not empty on fresh serverless disks. Idempotent — skipped when
  // products already exist (warm instances).
  try {
    const prodCount = real.prepare('SELECT COUNT(*) AS c FROM products').get().c;
    if (!prodCount) {
      const seed = require('./catalog-seed');
      const insCat = real.prepare('INSERT OR IGNORE INTO categories (id, name, description) VALUES (?,?,?)');
      for (const c of seed.categories) insCat.run(c.id, c.name, c.description || null);
      const insBrand = real.prepare('INSERT OR IGNORE INTO brands (id, name) VALUES (?,?)');
      for (const b of seed.brands) insBrand.run(b.id, b.name);
      const insProd = real.prepare(
        'INSERT OR IGNORE INTO products (id, sku, barcode, name, category_id, brand_id, unit, purchase_price, selling_price, tax_rate, discount_rate, reorder_level, current_stock, reserved_stock, image, status, description, specifications, unit_prices, parent_id, office_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)'
      );
      for (const p of seed.products) {
        insProd.run(p.id, p.sku || null, p.barcode || null, p.name, p.category_id || null, p.brand_id || null,
          p.unit || 'piece', p.purchase_price ?? 0, p.selling_price ?? 0, p.tax_rate ?? 0, p.discount_rate ?? 0,
          p.reorder_level ?? 0, p.current_stock ?? 0, p.reserved_stock ?? 0, p.image || null, p.status || 'active',
          p.description || null, p.specifications || null, p.unit_prices || null, p.parent_id || null);
      }
    }
  } catch (e) {
    console.error('[db] catalog seed skipped:', e && e.message ? e.message : e);
  }

  db = real;
  dbReady = true;
} catch (e) {
  console.error('[db] falling back to stub:', e && e.message ? e.message : e);
  db = createStubDb();
  dbReady = false;
}

function transact(fn) {
  if (db.__stub) return fn();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

function audit(userId, action, entity, entityId, details) {
  try {
    db.prepare(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)'
    ).run(userId, action, entity, entityId, details ? JSON.stringify(details) : null);
  } catch (e) {
    /* audit must never break a request */
  }
}

module.exports = { db, DB_PATH, transact, audit, dbReady };
