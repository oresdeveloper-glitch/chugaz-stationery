const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const isVercel = process.env.VERCEL === '1';
const DATA_DIR = isVercel ? '/tmp/stationery-data' : path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'stationery.db');

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

function hasColumn(table, column) {
 const row = db.prepare(`SELECT COUNT(*) AS c FROM pragma_table_info(?) WHERE name = ?`).get(table, column);
 return row && row.c > 0;
}

function migrate() {
 if (!hasColumn('users', 'phone')) db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
 if (!hasColumn('users', 'credit_limit')) db.exec('ALTER TABLE users ADD COLUMN credit_limit REAL NOT NULL DEFAULT 0');
 if (!hasColumn('users', 'balance')) db.exec('ALTER TABLE users ADD COLUMN balance REAL NOT NULL DEFAULT 0');
 if (!hasColumn('users', 'token_ver')) db.exec('ALTER TABLE users ADD COLUMN token_ver INTEGER NOT NULL DEFAULT 0');
 if (!hasColumn('users', 'failed_attempts')) db.exec('ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0');
 if (!hasColumn('users', 'locked_until')) db.exec('ALTER TABLE users ADD COLUMN locked_until TEXT');
 if (!hasColumn('users', 'office_id')) db.exec('ALTER TABLE users ADD COLUMN office_id INTEGER REFERENCES offices(id)');
 db.exec('CREATE TABLE IF NOT EXISTS offices (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
 db.exec(`CREATE TABLE IF NOT EXISTS email_verifications (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
 )`);
 if (!hasColumn('products', 'reserved_stock')) db.exec('ALTER TABLE products ADD COLUMN reserved_stock REAL NOT NULL DEFAULT 0');
 if (!hasColumn('products', 'description')) db.exec('ALTER TABLE products ADD COLUMN description TEXT');
 if (!hasColumn('products', 'specifications')) db.exec('ALTER TABLE products ADD COLUMN specifications TEXT');
 if (!hasColumn('products', 'unit_prices')) db.exec('ALTER TABLE products ADD COLUMN unit_prices TEXT');
 if (!hasColumn('products', 'parent_id')) db.exec('ALTER TABLE products ADD COLUMN parent_id INTEGER REFERENCES products(id)');
 if (!hasColumn('products', 'office_id')) db.exec('ALTER TABLE products ADD COLUMN office_id INTEGER REFERENCES offices(id)');
 if (!hasColumn('carts', 'guest_id')) {
  db.exec('DROP TABLE IF EXISTS cart_items');
  db.exec('DROP TABLE IF EXISTS carts');
  db.exec(`
   CREATE TABLE carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE REFERENCES users(id),
    guest_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cart_id INTEGER NOT NULL REFERENCES carts(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(cart_id, product_id)
   );
  `);
 }
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_items_unique ON cart_items(cart_id, product_id)');
 if (!hasColumn('cart_items', 'unit')) db.exec("ALTER TABLE cart_items ADD COLUMN unit TEXT NOT NULL DEFAULT 'piece'");
 db.exec(`CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  from_status TEXT,
  to_status TEXT,
  action TEXT NOT NULL,
  changed_by INTEGER REFERENCES users(id),
  changed_by_name TEXT,
  changed_by_role TEXT,
  office_id INTEGER REFERENCES offices(id),
  office_name TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
 )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_status_history(order_id)');
  if (!hasColumn('users', 'avatar')) db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
}
migrate();

function transact(fn) {
 db.exec('BEGIN');
 try {
  const result = fn();
  db.exec('COMMIT');
  return result;
 } catch (err) {
  db.exec('ROLLBACK');
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

module.exports = { db, DB_PATH, transact, audit };