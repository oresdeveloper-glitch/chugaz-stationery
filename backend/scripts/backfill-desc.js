const { db } = require('C:/Users/chugaa boe/Documents/Default Project/backend/src/db.js');

const CAT_META = {
 6: { name: 'Paper & Print', types: ['Copier paper', 'Printing paper', 'Paper ream'] },
 7: { name: 'Notebooks & Books', types: ['Notebook', 'Exercise book', 'Counter book'] },
 8: { name: 'Files & Filing', types: ['File folder', 'Box file', 'Document file'] },
 9: { name: 'Writing & Drawing', types: ['Writing instrument', 'Drawing tool', 'Pen/pencil'] },
 10: { name: 'Fasteners & Office Supplies', types: ['Fastener', 'Office accessory', 'Binding supply'] },
 11: { name: 'Machines & Equipment', types: ['Machine', 'Office equipment', 'Device'] },
 12: { name: 'Craft & Display', types: ['Craft item', 'Display item', 'Craft supply'] },
 13: { name: 'Electronics & Ink', types: ['Ink cartridge', 'Toner', 'Electronics consumable'] },
 14: { name: 'School & Board Supplies', types: ['School supply', 'Board item', 'Classroom item'] },
 48: { name: 'Household & Other', types: ['Household item', 'General item', 'Utility item'] },
};

const BRAND_HINTS = [
 'SAA', 'VIBAO', 'FRAME', 'AMAZON', 'EXA', 'OPAL', 'A4', 'DL', 'SQ', 'A5', 'A2', 'A3',
 'Q1', 'Q2', 'NO', 'PCS', 'REAM', 'BOX', 'STIFF',
];

function parseName(name, catId) {
 const meta = CAT_META[catId] || { types: ['Stationery item'], name: 'Stationery' };
 const n = (name || '').toUpperCase();
 const pick = (re) => {
  const m = n.match(re);
  return m ? m[1] : null;
 };
 const size = pick(/(A[0-9])/) || null;
 const color = pick(/(BLUE|RED|BLACK|GREEN|YELLOW|WHITE|GREY|GRAY|BROWN|PINK|PURPLE|NAVY|ORANGE)/) || null;
 const count = pick(/([0-9]+)\s*(?:PCS|PACK|BOOKS|PACKS)/) || null;
 const pages = pick(/([0-9]+)\s*(?:PAGE|PAGES)/) || null;
 const qty = count ? `${count} pieces` : (pick(/([0-9]+)\s*(?:REAM|REAMS)/) ? `${pick(/([0-9]+)\s*(?:REAM|REAMS)/)} reams` : null);

 const specs = [];
 if (size) specs.push(`Size: ${size}`);
 if (color) specs.push(`Color: ${color.charAt(0) + color.slice(1).toLowerCase()}`);
 if (pages) specs.push(`Pages: ${pages}`);
 if (qty) specs.push(`Quantity: ${qty}`);

 const baseSpecs = {
  6: ['Material: 70gsm woodfree paper', 'Paper size: Standard', 'Finish: Smooth, double-sided', 'Usage: Printing, copying, school & office'],
  7: ['Binding: Wire/stitched', 'Cover: Soft cover', 'Paper: 60gsm ruled paper', 'Usage: Notes, school & office work'],
  8: ['Material: Cardboard/PVC', 'Closure: Secure', 'Usage: Document storage & filing'],
  9: ['Tip: Standard', 'Ink: Quick-dry', 'Usage: Everyday writing & drawing'],
  10: ['Material: Metal/plastic', 'Finish: Rust-resistant', 'Usage: Binding & fastening documents'],
  11: ['Power: Standard mains', 'Build: Durable body', 'Usage: Office & school use'],
  12: ['Material: Mixed', 'Finish: Easy to cut & shape', 'Usage: Crafts, displays & classrooms'],
  13: ['Type: Ink/toner', 'Compatibility: Standard printers', 'Yield: Consistent output'],
  14: ['Material: Durable', 'Surface: Easy-clean', 'Usage: Classroom, boards & school'],
  48: ['Material: Durable', 'Usage: Household & general use'],
 };
 const bs = baseSpecs[catId] || baseSpecs[48];

 for (const s of bs) if (!specs.includes(s)) specs.push(s);

 let desc;
 if (n.includes('REAM PAPER')) desc = `High-quality ${size || 'standard'} copier paper, ideal for everyday printing and photocopying in offices and schools. Smooth, bright sheets deliver crisp, professional results on every page.`;
 else if (n.includes('COUNTERBOOK')) desc = `Practical counter book for keeping daily records, tallies and accounts. Sturdy binding and clear ruled pages make it a reliable choice for shops and businesses.`;
 else if (n.includes('BOX FILE')) desc = `Sturdy box file designed to keep documents safe, organized and dust-free. Strong construction with a secure closure for long-term filing.`;
 else if (n.includes('FRAME')) desc = `Durable document frame designed for clear display and easy reference. Lightweight yet strong, suitable for desks, counters and pin boards.`;
 else if (n.includes('SAA') || n.includes('VIBAO')) desc = `Reliable stationery essential from a trusted brand, built for everyday use at school, home or the office. Consistent quality you can depend on.`;
 else desc = `Quality ${meta.types[0].toLowerCase()} designed for everyday use. Dependable performance and a practical choice for school, office or home.`;

 return { description: desc, specifications: specs.join('\n') };
}

const products = db.prepare("SELECT id, name, category_id FROM products").all();
let updated = 0;
for (const p of products) {
 const { description, specifications } = parseName(p.name, p.category_id);
 const cur = db.prepare('SELECT description, specifications FROM products WHERE id=?').get(p.id);
 if (!cur.description && !cur.specifications) {
  db.prepare('UPDATE products SET description=?, specifications=? WHERE id=?').run(description, specifications, p.id);
  updated++;
 }
}
console.log(`updated ${updated}/${products.length} products`);
const missing = db.prepare("SELECT COUNT(*) c FROM products WHERE (description IS NULL OR description='') AND (specifications IS NULL OR specifications='')").get().c;
console.log('still missing both:', missing);