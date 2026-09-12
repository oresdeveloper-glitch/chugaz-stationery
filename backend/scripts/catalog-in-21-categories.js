const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/chugaa boe/Documents/Default Project/backend/data/stationery.db');
db.exec('PRAGMA foreign_keys = ON');

function ean13CheckDigit(base12) {
 let sum = 0;
 for (let i = 0; i < 12; i++) {
  const d = Number(base12[i]);
  sum += i % 2 === 0 ? d : d * 3;
 }
 return (10 - (sum % 10)) % 10;
}
const categoryBarcode = (id) => {
 const row = db.prepare('SELECT barcode FROM products WHERE category_id = ? AND barcode IS NOT NULL AND barcode != ? LIMIT 1').get(id, '');
 if (row) return row.barcode;
 const base12 = '601' + String(Number(id)).padStart(9, '0');
 return base12 + ean13CheckDigit(base12);
};

// group -> existing category id
const M = {
 REAM_A4: 59, REAM_A3: 59, BINDING_TAPE: 70, PENCIL: 59, MANILA: 55,
 TRANSPARENT: 58, PEN: 59, BAITASHA: 54, SPRAY: 61, PHOTO_PAPER: 71,
 FILES: 52, GRAPH_PAD: 60, RULER: 59, MATH_SET: 63, DIARY: 66,
 STAPE_CORRECTION: 68, COLOR_ART: 69, OFFICE_ACC: 67, LAM_FILM: 72,
 STICK_NOTE: 67, RULED_PAPER: 60, SHORTHAND: 66, MARK_PEN: 67,
 HIGHLIGHTER: 67, DAFTARI_STIFF: 56, DAFTARI_PAGES: 57, COUNTER_BOOK: 60,
 MSOMI: 66, GLUE_STICK: 64, GLUE_OFFICE: 65, TAPES: 70,
 UFUTIO_KICHONGEO: 59,
};

const ITEMS = [
 // [name, unit, price, mapKey]
 ['REAM A4 (A1 & NO1) PIECE', 'piece', 10000, 'REAM_A4'],
 ['REAM A4 (A1 & NO1) CARTON', 'carton', 50000, 'REAM_A4'],
 ['REAM A3 MAGNA PIECE', 'piece', 30000, 'REAM_A3'],
 ['REAM A3 MAGNA CARTON', 'carton', 150000, 'REAM_A3'],
 ['REAM A3 A1 PIECE', 'piece', 32000, 'REAM_A3'],
 ['REAM A3 A1 CARTON', 'carton', 160000, 'REAM_A3'],
 ['BINDING TAPE BLACK PIECE', 'piece', 3500, 'BINDING_TAPE'],
 ['PENCIL NATARAJ PIECE', 'piece', 300, 'PENCIL'],
 ['PENCIL NATARAJ DOZEN', 'dozen', 3000, 'PENCIL'],
 ['PENCIL NATARAJ OUTER', 'outer', 30000, 'PENCIL'],
 ['PENCIL CHINA PIECE', 'piece', 100, 'PENCIL'],
 ['PENCIL CHINA DOZEN', 'dozen', 800, 'PENCIL'],
 ['PENCIL DOMS DOZEN', 'dozen', 2500, 'PENCIL'],
 ['PENCIL DOMS OUTER', 'outer', 25000, 'PENCIL'],
 ['MANILA BLUE PIECE', 'piece', 6000, 'MANILA'],
 ['MANILA GREEN PIECE', 'piece', 6000, 'MANILA'],
 ['MANILA ORANGE PIECE', 'piece', 6000, 'MANILA'],
 ['TRANSPARENT BLUE PIECE', 'piece', 11000, 'TRANSPARENT'],
 ['TRANSPARENT WHITE PIECE', 'piece', 10000, 'TRANSPARENT'],
 ['PEN (BLUE/RED/BLACK) PIECE', 'piece', 200, 'PEN'],
 ['PEN (BLUE/RED/BLACK) DOZEN', 'dozen', 5000, 'PEN'],
 ['PEN NATARAJ (BLUE/BLACK) PIECE', 'piece', 500, 'PEN'],
 ['PEN NATARAJ (BLUE/BLACK) DOZEN', 'dozen', 1500, 'PEN'],
 ['BAITASHA A6 PIECE', 'piece', 100, 'BAITASHA'],
 ['BAITASHA A6 DOZEN', 'dozen', 2500, 'BAITASHA'],
 ['BAITASHA A3 PIECE', 'piece', 500, 'BAITASHA'],
 ['BAITASHA A3 DOZEN', 'dozen', 7000, 'BAITASHA'],
 ['BAITASHA A4 PIECE', 'piece', 200, 'BAITASHA'],
 ['BAITASHA A4 DOZEN', 'dozen', 5000, 'BAITASHA'],
 ['DAFTARI PAGE 100 PIECE', 'piece', 1000, 'DAFTARI_PAGES'],
 ['DAFTARI PAGE 100 DOZEN', 'dozen', 8000, 'DAFTARI_PAGES'],
 ['DAFTARI PAGE 200 PIECE', 'piece', 1300, 'DAFTARI_PAGES'],
 ['DAFTARI PAGE 200 DOZEN', 'dozen', 12000, 'DAFTARI_PAGES'],
 ['DAFTARI STIFF COVER PIECE', 'piece', 1500, 'DAFTARI_STIFF'],
 ['DAFTARI STIFF COVER DOZEN', 'dozen', 14000, 'DAFTARI_STIFF'],
 ['DAFTARI COUNTER BOOK Q2 PIECE', 'piece', 2000, 'COUNTER_BOOK'],
 ['DAFTARI COUNTER BOOK Q2 DOZEN', 'dozen', 20000, 'COUNTER_BOOK'],
 ['DAFTARI COUNTER BOOK Q3 PIECE', 'piece', 2500, 'COUNTER_BOOK'],
 ['DAFTARI COUNTER BOOK Q3 DOZEN', 'dozen', 25000, 'COUNTER_BOOK'],
 ['DAFTARI MSOMI PIECE', 'piece', 800, 'MSOMI'],
 ['DAFTARI MSOMI DOZEN', 'dozen', 8000, 'MSOMI'],
 ['SPRAY ALL COLORS PIECE', 'piece', 3000, 'SPRAY'],
 ['PHOTO PAPER PASSPORT 4R-A6 DOZEN', 'dozen', 5000, 'PHOTO_PAPER'],
 ['PHOTO PAPER 4R-A5 DOZEN', 'dozen', 6000, 'PHOTO_PAPER'],
 ['PHOTO PAPER STICKER A4 DOZEN', 'dozen', 9000, 'PHOTO_PAPER'],
 ['PHOTO PAPER GLOSS A4 DOZEN', 'dozen', 9000, 'PHOTO_PAPER'],
 ['PHOTO PAPER GLOSS A3 DOZEN', 'dozen', 18000, 'PHOTO_PAPER'],
 ['PHOTO PAPER STICKER A3 DOZEN', 'dozen', 18000, 'PHOTO_PAPER'],
 ['SPIRAL FILE PIECE', 'piece', 1500, 'FILES'],
 ['SPIRAL FILE DOZEN', 'dozen', 12000, 'FILES'],
 ['FILE NDOGO PIECE', 'piece', 1000, 'FILES'],
 ['FILE NDOGO DOZEN', 'dozen', 8000, 'FILES'],
 ['FILE KUBWA PIECE', 'piece', 3000, 'FILES'],
 ['FILE KUBWA DOZEN', 'dozen', 30000, 'FILES'],
 ['GLUE STICK SIZE KATI PIECE', 'piece', 1000, 'GLUE_STICK'],
 ['GLUE STICK SIZE KATI DOZEN', 'dozen', 12000, 'GLUE_STICK'],
 ['GLUE OFFICE PIECE', 'piece', 1000, 'GLUE_OFFICE'],
 ['GLUE OFFICE DOZEN', 'dozen', 8500, 'GLUE_OFFICE'],
 ['MASKING TAPE PIECE', 'piece', 1000, 'TAPES'],
 ['MASKING TAPE DOZEN', 'dozen', 8000, 'TAPES'],
 ['TAPE KUBWA PIECE', 'piece', 5000, 'TAPES'],
 ['TAPE SIZE KATI PIECE', 'piece', 4000, 'TAPES'],
 ['TAPE SIZE MEDIUM PIECE', 'piece', 1000, 'TAPES'],
 ['TAPE SIZE NDOGO PIECE', 'piece', 500, 'TAPES'],
 ['GUN HEAT NDOGO PIECE', 'piece', 500, 'GLUE_OFFICE'],
 ['GRAPH PAD PIECE', 'piece', 100, 'GRAPH_PAD'],
 ['GRAPH PAD DOZEN', 'dozen', 2500, 'GRAPH_PAD'],
 ['RULER WHITE PIECE', 'piece', 500, 'RULER'],
 ['RULER WHITE DOZEN', 'dozen', 2500, 'RULER'],
 ['RULER DOMS PIECE', 'piece', 1000, 'RULER'],
 ['RULER DOMS DOZEN', 'dozen', 8000, 'RULER'],
 ['MATHEMATICAL SET OXFORD PIECE', 'piece', 2500, 'MATH_SET'],
 ['MATHEMATICAL SET OXFORD DOZEN', 'dozen', 24000, 'MATH_SET'],
 ['MATHEMATICAL SET DOMS PIECE', 'piece', 5000, 'MATH_SET'],
 ['MATHEMATICAL SET NATARAJ PIECE', 'piece', 6000, 'MATH_SET'],
 ['DIARY A6 PIECE', 'piece', 5000, 'DIARY'],
 ['DIARY A5 PIECE', 'piece', 6000, 'DIARY'],
 ['DIARY A4 PIECE', 'piece', 7000, 'DIARY'],
 ['UFUTIO PIECE', 'piece', 300, 'UFUTIO_KICHONGEO'],
 ['KICHONGEO PIECE', 'piece', 300, 'UFUTIO_KICHONGEO'],
 ['STAPE PIN DOZEN', 'dozen', 1500, 'STAPE_CORRECTION'],
 ['CORRECTION FLUID PIECE', 'piece', 1000, 'STAPE_CORRECTION'],
 ['CORRECTION FLUID DOZEN', 'dozen', 9000, 'STAPE_CORRECTION'],
 ['COLOR PENCIL PIECE', 'piece', 1000, 'COLOR_ART'],
 ['WATER COLOR PIECE', 'piece', 5000, 'COLOR_ART'],
 ['KNIFE MODE NDOGO PIECE', 'piece', 800, 'OFFICE_ACC'],
 ['KNIFE MODE KUBWA PIECE', 'piece', 1000, 'OFFICE_ACC'],
 ['MIKASI MIDOGO PIECE', 'piece', 1500, 'OFFICE_ACC'],
 ['MIKASI MIKUBWA PIECE', 'piece', 2000, 'OFFICE_ACC'],
 ['ID HOLDER KAWAIDA PIECE', 'piece', 1000, 'OFFICE_ACC'],
 ['ID HOLDER DOUBLE SIDE PIECE', 'piece', 2000, 'OFFICE_ACC'],
 ['LAMINATION FILM DOZEN', 'dozen', 16000, 'LAM_FILM'],
 ['STICK NOTE PIECE', 'piece', 1000, 'STICK_NOTE'],
 ['STICK NOTE DOZEN', 'dozen', 8000, 'STICK_NOTE'],
 ['RULED PAPER DOZEN', 'dozen', 11000, 'RULED_PAPER'],
 ['RULED PAPER PIECE', 'piece', 50, 'RULED_PAPER'],
 ['SHORTHAND DOZEN', 'dozen', 9000, 'SHORTHAND'],
 ['SHORTHAND PIECE', 'piece', 1000, 'SHORTHAND'],
 ['MARK PEN DOZEN', 'dozen', 2500, 'MARK_PEN'],
 ['MARK PEN PIECE', 'piece', 500, 'MARK_PEN'],
 ['HIGHLIGHTER PIECE', 'piece', 1000, 'HIGHLIGHTER'],
 ['HIGHLIGHTER DOZEN', 'dozen', 8000, 'HIGHLIGHTER'],
];

db.exec('BEGIN');
try {
 // safety: verify the 102 products in categories >=74 have no references
 const refs = db.prepare(`SELECT
  (SELECT COUNT(*) FROM sale_items si JOIN products p ON p.id = si.product_id WHERE p.category_id >= 74) +
  (SELECT COUNT(*) FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE p.category_id >= 74) +
  (SELECT COUNT(*) FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE p.category_id >= 74) +
  (SELECT COUNT(*) FROM stock_movements sm JOIN products p ON p.id = sm.product_id WHERE p.category_id >= 74) AS n`).get().n;
 if (refs !== 0) throw new Error(`references exist (${refs}), aborting`);

 db.prepare('DELETE FROM products WHERE category_id >= 74').run();
 db.prepare('DELETE FROM categories WHERE id >= 74').run();

 const insProd = db.prepare(`INSERT INTO products (sku, barcode, name, category_id, unit, purchase_price, selling_price, current_stock, status)
  VALUES (?, ?, ?, ?, ?, 0, ?, 0, 'active')`);
 const perCat = {};
 let n = 0;
 for (const [name, unit, price, key] of ITEMS) {
  const catId = M[key];
  const barcode = categoryBarcode(catId);
  let seq = (perCat[catId] = (perCat[catId] || 0) + 1);
  let sku = `P${catId}-${String(seq).padStart(2, '0')}`;
  if (db.prepare('SELECT 1 FROM products WHERE sku = ?').get(sku)) sku = sku + '-' + Date.now() % 1000;
  insProd.run(sku, barcode, name, catId, unit, price);
  n++;
 }
 db.exec('COMMIT');

 console.log(`moved catalog: ${n} products into existing categories`);
 const cats = db.prepare(`SELECT c.id, c.name,
  SUM(CASE WHEN p.status='active' THEN 1 ELSE 0 END) AS active_p
  FROM categories c LEFT JOIN products p ON p.category_id = c.id GROUP BY c.id ORDER BY c.id`).all();
 console.log(`total categories now: ${cats.length}`);
 for (const c of cats) console.log(` [${c.id}] ${c.name} — active:${c.active_p} — barcode ${categoryBarcode(c.id)}`);
} catch (e) {
 db.exec('ROLLBACK');
 throw e;
}
db.close();
