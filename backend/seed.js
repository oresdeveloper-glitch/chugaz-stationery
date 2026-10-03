const path = require('path');
try { require('dotenv').config(); } catch (e) {}
const { db, transact } = require('./src/db');
const bcrypt = require('bcryptjs');

function seed() {
 transact(() => {
  db.prepare("INSERT OR IGNORE INTO roles (id, name) VALUES (1,'admin'),(2,'manager'),(3,'cashier'),(4,'clerk'),(5,'customer')").run();

  const officeA = 'Office A';
  const officeB = 'Office B';
  db.prepare('INSERT OR IGNORE INTO offices (name) VALUES (?), (?)').run(officeA, officeB);
  const officeAId = db.prepare('SELECT id FROM offices WHERE name = ?').get(officeA).id;
  const officeBId = db.prepare('SELECT id FROM offices WHERE name = ?').get(officeB).id;

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@shop.com';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!existing) {
   const hash = bcrypt.hashSync(adminPass, 10);
   db.prepare('INSERT INTO users (name, email, password_hash, role_id) VALUES (?,?,?,1)').run(
    'Administrator', adminEmail, hash
   );
  }

  const custEmail = 'customer@shop.com';
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get(custEmail)) {
   const hash = bcrypt.hashSync('cust123', 10);
   db.prepare('INSERT INTO users (name, email, phone, password_hash, role_id, credit_limit) VALUES (?,?,?,?,5,500)')
    .run('Online Customer', custEmail, '+254711000111', hash);
  }

  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES
   ('shop_name','CHUGAZ STATIONERY'),
   ('shop_address',''),
   ('shop_phone',''),
   ('shop_email',''),
   ('currency','TSh'),
   ('receipt_footer','Thank you for shopping with us!'),
   ('allow_negative_stock','0'),
   ('delivery_fee','3000'),
   ('free_delivery_threshold','50000'),
   ('pickup_available','1'),
   ('payment_instructions','356322054 - CHUGAZ STATIONERY')`).run();

  // Extra staff users so roles/reports are meaningful
  const staff = [
   ['Manager', 'manager@shop.com', 'manager123', 2],
   ['Cashier', 'cashier@shop.com', 'cashier123', 3],
   ['Clerk', 'clerk@shop.com', 'clerk123', 4],
  ];
  for (const [n, e, pw, r] of staff) {
   if (!db.prepare('SELECT id FROM users WHERE email = ?').get(e)) {
    db.prepare('INSERT INTO users (name, email, password_hash, role_id) VALUES (?,?,?,?)')
     .run(n, e, bcrypt.hashSync(pw, 10), r);
   }
  }

  // One cashier per office (Office A / Office B) so multi-branch reporting works.
  const officeCashiers = [
   ['Cashier - Office A', 'cashier-a@shop.com', 'cashier123', officeAId],
   ['Cashier - Office B', 'cashier-b@shop.com', 'cashier123', officeBId],
  ];
  for (const [n, e, pw, oid] of officeCashiers) {
   if (!db.prepare('SELECT id FROM users WHERE email = ?').get(e)) {
    db.prepare('INSERT INTO users (name, email, password_hash, role_id, office_id) VALUES (?,?,?,3,?)')
     .run(n, e, bcrypt.hashSync(pw, 10), oid);
   }
  }

  console.log('Seed complete.');
  console.log('Admin login:   admin@shop.com / admin123');
  console.log('Manager login:  manager@shop.com / manager123');
  console.log('Cashier login:  cashier@shop.com / cashier123');
  console.log('Office A cashier: cashier-a@shop.com / cashier123');
  console.log('Office B cashier: cashier-b@shop.com / cashier123');
  console.log('Customer login: customer@shop.com / cust123');
  console.log(`Database file: ${path.join(__dirname, 'data', 'stationery.db')}`);
 });
}


seed();
