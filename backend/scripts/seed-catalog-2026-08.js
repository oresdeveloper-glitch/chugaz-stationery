const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/chugaa boe/Documents/Default Project/backend/data/stationery.db');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function ean13CheckDigit(base12) {
 let sum = 0;
 for (let i = 0; i < 12; i++) {
  const d = Number(base12[i]);
  sum += i % 2 === 0 ? d : d * 3;
 }
 return (10 - (sum % 10)) % 10;
}
const categoryBarcode = (id) => '601' + String(Number(id)).padStart(9, '0') + ean13CheckDigit('601' + String(Number(id)).padStart(9, '0'));

const CATALOG = [
 { cat: 'REAM A4 (A1 & NO1)', desc: 'A1 & NO1 ream', items: [
  ['REAM A4 (A1 & NO1) PIECE', 'piece', 10000],
  ['REAM A4 (A1 & NO1) CARTON', 'carton', 50000],
 ]},
 { cat: 'REAM A3 (MAGNA & A1)', desc: 'Magna ream, A1 ream', items: [
  ['REAM A3 MAGNA PIECE', 'piece', 30000],
  ['REAM A3 MAGNA CARTON', 'carton', 150000],
  ['REAM A3 A1 PIECE', 'piece', 32000],
  ['REAM A3 A1 CARTON', 'carton', 160000],
 ]},
 { cat: 'BINDING TAPE (BLACK COLOR)', desc: 'Black binding tape', items: [
  ['BINDING TAPE BLACK PIECE', 'piece', 3500],
 ]},
 { cat: 'PENCIL NATARAJ & DOMS', desc: 'Nataraj pencil, China pencil, Doms pencil', items: [
  ['PENCIL NATARAJ PIECE', 'piece', 300],
  ['PENCIL NATARAJ DOZEN', 'dozen', 3000],
  ['PENCIL NATARAJ OUTER', 'outer', 30000],
  ['PENCIL CHINA PIECE', 'piece', 100],
  ['PENCIL CHINA DOZEN', 'dozen', 800],
  ['PENCIL DOMS DOZEN', 'dozen', 2500],
  ['PENCIL DOMS OUTER', 'outer', 25000],
 ]},
 { cat: 'MANILA (BLUE, GREEN, ORANGE)', desc: 'Blue manila, Green manila, Orange manila', items: [
  ['MANILA BLUE PIECE', 'piece', 6000],
  ['MANILA GREEN PIECE', 'piece', 6000],
  ['MANILA ORANGE PIECE', 'piece', 6000],
 ]},
 { cat: 'TRANSPARENT (BLUE & WHITE)', desc: 'Blue transparent, White transparent', items: [
  ['TRANSPARENT BLUE PIECE', 'piece', 11000],
  ['TRANSPARENT WHITE PIECE', 'piece', 10000],
 ]},
 { cat: 'PEN (BLUE, RED, BLACK & NATARAJ)', desc: 'Blue red black pen, Nataraj pen', items: [
  ['PEN (BLUE/RED/BLACK) PIECE', 'piece', 200],
  ['PEN (BLUE/RED/BLACK) DOZEN', 'dozen', 5000],
  ['PEN NATARAJ (BLUE/BLACK) PIECE', 'piece', 500],
  ['PEN NATARAJ (BLUE/BLACK) DOZEN', 'dozen', 1500],
 ]},
 { cat: 'BAITASHA (A3, A4, A6)', desc: 'A6 baitasha, A3 baitasha, A4 baitasha', items: [
  ['BAITASHA A6 PIECE', 'piece', 100],
  ['BAITASHA A6 DOZEN', 'dozen', 2500],
  ['BAITASHA A3 PIECE', 'piece', 500],
  ['BAITASHA A3 DOZEN', 'dozen', 7000],
  ['BAITASHA A4 PIECE', 'piece', 200],
  ['BAITASHA A4 DOZEN', 'dozen', 5000],
 ]},
 { cat: 'DAFTARI', desc: 'Page 100 daftari, Page 200 daftari, Stiff cover daftari, Counter book Q2, Counter book Q3, Msomi', items: [
  ['DAFTARI PAGE 100 PIECE', 'piece', 1000],
  ['DAFTARI PAGE 100 DOZEN', 'dozen', 8000],
  ['DAFTARI PAGE 200 PIECE', 'piece', 1300],
  ['DAFTARI PAGE 200 DOZEN', 'dozen', 12000],
  ['DAFTARI STIFF COVER PIECE', 'piece', 1500],
  ['DAFTARI STIFF COVER DOZEN', 'dozen', 14000],
  ['DAFTARI COUNTER BOOK Q2 PIECE', 'piece', 2000],
  ['DAFTARI COUNTER BOOK Q2 DOZEN', 'dozen', 20000],
  ['DAFTARI COUNTER BOOK Q3 PIECE', 'piece', 2500],
  ['DAFTARI COUNTER BOOK Q3 DOZEN', 'dozen', 25000],
  ['DAFTARI MSOMI PIECE', 'piece', 800],
  ['DAFTARI MSOMI DOZEN', 'dozen', 8000],
 ]},
 { cat: 'SPRAY (ALL COLORS)', desc: 'Spray all colors', items: [
  ['SPRAY ALL COLORS PIECE', 'piece', 3000],
 ]},
 { cat: 'PHOTO PAPER (A6, A5, A4, A3)', desc: 'Passport 4R-A6 photo paper, 4R-A5 photo paper, Sticker A4 photo paper, Gloss A4 photo paper, Gloss A3 photo paper, Sticker A3 photo paper', items: [
  ['PHOTO PAPER PASSPORT 4R-A6 DOZEN', 'dozen', 5000],
  ['PHOTO PAPER 4R-A5 DOZEN', 'dozen', 6000],
  ['PHOTO PAPER STICKER A4 DOZEN', 'dozen', 9000],
  ['PHOTO PAPER GLOSS A4 DOZEN', 'dozen', 9000],
  ['PHOTO PAPER GLOSS A3 DOZEN', 'dozen', 18000],
  ['PHOTO PAPER STICKER A3 DOZEN', 'dozen', 18000],
 ]},
 { cat: 'FILES (SPIRAL, NDOGO, KUBWA)', desc: 'Spiral file, File ndogo, File kubwa', items: [
  ['SPIRAL FILE PIECE', 'piece', 1500],
  ['SPIRAL FILE DOZEN', 'dozen', 12000],
  ['FILE NDOGO PIECE', 'piece', 1000],
  ['FILE NDOGO DOZEN', 'dozen', 8000],
  ['FILE KUBWA PIECE', 'piece', 3000],
  ['FILE KUBWA DOZEN', 'dozen', 30000],
 ]},
 { cat: 'GUNDI (GLUE & TAPES)', desc: 'Glue stick size kati, Glue office, Masking tape, Tape kubwa, Tape size kati, Tape size medium, Tape size ndogo, Gun heat ndogo', items: [
  ['GLUE STICK SIZE KATI PIECE', 'piece', 1000],
  ['GLUE STICK SIZE KATI DOZEN', 'dozen', 12000],
  ['GLUE OFFICE PIECE', 'piece', 1000],
  ['GLUE OFFICE DOZEN', 'dozen', 8500],
  ['MASKING TAPE PIECE', 'piece', 1000],
  ['MASKING TAPE DOZEN', 'dozen', 8000],
  ['TAPE KUBWA PIECE', 'piece', 5000],
  ['TAPE SIZE KATI PIECE', 'piece', 4000],
  ['TAPE SIZE MEDIUM PIECE', 'piece', 1000],
  ['TAPE SIZE NDOGO PIECE', 'piece', 500],
  ['GUN HEAT NDOGO PIECE', 'piece', 500],
 ]},
 { cat: 'GRAPH PAD', desc: 'Graph pad', items: [
  ['GRAPH PAD PIECE', 'piece', 100],
  ['GRAPH PAD DOZEN', 'dozen', 2500],
 ]},
 { cat: 'RULER (WHITE & DOMS)', desc: 'White ruler, Doms ruler', items: [
  ['RULER WHITE PIECE', 'piece', 500],
  ['RULER WHITE DOZEN', 'dozen', 2500],
  ['RULER DOMS PIECE', 'piece', 1000],
  ['RULER DOMS DOZEN', 'dozen', 8000],
 ]},
 { cat: 'MATHEMATICAL SET', desc: 'Oxford mathematical set, Doms mathematical set, Nataraj mathematical set', items: [
  ['MATHEMATICAL SET OXFORD PIECE', 'piece', 2500],
  ['MATHEMATICAL SET OXFORD DOZEN', 'dozen', 24000],
  ['MATHEMATICAL SET DOMS PIECE', 'piece', 5000],
  ['MATHEMATICAL SET NATARAJ PIECE', 'piece', 6000],
 ]},
 { cat: 'DIARY (A6, A5, A4)', desc: 'A6 diary, A5 diary, A4 diary', items: [
  ['DIARY A6 PIECE', 'piece', 5000],
  ['DIARY A5 PIECE', 'piece', 6000],
  ['DIARY A4 PIECE', 'piece', 7000],
 ]},
 { cat: 'UFUTIO, KICHONGEO & STAPE PIN', desc: 'Ufutio, Kichongeo, Stape pin, Correction fluid', items: [
  ['UFUTIO PIECE', 'piece', 300],
  ['KICHONGEO PIECE', 'piece', 300],
  ['STAPE PIN DOZEN', 'dozen', 1500],
  ['CORRECTION FLUID PIECE', 'piece', 1000],
  ['CORRECTION FLUID DOZEN', 'dozen', 9000],
 ]},
 { cat: 'COLORS, KNIFE MODE, MIKASI & ID HOLDER', desc: 'Color pencil, Water color, Knife mode ndogo, Knife mode kubwa, Mikasi midogo, Mikasi mikubwa, ID holder kawaida, ID holder double side', items: [
  ['COLOR PENCIL PIECE', 'piece', 1000],
  ['WATER COLOR PIECE', 'piece', 5000],
  ['KNIFE MODE NDOGO PIECE', 'piece', 800],
  ['KNIFE MODE KUBWA PIECE', 'piece', 1000],
  ['MIKASI MIDOGO PIECE', 'piece', 1500],
  ['MIKASI MIKUBWA PIECE', 'piece', 2000],
  ['ID HOLDER KAWAIDA PIECE', 'piece', 1000],
  ['ID HOLDER DOUBLE SIDE PIECE', 'piece', 2000],
 ]},
 { cat: 'LAMINATION FILM', desc: 'Lamination film', items: [
  ['LAMINATION FILM DOZEN', 'dozen', 16000],
 ]},
 { cat: 'STICK NOTE', desc: 'Stick note', items: [
  ['STICK NOTE PIECE', 'piece', 1000],
  ['STICK NOTE DOZEN', 'dozen', 8000],
 ]},
 { cat: 'RULED PAPER', desc: 'Ruled paper', items: [
  ['RULED PAPER DOZEN', 'dozen', 11000],
  ['RULED PAPER PIECE', 'piece', 50],
 ]},
 { cat: 'SHORTHAND', desc: 'Shorthand', items: [
  ['SHORTHAND DOZEN', 'dozen', 9000],
  ['SHORTHAND PIECE', 'piece', 1000],
 ]},
 { cat: 'MARK PEN', desc: 'Mark pen', items: [
  ['MARK PEN DOZEN', 'dozen', 2500],
  ['MARK PEN PIECE', 'piece', 500],
 ]},
 { cat: 'HIGHLIGHTER', desc: 'Highlighter', items: [
  ['HIGHLIGHTER PIECE', 'piece', 1000],
  ['HIGHLIGHTER DOZEN', 'dozen', 8000],
 ]},
];

db.exec('BEGIN');
try {
 const deact = db.prepare("UPDATE products SET status = 'inactive' WHERE status = 'active'").run();
 const insCat = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)');
 const insProd = db.prepare(`INSERT INTO products (sku, barcode, name, category_id, unit, purchase_price, selling_price, current_stock, status)
  VALUES (?, ?, ?, ?, ?, 0, ?, 0, 'active')`);
 let prodCount = 0;
 const made = [];
 for (const g of CATALOG) {
  const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(g.cat);
  const catId = existing ? existing.id : Number(insCat.run(g.cat, g.desc).lastInsertRowid);
  if (!existing) db.prepare('UPDATE categories SET description = ? WHERE id = ?').run(g.desc, catId);
  const barcode = categoryBarcode(catId);
  g.items.forEach(([name, unit, price], i) => {
   const sku = `C${catId}-${String(i + 1).padStart(2, '0')}`;
   insProd.run(sku, barcode, name, catId, unit, price);
   prodCount++;
  });
  made.push({ catId, cat: g.cat, barcode, n: g.items.length });
 }
 db.exec('COMMIT');
 console.log(`deactivated ${deact.changes} old products`);
 console.log(`inserted ${prodCount} new products in ${made.length} categories`);
 for (const m of made) console.log(` [${m.catId}] ${m.cat} — ${m.n} items — barcode ${m.barcode}`);
} catch (e) {
 db.exec('ROLLBACK');
 throw e;
}
db.close();
