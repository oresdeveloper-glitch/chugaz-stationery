// Parses pack/box/dozen sizes from product names like "120PCS", "100BOX", "24DZN", "5REAM"
// and computes per-piece / per-dozen / per-pack / per-box prices.

function parseCounts(name) {
 const n = (name || '').toUpperCase();
 const get = (re) => {
  const m = n.match(re);
  return m ? Math.max(1, Number(m[1]) || 1) : null;
 };
 const packPieces = get(/(\d+)\s*(?:PCS|PC|PIECES|PACK|PACKS|REAM|REAMS)/i);
 const boxPieces = get(/(\d+)\s*(?:BOX|BOXES|CARTON|CARTONS|CTN)/i);
 const dozenPieces = get(/(\d+)\s*(?:DZN|DZ|DOZEN|DOZENS)/i);
 return { packPieces, boxPieces, dozenPieces };
}

// Number of pieces in the product's own base unit (the unit its selling_price refers to).
function basePieces(product) {
 const { packPieces, boxPieces } = parseCounts(product.name);
 const unit = (product.unit || 'piece').toLowerCase();
 // selling_price is entered per the product's own unit — never re-derive it from the name
 if (unit === 'dozen') return 12;
 if (unit === 'outer' || unit === 'carton') return 1;
 if (unit === 'pack') return packPieces || 1;
 if (unit === 'box') return boxPieces || packPieces || 1;
 return packPieces || 1; // piece / unknown — name counts (e.g. "5REAM", "1200PC") still divide
}

// Pieces represented by one of the buyer-sale units.
function multiplier(unit, product) {
 const { packPieces, boxPieces, dozenPieces } = parseCounts(product.name);
 const u = (unit || 'piece').toLowerCase();
 if (u === 'dozen') return 12;
 if (u === 'pack') return packPieces || 1;
 if (u === 'box') return boxPieces || packPieces || 1;
 return 1; // piece
}

// Admin-entered per-unit price overrides, e.g. { piece: 800, dozen: 9600, pack: 40000 }.
function overrides(product) {
 const raw = product && (product.unit_prices || null);
 if (!raw) return {};
 try {
  const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return o && typeof o === 'object' ? o : {};
 } catch {
  return {};
 }
}

function piecePrice(product) {
 const ov = overrides(product);
 if (ov && Number(ov.piece) > 0) return Number(ov.piece);
 const base = basePieces(product);
 const price = Number(product.selling_price) || 0;
 return base > 0 ? price / base : price;
}

// Price for one of the buyer-sale units.
function unitPrice(unit, product) {
 const u = (unit || 'piece').toLowerCase();
 const ov = overrides(product);
 if (ov && Number(ov[u]) > 0) return Number(ov[u]);
 return piecePrice(product) * multiplier(u, product);
}

// Buyer-sale units that make sense for a product.
function unitsFor(product) {
 const { boxPieces, packPieces } = parseCounts(product.name);
 const unit = (product.unit || 'piece').toLowerCase();
 // Wholesale items sell in their own uploaded unit at the exact given price — no derived piece offers
 if (unit === 'dozen') return [{ id: 'dozen', label: 'Dozen', pieces: 12 }];
 if (unit === 'outer') return [{ id: 'outer', label: 'Outer', pieces: 1 }];
 if (unit === 'carton') return [{ id: 'carton', label: 'Carton', pieces: 1 }];
 const pack = packPieces || 1;
 const box = boxPieces || pack;
 const out = [
  { id: 'piece', label: 'Piece', pieces: 1 },
  { id: 'dozen', label: 'Dozen', pieces: 12 },
 ];
 if (pack > 1) out.push({ id: 'pack', label: 'Pack', pieces: pack });
 if ((box > 1 && box !== pack) || unit === 'box') {
  out.push({ id: 'box', label: 'Box', pieces: box });
 }
 return out;
}

// Pieces the customer actually wants = quantity (in sale unit) * multiplier.
function piecesWanted(quantity, unit, product) {
 return Number(quantity) * multiplier(unit, product);
}

// Convert wanted pieces back to base units for stock reservation / deduction.
function baseUnitsFromPieces(pieces, product) {
 const base = basePieces(product);
 return base > 0 ? pieces / base : pieces;
}

module.exports = { parseCounts, basePieces, multiplier, piecePrice, unitPrice, unitsFor, piecesWanted, baseUnitsFromPieces };