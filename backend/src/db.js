const fs = require('fs');
const path = require('path');

const isVercel = process.env.VERCEL === '1';
const DATA_DIR = isVercel ? '/tmp/stationery-data' : path.join(__dirname, '..', 'data');
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (_) { /* /tmp may be cleaned between invocations */ }

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'stationery.db');

// A brand-new file is seeded on this boot. Seed rows are deliberately stamped
// with an old timestamp (see ensureVersioning/seed epoch below) so a browser
// snapshot from before a disk reset can restore them, while a row the shop
// actually edited always keeps its newer timestamp.
let isNewDb = false;
try { isNewDb = !fs.existsSync(DB_PATH) || fs.statSync(DB_PATH).size === 0; } catch (_) { isNewDb = false; }

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
  // Keep the server alive so every write can be answered with a real 503
  // instead of the process crashing at module load. Reads return empty data.
  const stmt = { get: () => ({}), all: () => [], run: () => ({ lastID: 0, lastInsertRowid: 0, changes: 0 }) };
  return {
    exec: () => {},
    prepare: () => stmt,
    close: () => {},
    __stub: true,
  };
}

// Tables whose rows can be merged back from a browser snapshot. `updated_at`
// is the conflict clock: a merge may only overwrite a row when the snapshot
// carries a strictly newer value. Without this, a snapshot taken before an
// edit was merged back afterwards and silently reverted the edit - the
// "saved successfully, then came back after refresh" symptom.
const VERSIONED_TABLES = ['offices', 'users', 'categories', 'brands', 'products', 'suppliers', 'customers'];
const SEED_EPOCH = '1970-01-01 00:00:00';

function colExists(conn, table, column) {
  try {
    const row = conn.prepare('SELECT COUNT(*) AS c FROM pragma_table_info(?) WHERE name = ?').get(table, column);
    return !!(row && row.c > 0);
  } catch (_) {
    return false;
  }
}

function ensureVersioning(conn) {
  for (const t of VERSIONED_TABLES) {
    try {
      if (!colExists(conn, t, 'updated_at')) conn.exec(`ALTER TABLE ${t} ADD COLUMN updated_at TEXT`);
      // Backfill once: keep the row's real creation time where the table has
      // one, otherwise treat it as seed data (old epoch).
      try {
        conn.exec(`UPDATE ${t} SET updated_at = COALESCE(updated_at, ${colExists(conn, t, 'created_at') ? 'created_at' : `'${SEED_EPOCH}'`}, '${SEED_EPOCH}') WHERE updated_at IS NULL`);
      } catch (_) { /* table without created_at */ }
      // Only stamp inserts that did not bring their own timestamp: a merge
      // inserts the snapshot's updated_at and must preserve it.
      conn.exec(`DROP TRIGGER IF EXISTS trg_${t}_touch_insert`);
      conn.exec(`CREATE TRIGGER trg_${t}_touch_insert AFTER INSERT ON ${t} FOR EACH ROW WHEN NEW.updated_at IS NULL BEGIN UPDATE ${t} SET updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = NEW.id; END`);
      // Any ordinary UPDATE bumps the clock; a merge that explicitly writes
      // updated_at keeps the snapshot's value.
      conn.exec(`DROP TRIGGER IF EXISTS trg_${t}_touch_update`);
      conn.exec(`CREATE TRIGGER trg_${t}_touch_update AFTER UPDATE ON ${t} FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at BEGIN UPDATE ${t} SET updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = NEW.id; END`);
    } catch (e) {
      console.error(`[db] versioning ${t} skipped:`, e && e.message ? e.message : e);
    }
  }
  // Deletes of entities other than products: without a marker an additive
  // snapshot merge re-creates the row and the delete looks undone after a
  // refresh. Products keep their dedicated deleted_products table.
  try {
    conn.exec(`CREATE TABLE IF NOT EXISTS deleted_records (
      entity TEXT NOT NULL,
      key TEXT NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f','now')),
      PRIMARY KEY (entity, key)
    )`);
    conn.exec('CREATE INDEX IF NOT EXISTS idx_deleted_records_entity ON deleted_records(entity)');
  } catch (e) {
    console.error('[db] deleted_records skipped:', e && e.message ? e.message : e);
  }
}

// node:sqlite compiles the SQL text on every prepare(). Hot paths prepare the
// same handful of statements per request (the dashboard runs ~40 of them, a
// list route re-prepares its query for every hit), so keeping the compiled
// handle keyed by its SQL removes that repeated parse from every request
// without touching any query. Bound the map so a dynamic caller can never grow
// it without limit.
// Indexes added after the first performance audit. They are created on every
// boot and after a restore, so an existing production database (and a backup
// restored onto a fresh instance) gets them without a manual migration.
// Each one was added because a measured query plan needed it:
//  - idx_sale_items_cover: makes the dashboard's sale-item aggregates
//    index-only instead of one table lookup per sold line
//    (topProducts 550 -> 228 ms, byCategory 522 -> 172 ms on the 80k-line
//    benchmark database).
//  - idx_orders_created: the orders list sorts newest-first; without it every
//    page load scanned and sorted the whole orders table.
//  - idx_order_payments_order / idx_order_returns_order: the orders list runs
//    one paid-total and one return-count lookup per row (list 52 -> 8 ms).
// Deliberately NOT added: indexes on (status, current_stock, reorder_level) or
// (sale_date, created_by) — measured no faster (the stock predicate compares
// two columns, so no index can narrow it) and the extra index made the
// storefront category query pick a worse plan.
function ensureHotIndexes(conn) {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_sale_items_cover ON sale_items(sale_id, product_id, quantity, total, cost_at_sale)',
    'CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC, id DESC)',
    'CREATE INDEX IF NOT EXISTS idx_order_payments_order ON order_payments(order_id, payment_status)',
    'CREATE INDEX IF NOT EXISTS idx_order_returns_order ON order_returns(order_id, status)',
  ];
  for (const sql of indexes) {
    try { conn.exec(sql); } catch (e) {
      console.error('[db] index skipped:', e && e.message ? e.message : e);
    }
  }
}

function installStatementCache(conn) {
  const raw = conn.prepare.bind(conn);
  const cache = new Map();
  conn.prepare = (sql) => {
    let st = cache.get(sql);
    if (st) return st;
    if (cache.size >= 500) cache.clear();
    st = raw(sql);
    cache.set(sql, st);
    return st;
  };
  return conn;
}

let db = createStubDb();
let dbReady = false;
let DatabaseSyncClass = null;

// Rename the retired "Baitasha" spelling (all three casings) across every
// column that carries it — old browser backups can reintroduce it on merge.
function fixBahashaSpelling(d) {
  const ren = (col) => `REPLACE(REPLACE(REPLACE(${col}, 'BAITASHA', 'BAHASHA'), 'Baitasha', 'Bahasha'), 'baitasha', 'bahasha')`;
  const fix = (table, col) => {
    try {
      d.exec(`UPDATE ${table} SET ${col} = ${ren(col)} WHERE ${col} LIKE '%aitasha%'`);
    } catch (_) { /* table may not exist on a fresh stub */ }
  };
  fix('products', 'name');
  fix('products', 'specifications');
  fix('products', 'description');
  fix('categories', 'description');
  fix('order_items', 'product_name');
  // categories.name is UNIQUE: a merged-in old row would collide on rename,
  // so references move to the surviving row and the duplicate is dropped.
  try {
    const olds = d.prepare("SELECT id, name FROM categories WHERE name LIKE '%aitasha%'").all();
    const survivorOf = d.prepare('SELECT id FROM categories WHERE name = ?');
    const moveTo = d.prepare('UPDATE products SET category_id = ? WHERE category_id = ?');
    const reparent = d.prepare('UPDATE categories SET parent_id = ? WHERE parent_id = ?');
    const addLink = d.prepare('INSERT OR IGNORE INTO product_categories (product_id, category_id) SELECT product_id, ? FROM product_categories WHERE category_id = ?');
    const dropLinks = d.prepare('DELETE FROM product_categories WHERE category_id = ?');
    const dropCat = d.prepare('DELETE FROM categories WHERE id = ?');
    for (const row of olds) {
      const fixed = row.name.replace(/BAITASHA/g, 'BAHASHA').replace(/Baitasha/g, 'Bahasha').replace(/baitasha/g, 'bahasha');
      const survivor = survivorOf.get(fixed);
      if (survivor && survivor.id !== row.id) {
        moveTo.run(survivor.id, row.id);
        reparent.run(survivor.id, row.id);
        addLink.run(survivor.id, row.id);
        dropLinks.run(row.id);
        dropCat.run(row.id);
      } else {
        d.prepare('UPDATE categories SET name = ? WHERE id = ?').run(fixed, row.id);
      }
    }
  } catch (_) { /* categories may not exist yet on a fresh stub */ }
}

try {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) throw new Error('node:sqlite unavailable');
  DatabaseSyncClass = DatabaseSync;
  const real = new DatabaseSync(DB_PATH);
  installStatementCache(real);
  real.exec('PRAGMA journal_mode = WAL');
  // NORMAL is the SQLite-recommended pairing with WAL: commits survive app and
  // process crashes (only an OS-level crash can lose the last transaction).
  // The FULL default fsyncs every statement, which measured ~6 seconds of pure
  // cold-start time here - schema DDL, migrations and the 156-row catalog seed
  // each paid a ~45ms disk sync before the first request could be served.
  real.exec('PRAGMA synchronous = NORMAL');
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
 if (!hasColumn('categories', 'parent_id')) real.exec('ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id)');
    if (!hasColumn('products', 'office_id')) real.exec('ALTER TABLE products ADD COLUMN office_id INTEGER REFERENCES offices(id)');
    // products.category_id is the primary membership; this table holds them all.
    real.exec('CREATE TABLE IF NOT EXISTS product_categories (\n product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,\n category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,\n PRIMARY KEY (product_id, category_id)\n)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_product_categories_cat ON product_categories(category_id)');
    // Products deleted on purpose, remembered by the identity the backup merge
    // uses (sku, else name). Browser snapshots are merged back after a cold
    // start; without this a snapshot taken before the delete re-created the
    // product a few seconds later.
    real.exec('CREATE TABLE IF NOT EXISTS deleted_products (\n id INTEGER PRIMARY KEY AUTOINCREMENT,\n sku TEXT,\n name TEXT NOT NULL,\n deleted_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%d %H:%M:%f\',\'now\'))\n)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_deleted_products_sku ON deleted_products(sku)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_deleted_products_name ON deleted_products(name)');
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
    // Hot paths: POS "Today" (created_by), sales by customer, purchases by supplier.
    real.exec('CREATE INDEX IF NOT EXISTS idx_sales_created_by ON sales(created_by)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON purchases(supplier_id)');
    // Reporting hot paths. Without these every date filter was a full table
    // scan, and every sale's item count re-scanned the whole sale_items table
    // (a 200-row sales list over 60k items measured 3.2s; with the index it is
    // a handful of milliseconds). Ordered newest-first lookups on the activity
    // feeds get the same treatment.
    real.exec('CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(payment_status)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_stock_created ON stock_movements(created_at)');
    real.exec('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)');
    ensureVersioning(real);
    fixBahashaSpelling(real);
  }
  migrate();
  ensureHotIndexes(real);

  try {
    real.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('payment_instructions', '356322054 - CHUGAZ STATIONERY');
  } catch (_) { /* settings table may not exist yet on fresh stub */ }

  try {
    real.prepare("UPDATE settings SET value = 'CHUGAZ STATIONERY' WHERE key = 'shop_name' AND value = 'Stationery Shop'").run();
    real.prepare("INSERT INTO settings (key, value) SELECT 'shop_name', 'CHUGAZ STATIONERY' WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'shop_name')").run();
  } catch (_) { /* settings table may not exist yet on fresh stub */ }

  try {
    real.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('db_marker', ?)").run(require('crypto').randomBytes(16).toString('hex'));
  } catch (_) { /* settings table may not exist yet on fresh stub */ }

  // First-run seed of roles + default logins (serverless disks start empty).
  try {
    real.exec("INSERT OR IGNORE INTO roles (id, name) VALUES (1,'admin'),(2,'manager'),(3,'cashier'),(4,'clerk'),(5,'customer')");
    const userCount = real.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    // Precomputed cost-10 digests of the fixed default logins. bcryptjs at
    // cost 10 costs ~0.5s PER HASH, and this block runs inside the serverless
    // cold start before any request is served (7 hashes = ~2.6s of the boot);
    // the values below are exactly what hashSync(pw, 10) produced for these
    // public demo passwords, so verification behaves identically - only the
    // compute moved ahead of time. A custom ADMIN_PASSWORD still hashes here.
    const DEFAULT_HASH = {
      admin123: '$2a$10$j0ZyRWKyYzMGzkhuiUDfH.DVPBNC2Dj5HkWDnj3xh3NPZv0XiyZ8u',
      manager123: '$2a$10$fHw.fc6gn6foSn0NvKUCiem5BZJPq.AAyFvtXIQ6.GF5FZ3nvYtka',
      cashier123: '$2a$10$tbXRuWTpViqSgrPhZf51cOuNuYeXusp6E7seqsIC/U/.6dfqrxHFK',
      clerk123: '$2a$10$5yLqnHpj93Yga/g3uVDjfe6lS5RZ1Pfs6/ZrCRzEW4qM30jUtsAVC',
      cust123: '$2a$10$C.iMzxfXkXpRuM6z/HJtYO/bMgyrv0m4fyewTXQW/8FCewlq5MgCK',
    };
    const seedHash = (pw) => DEFAULT_HASH[pw] || require('bcrypt').hashSync(pw, 10);
    if (!userCount) {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@shop.com';
      const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
      const add = real.prepare("INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?,?,?,?,'active')");
      add.run('Administrator', adminEmail, seedHash(adminPass), 1);
    }

    // Offices are seeded; staff accounts (including office cashiers) are created
    // by the admin through the Users screen. No default staff passwords are
    // shipped with the application.
    real.exec("INSERT OR IGNORE INTO offices (name) VALUES ('Office A'), ('Office B')");
  } catch (e) {
    console.error('[db] bootstrap seed skipped:', e && e.message ? e.message : e);
  }

  // Seed the store catalog when the products table is empty.
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

  // Backfill primary-category memberships (covers pre-join-table databases).
  try {
    real.exec('INSERT OR IGNORE INTO product_categories (product_id, category_id) SELECT id, category_id FROM products WHERE category_id IS NOT NULL');
  } catch (e) {
    console.error('[db] product_categories backfill skipped:', e && e.message ? e.message : e);
  }

  // First boot: everything inserted so far is seed data. Stamp it old so a
  // recovery snapshot (whose rows carry real timestamps) can restore it, while
  // any later edit gets a newer timestamp from the triggers above.
  if (isNewDb) {
    for (const t of VERSIONED_TABLES) {
      try { real.exec(`UPDATE ${t} SET updated_at = '${SEED_EPOCH}'`); } catch (_) { /* table missing */ }
    }
  }

  db = real;
  dbReady = true;
} catch (e) {
  console.error('[db] falling back to stub:', e && e.message ? e.message : e);
  db = createStubDb();
  dbReady = false;
}

function transact(fn) {
  // A stubbed/unavailable database must fail loudly. Returning success here was
  // how a CRUD call could report 200 while nothing was ever written.
  if (db.__stub) throw new Error('Database unavailable — the change was not saved');
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

// Forwards to the current connection so a restore can swap it without re-requires.
const dbProxy = new Proxy({}, {
  get(_, prop) {
    const target = db;
    const v = target[prop];
    return typeof v === 'function' ? v.bind(target) : v;
  },
  set(_, prop, value) { db[prop] = value; return true; },
  has(_, prop) { return prop in db; },
});

function reopenDb() {
  if (!DatabaseSyncClass || db.__stub) return false;
  try { db.close(); } catch (_) {}
  try {
    const fresh = new DatabaseSyncClass(DB_PATH);
    installStatementCache(fresh);
    fresh.exec('PRAGMA journal_mode = WAL');
    // Same rationale as the initial open: WAL + NORMAL, so restores and the
    // writes after them don't pay a per-statement fsync stall.
    fresh.exec('PRAGMA synchronous = NORMAL');
    fresh.exec('PRAGMA foreign_keys = ON');
    // Restored files can predate the versioning columns/triggers and the
    // delete-marker table - add them before any query runs.
    ensureVersioning(fresh);
    ensureHotIndexes(fresh);
    // Restored file may predate the join table — rebuild it before queries run.
    try {
      fresh.exec('CREATE TABLE IF NOT EXISTS product_categories (\n product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,\n category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,\n PRIMARY KEY (product_id, category_id)\n)');
      fresh.exec('CREATE INDEX IF NOT EXISTS idx_product_categories_cat ON product_categories(category_id)');
      fresh.exec('INSERT OR IGNORE INTO product_categories (product_id, category_id) SELECT id, category_id FROM products WHERE category_id IS NOT NULL');
      fresh.exec('CREATE TABLE IF NOT EXISTS deleted_products (\n id INTEGER PRIMARY KEY AUTOINCREMENT,\n sku TEXT,\n name TEXT NOT NULL,\n deleted_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%d %H:%M:%f\',\'now\'))\n)');
      fresh.exec('CREATE INDEX IF NOT EXISTS idx_deleted_products_sku ON deleted_products(sku)');
      fresh.exec('CREATE INDEX IF NOT EXISTS idx_deleted_products_name ON deleted_products(name)');
    } catch (_) { /* table may be missing on a stubbed environment */ }
    db = fresh;
    return true;
  } catch (e) {
    console.error('[db] reopen failed:', e && e.message ? e.message : e);
    return false;
  }
}

function isDbReady() { return dbReady && !db.__stub; }

function audit(userId, action, entity, entityId, details) {
  try {
    db.prepare(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)'
    ).run(userId, action, entity, entityId, details ? JSON.stringify(details) : null);
  } catch (e) {
    /* audit must never break a request */
  }
}

// Manager-downloadable backups get password hashes stripped (VACUUM purges bytes).
function writeRedactedCopy(src, dst) {
  if (!DatabaseSyncClass) throw new Error('sqlite unavailable for redacted backup');
  fs.copyFileSync(src, dst);
  const conn = new DatabaseSyncClass(dst);
  try {
    // Leave WAL first so the redaction lands in the main file.
    conn.exec('PRAGMA journal_mode = DELETE');
    conn.exec("UPDATE users SET password_hash = '' WHERE password_hash IS NOT NULL AND password_hash != ''");
    // VACUUM purges the old hash bytes from free pages.
    conn.exec('VACUUM');
  } finally {
    try { conn.close(); } catch (_) { /* already closed */ }
  }
}

module.exports = { db: dbProxy, DB_PATH, transact, audit, dbReady, isDbReady, reopenDb, writeRedactedCopy, fixBahashaSpelling, SEED_EPOCH };
