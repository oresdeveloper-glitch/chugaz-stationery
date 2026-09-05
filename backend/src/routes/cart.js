const express = require('express');
const { db, transact } = require('../db');
const { optionalAuth } = require('../auth');
const u = require('../units');

const router = express.Router();

router.use(optionalAuth);

function guestId(req) {
 const id = req.get('x-guest-id');
 return id && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

function owner(req) {
 if (req.user) return { user_id: req.user.id, guest_id: null };
 const gid = guestId(req);
 if (gid) return { user_id: null, guest_id: gid };
 return null;
}

function getOrCreateCart(own) {
 if (!own) return null;
 let cart;
 if (own.guest_id) cart = db.prepare('SELECT * FROM carts WHERE guest_id = ?').get(own.guest_id);
 else cart = db.prepare('SELECT * FROM carts WHERE user_id = ?').get(own.user_id);
 if (!cart) {
  const info = own.guest_id
   ? db.prepare('INSERT INTO carts (guest_id) VALUES (?)').run(own.guest_id)
   : db.prepare('INSERT INTO carts (user_id) VALUES (?)').run(own.user_id);
  cart = { id: Number(info.lastInsertRowid) };
 }
 return cart;
}

function cartPayload(cartId) {
 const items = db.prepare(`
  SELECT ci.id, ci.product_id, ci.quantity, ci.unit_price, ci.unit,
      p.name AS product_name, p.image, p.unit AS product_unit, p.status, p.selling_price, p.unit_prices
  FROM cart_items ci JOIN products p ON p.id = ci.product_id
  WHERE ci.cart_id = ? ORDER BY ci.id
 `).all(cartId);
 for (const i of items) {
  const prod = { name: i.product_name, unit: i.product_unit, selling_price: i.selling_price, unit_prices: i.unit_prices };
  i.piece_price = u.piecePrice(prod);
  i.pieces = u.piecesWanted(i.quantity, i.unit, prod);
  i.base_needed = u.baseUnitsFromPieces(i.pieces, prod);
  i.unit_label = (i.unit || 'piece');
 }
 const subtotal = items.reduce((s, i) => s + Number(i.unit_price) * Number(i.quantity), 0);
 const count = items.reduce((s, i) => s + Number(i.quantity), 0);
 return { cart_id: cartId, items, subtotal, count };
}

router.get('/', (req, res) => {
 const own = owner(req);
 if (!own) return res.status(401).json({ error: 'Please sign in to view your cart' });
 const cart = getOrCreateCart(own);
 res.json(cartPayload(cart.id));
});

router.post('/items', (req, res) => {
 const { product_id, quantity, unit } = req.body;
 const qty = Number(quantity) || 1;
 if (!product_id || qty <= 0) return res.status(400).json({ error: 'Invalid product or quantity' });
 const own = owner(req);
 if (!own) return res.status(401).json({ error: 'Please sign in to add items to your cart' });
 const product = db.prepare("SELECT * FROM products WHERE id=? AND status='active'").get(product_id);
 if (!product) return res.status(404).json({ error: 'Product not found or unavailable' });
 // Storefront sells wholesale units only, always in the product's own uploaded unit
 if (!['dozen', 'outer', 'carton'].includes(product.unit)) {
  return res.status(400).json({ error: 'This item is not available online. Wholesale packs only (dozen, outer, carton).' });
 }
 const chosenUnit = product.unit;
 const pieces = u.piecesWanted(qty, chosenUnit, product);
 const unitPrice = u.unitPrice(chosenUnit, product);

 const cart = transact(() => {
  const c = getOrCreateCart(own);
  const existing = db.prepare('SELECT * FROM cart_items WHERE cart_id=? AND product_id=?').get(c.id, product_id);
  if (existing) {
   const existingPieces = u.piecesWanted(Number(existing.quantity), existing.unit, product);
   const newPieces = existingPieces + pieces;
   const newQty = newPieces / u.multiplier(chosenUnit, product);
   db.prepare('UPDATE cart_items SET quantity=?, unit_price=?, unit=? WHERE id=?').run(newQty, unitPrice, chosenUnit, existing.id);
  } else {
   db.prepare('INSERT INTO cart_items (cart_id, product_id, quantity, unit_price, unit) VALUES (?,?,?,?,?)')
    .run(c.id, product_id, qty, unitPrice, chosenUnit);
  }
  db.prepare("UPDATE carts SET updated_at = datetime('now') WHERE id=?").run(c.id);
  return c;
 });
 res.status(201).json(cartPayload(cart.id));
});

router.put('/items/:id', (req, res) => {
 const own = owner(req);
 if (!own) return res.status(401).json({ error: 'Please sign in to update your cart' });
 const cart = getOrCreateCart(own);
 const qty = Number(req.body.quantity) || 0;
 const item = db.prepare('SELECT ci.*, p.status FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.id=? AND ci.cart_id=?').get(req.params.id, cart.id);
 if (!item) return res.status(404).json({ error: 'Item not found' });
 if (qty <= 0) {
  db.prepare('DELETE FROM cart_items WHERE id=?').run(req.params.id);
 } else {
  db.prepare('UPDATE cart_items SET quantity=? WHERE id=?').run(qty, req.params.id);
 }
 res.json(cartPayload(cart.id));
});

router.delete('/items/:id', (req, res) => {
 const own = owner(req);
 if (!own) return res.status(401).json({ error: 'Please sign in to update your cart' });
 const cart = getOrCreateCart(own);
 const item = db.prepare('SELECT id FROM cart_items WHERE id=? AND cart_id=?').get(req.params.id, cart.id);
 if (!item) return res.status(404).json({ error: 'Item not found' });
 db.prepare('DELETE FROM cart_items WHERE id=?').run(req.params.id);
 res.json(cartPayload(cart.id));
});

router.delete('/', (req, res) => {
 const own = owner(req);
 if (!own) return res.status(401).json({ error: 'Please sign in to clear your cart' });
 const cart = getOrCreateCart(own);
 db.prepare('DELETE FROM cart_items WHERE cart_id=?').run(cart.id);
 res.json(cartPayload(cart.id));
});

module.exports = router;
