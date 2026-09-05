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

  const cats = [
   ['Paper Products', 'Paper, envelopes, notepads'],
   ['Writing Instruments', 'Pens, pencils, markers'],
   ['Desk Accessories', 'Staplers, scissors, organizers'],
   ['Art Supplies', 'Paints, brushes, sketchbooks'],
   ['Bags & Packaging', 'Bags, gift wrap, packaging'],
  ];
  const insCat = db.prepare('INSERT OR IGNORE INTO categories (name, description) VALUES (?,?)');
  cats.forEach((c) => insCat.run(c[0], c[1]));

  const brands = ['Faber-Castell', 'Pilot', 'Moleskine', 'Uni', 'Staedtler', 'Kokuyo', 'Generic'];
  const insBrand = db.prepare('INSERT OR IGNORE INTO brands (name) VALUES (?)');
  brands.forEach((b) => insBrand.run(b));

  const products = [
   ['A4 Copy Paper 80gsm (500 sheets)', 'Paper Products', 'Generic', 'pack', 3.2, 4.5, 10, 50],
   ['A5 Notebook ruled 100pg', 'Paper Products', 'Moleskine', 'piece', 2.1, 3.0, 20, 80],
   ['Ballpoint Pen Blue 0.7mm', 'Writing Instruments', 'Pilot', 'box', 1.8, 2.75, 24, 120],
   ['Gel Pen Black 0.5mm', 'Writing Instruments', 'Uni', 'piece', 0.9, 1.5, 30, 150],
   ['Pencil HB (12 pack)', 'Writing Instruments', 'Faber-Castell', 'box', 1.2, 2.0, 15, 90],
   ['Highlighter 6 colors', 'Writing Instruments', 'Staedtler', 'pack', 2.6, 4.2, 8, 40],
   ['Stapler + 1000 staples', 'Desk Accessories', 'Kokuyo', 'piece', 4.1, 6.0, 5, 25],
   ['Scissors 21cm', 'Desk Accessories', 'Generic', 'piece', 1.9, 3.2, 6, 30],
   ['Desk Organizer 4 slots', 'Desk Accessories', 'Kokuyo', 'piece', 5.5, 8.0, 3, 12],
   ['Sketchbook A4 100g', 'Art Supplies', 'Moleskine', 'piece', 3.9, 6.5, 7, 20],
   ['Watercolor Set 24 colors', 'Art Supplies', 'Faber-Castell', 'set', 7.5, 12.0, 4, 15],
   ['Marker Permanent Black', 'Writing Instruments', 'Staedtler', 'piece', 1.1, 1.9, 18, 70],
   ['Gift Wrapping Paper Roll', 'Bags & Packaging', 'Generic', 'roll', 2.0, 3.5, 10, 35],
   ['Envelopes DL (100 pack)', 'Paper Products', 'Generic', 'pack', 2.3, 3.4, 12, 45],
   ['Paper Clips (100 pcs)', 'Desk Accessories', 'Generic', 'box', 0.4, 0.9, 20, 100],
  ];

  const insProduct = db.prepare(`
   INSERT INTO products (sku, barcode, name, category_id, brand_id, unit, purchase_price, selling_price,
    reorder_level, current_stock, status)
   VALUES (?,?,?,(SELECT id FROM categories WHERE name=?),(SELECT id FROM brands WHERE name=?),?,?,?,?,?,'active')
  `);
  products.forEach((p, i) => {
   insProduct.run(`SKU-${String(i + 1).padStart(4, '0')}`, `BAR-${String(100000 + i)}`, p[0], p[1], p[2], p[3], p[4] * 1000, p[5] * 1000, p[6], p[7]);
  });

  const suppliers = [
   ['National Stationery Ltd', '+255700111222', 'sales@nationalstationery.com', 'Dar es Salaam, Tanzania', 'P0123456789'],
   ['Karat Supplies', '+255711222333', 'info@karatsupplies.com', 'Dodoma, Tanzania', 'P1112223334'],
   ['OfficeWholesale East Africa', '+255722333444', 'orders@officewholesale.co.tz', 'Arusha, Tanzania', 'P2223334445'],
  ];
  const insSup = db.prepare('INSERT INTO suppliers (name, phone, email, address, tax_number) VALUES (?,?,?,?,?)');
  suppliers.forEach((s) => insSup.run(s[0], s[1], s[2], s[3], s[4]));

  const customers = [
   ['Walk-in Customer', null, null, null],
   ['Neema Joseph', '+255733444555', 'neema@example.com', 'Dar es Salaam'],
   ['Mwenge School Office', '+255744555666', 'office@mwengeschool.ac.tz', 'Kinondoni'],
  ];
  const insCust = db.prepare('INSERT INTO customers (name, phone, email, address) VALUES (?,?,?,?)');
  customers.forEach((c) => insCust.run(c[0], c[1], c[2], c[3]));

  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES
   ('shop_name','Stationery Shop'),
   ('shop_address',''),
   ('shop_phone',''),
   ('shop_email',''),
   ('currency','TSh'),
   ('receipt_footer','Thank you for shopping with us!'),
   ('allow_negative_stock','0'),
   ('delivery_fee','3000'),
   ('free_delivery_threshold','50000'),
   ('pickup_available','1'),
   ('payment_instructions','For card and mobile money orders, pay via the payment link on your order page.')`).run();

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

  seedDemoData();

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

// Deterministic PRNG so reseeding produces the same demo history.
function mulberry32(a) {
 return function () {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 };
}

function seedDemoData() {
 // Only generate history on a fresh database (no sales yet).
 if (db.prepare('SELECT COUNT(*) c FROM sales').get().c > 0) return;

 const rng = mulberry32(20240814);
 const pick = (arr) => arr[Math.floor(rng() * arr.length)];
 const ri = (min, max) => Math.floor(rng() * (max - min + 1)) + min;

 const products = db.prepare("SELECT * FROM products WHERE status='active'").all();
 const customers = db.prepare('SELECT * FROM customers').all();
 const suppliers = db.prepare('SELECT * FROM suppliers').all();
 const staffIds = db.prepare('SELECT id FROM users WHERE role_id IN (1,2,3,4)').all().map((u) => u.id);
 const onlineUser = db.prepare("SELECT * FROM users WHERE role_id=5").get();
 const walkIn = customers.find((c) => c.name.includes('Walk-in')) || customers[0];
 const otherCustomers = customers.filter((c) => c.id !== walkIn.id);

 const stock = {};
 products.forEach((p) => (stock[p.id] = Number(p.current_stock)));
 const customerBalance = {};
 customers.forEach((c) => (customerBalance[c.id] = Number(c.balance)));

 const isoDate = (d, hour, minute) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}:${pad(ri(0, 59))}`;
 };
 const daysAgoDate = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

 // ---- Purchases (restock) roughly every ~10 days over the last 75 days ----
 const PAY = ['cash', 'mobile', 'card', 'bank'];
 for (let j = 0; j < 7; j++) {
  const d = daysAgoDate(j * 10 + ri(1, 4));
  const supplier = pick(suppliers);
  const count = ri(4, 8);
  const bought = [];
  for (let i = 0; i < count; i++) {
   const p = pick(products);
   const qty = ri(40, 110);
   const cost = Number(p.purchase_price);
   bought.push({ product_id: p.id, quantity: qty, unit_cost: cost, total: qty * cost });
   stock[p.id] += qty;
  }
  const subtotal = bought.reduce((s, i) => s + i.total, 0);
  const paid = rng() < 0.7 ? subtotal : Math.round(subtotal * (rng() * 0.5 + 0.3) * 100) / 100;
  const inv = `PO-${202401 + j}-${ri(100, 999)}`;
  const info = db.prepare(`
   INSERT INTO purchases (supplier_id, invoice_number, purchase_date, subtotal, discount, tax, total, paid_amount, payment_status, notes, created_by)
   VALUES (?,?,?,?,0,0,?,?,?,?,?)
  `).run(supplier.id, inv, isoDate(d, 9, 30), subtotal, subtotal, paid, paid >= subtotal ? 'paid' : 'partial', 'Restock', pick(staffIds));
  const pid = Number(info.lastInsertRowid);
  const insItem = db.prepare('INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, total) VALUES (?,?,?,?,?)');
  const insMove = db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by) VALUES (?,?,?,?,?,?)');
  for (const i of bought) {
   insItem.run(pid, i.product_id, i.quantity, i.unit_cost, i.total);
   insMove.run(i.product_id, 'in', i.quantity, pid, `Purchase ${inv}`, pick(staffIds));
  }
  db.prepare('INSERT INTO payments (supplier_id, purchase_id, amount, payment_method, payment_date, notes, created_by) VALUES (?,?,?,?,?,?,?)')
   .run(supplier.id, pid, paid, pick(PAY), isoDate(d, 10, 0), `Payment for ${inv}`, pick(staffIds));
 }

 // ---- Daily POS sales for ~75 days ----
 const methods = ['cash', 'cash', 'cash', 'cash', 'mobile', 'mobile', 'card', 'card', 'bank', 'credit'];
 const saleBase = new Date();
 const DAYS = 74;
 for (let n = DAYS; n >= 0; n--) {
  const d = daysAgoDate(n);
  const dow = d.getDay();
  let numSales = dow === 0 ? ri(2, 4) : dow === 6 ? ri(6, 9) : ri(3, 7);
  if (n > 30) numSales = Math.max(2, Math.round(numSales * 0.9)); // growth over time
  if (n > 55) numSales = Math.max(1, Math.round(numSales * 0.7));

  for (let s = 0; s < numSales; s++) {
   const cust = rng() < 0.55 ? walkIn : pick(otherCustomers);
   const items = [];
   const itemCount = ri(1, 4);
   for (let k = 0; k < itemCount; k++) {
    const qty = rng() < 0.75 ? ri(1, 2) : ri(3, 6);
    // Pick a product that still has enough stock (try a few candidates).
    let p = null;
    for (let t = 0; t < 10; t++) {
     const cand = pick(products);
     if (stock[cand.id] > 0) { p = cand; break; }
    }
    if (!p) break;
    const sellQty = Math.min(qty, stock[p.id]);
    if (sellQty <= 0) break;
    stock[p.id] -= sellQty;
    items.push({ product_id: p.id, name: p.name, qty: sellQty, price: Number(p.selling_price), cost: Number(p.purchase_price) });
   }
   if (items.length === 0) continue;

   const subtotal = items.reduce((sum, i) => sum + i.qty * i.price, 0);
   const method = pick(methods);
   const credit = method === 'credit';
   const paid = credit ? Math.round(subtotal * (rng() < 0.5 ? 0 : rng() * 0.6) * 100) / 100 : subtotal;
   const hour = dow === 0 ? ri(10, 17) : ri(8, 19);
   const when = isoDate(d, hour, ri(0, 59));
   const user = pick(staffIds);
   const inv = `INV-${String(100000 + n * 100 + s)}`;

   const info = db.prepare(`
    INSERT INTO sales (customer_id, invoice_number, sale_date, subtotal, discount, tax, total, paid_amount, payment_method, payment_status, notes, created_by)
    VALUES (?,?,?,?,0,0,?,?,?,'unpaid',?,?)
   `).run(cust.id, inv, when, subtotal, subtotal, paid, method, null, user);
   const saleId = Number(info.lastInsertRowid);

   const insItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, total, cost_at_sale) VALUES (?,?,?,?,0,?,?)');
   const insMove = db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by) VALUES (?,?,?,?,?,?)');
   for (const i of items) {
    insItem.run(saleId, i.product_id, i.qty, i.price, i.qty * i.price, i.cost);
    insMove.run(i.product_id, 'out', i.qty, saleId, `Sale ${inv}`, user);
   }

   let status = 'paid';
   if (credit && paid < subtotal) {
    status = paid <= 0 ? 'unpaid' : 'partial';
    customerBalance[cust.id] = (customerBalance[cust.id] || 0) + (subtotal - paid);
   } else if (paid <= 0) {
    status = 'unpaid';
   }
   db.prepare('UPDATE sales SET payment_status=? WHERE id=?').run(status, saleId);
   if (paid > 0) {
    db.prepare('INSERT INTO payments (customer_id, sale_id, amount, payment_method, payment_date, notes, created_by) VALUES (?,?,?,?,?,?,?)')
     .run(cust.id, saleId, paid, method, when, 'Payment on sale', user);
   }
  }
 }

 // ---- Expenses (monthly recurring) ----
 const EXP = [['Shop rent', 'Rent', 25000], ['Electricity', 'Utilities', ri(1800, 2600)], ['Salaries', 'Payroll', 48000], ['Transport / deliveries', 'Logistics', ri(900, 1500)]];
 for (let m = 0; m < 3; m++) {
  const d = daysAgoDate(m * 30 + ri(1, 6));
  for (const [title, cat, amt] of EXP) {
   db.prepare('INSERT INTO expenses (title, category, amount, expense_date, notes, created_by) VALUES (?,?,?,?,?,?)')
    .run(title, cat, m === 2 && title === 'Salaries' ? 0 : amt, isoDate(d, 9, 0), 'Recurring', pick(staffIds));
  }
 }

 // ---- A few online orders in the last 10 days ----
 const orderStatuses = ['confirmed', 'processing', 'out_for_delivery', 'completed', 'pending', 'completed'];
 const oMethods = ['card', 'mobile', 'cash_on_delivery', 'credit', 'mobile'];
 let addr = db.prepare('SELECT * FROM customer_addresses').all();
 if (onlineUser && addr.length === 0) {
  const a = db.prepare('INSERT INTO customer_addresses (user_id, address_name, recipient_name, phone, address, city, postal_code, is_default) VALUES (?,?,?,?,?,?,?,1)')
   .run(onlineUser.id, 'Home', onlineUser.name, onlineUser.phone, '45 Moi Avenue', 'Nairobi', '00100');
  addr = [{ id: Number(a.lastInsertRowid), address: '45 Moi Avenue' }];
 }
 for (let i = 0; i < 6; i++) {
  const n = ri(0, 9);
  const d = daysAgoDate(n);
  const itemCount = ri(1, 3);
  const items = [];
  for (let k = 0; k < itemCount; k++) {
   const p = pick(products);
   const qty = ri(1, 3);
   if (stock[p.id] - qty < 0) continue;
   stock[p.id] -= qty;
   items.push({ product_id: p.id, name: p.name, qty, price: Number(p.selling_price) });
  }
  if (items.length === 0) continue;
  const subtotal = items.reduce((sum, it) => sum + it.qty * it.price, 0);
  const status = orderStatuses[i];
  const method = oMethods[i] || 'mobile';
  const online = ['card', 'mobile', 'bank'].includes(method);
  const delivery = n % 3 !== 0 ? 150 : 0;
  const total = Math.round((subtotal + delivery) * 100) / 100;
  const ord = db.prepare(`
   INSERT INTO orders (order_number, user_id, order_date, order_status, payment_status, fulfillment_type,
    delivery_address_id, shipping_name, shipping_phone, shipping_address, subtotal, discount, tax, delivery_fee, total, payment_method, created_by)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,?)
  `).run(`ORD-DEMO-${String(1000 + i)}`, onlineUser.id, isoDate(d, ri(9, 18), 30),
   status, online ? 'paid' : 'unpaid',
   delivery > 0 ? 'delivery' : 'pickup',
   addr.length ? addr[0].id : null,
   onlineUser.name, onlineUser.phone, addr.length ? addr[0].address : null,
   subtotal, delivery, total, method, pick(staffIds));
  const oid = Number(ord.lastInsertRowid);
  const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, product_name, unit, quantity, unit_price, discount, tax, total) VALUES (?,?,?,?,?,?,0,0,?)');
  const insMove = db.prepare('INSERT INTO stock_movements (product_id, movement_type, quantity, reference_id, notes, created_by) VALUES (?,?,?,?,?,?)');
  for (const it of items) {
   insItem.run(oid, it.product_id, it.name, 'piece', it.qty, it.price, it.qty * it.price);
   if (status === 'confirmed' || status === 'processing' || status === 'out_for_delivery' || status === 'completed') {
    insMove.run(it.product_id, 'out', it.qty, oid, `Online order ${ord.order_number}`, pick(staffIds));
   }
  }
  db.prepare('INSERT INTO order_payments (order_id, payment_method, transaction_reference, amount, payment_status, paid_at) VALUES (?,?,?,?,?,?)')
   .run(oid, method, online ? `REF-DEMO-${ri(1000, 9999)}` : null, total, online ? 'paid' : 'pending', online ? isoDate(d, 10, 0) : null);
 }

 // ---- Unread contact message ----
 if (db.prepare('SELECT COUNT(*) c FROM contact_messages').get().c === 0) {
  db.prepare('INSERT INTO contact_messages (name, email, subject, message, is_read) VALUES (?,?,?,?,0)')
   .run('Faith Otieno', 'faith@example.com', 'Bulk order quote', 'Hi, we would like a quote for 50 boxes of A4 paper and 100 ballpoint pens for our school. Thank you!');
 }

 // ---- Persist reconstructed stock + customer balances ----
 const updStock = db.prepare('UPDATE products SET current_stock=? WHERE id=?');
 for (const [id, qty] of Object.entries(stock)) updStock.run(Math.max(qty, 0), id);
 const updBal = db.prepare('UPDATE customers SET balance=? WHERE id=?');
 for (const [id, bal] of Object.entries(customerBalance)) updBal.run(Math.max(bal, 0), id);

 console.log('Demo history generated (75 days of sales, purchases, expenses, online orders).');
}

seed();