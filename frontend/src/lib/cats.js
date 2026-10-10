// Category hierarchy helpers shared by the staff product pages and the POS.
// Categories are two levels: top-level categories and their subcategories.
export function orderCats(list) {
  const tops = list.filter((c) => !c.parent_id).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const out = [];
  for (const t of tops) {
    out.push(t);
    list.filter((c) => c.parent_id === t.id)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .forEach((s) => out.push(s));
  }
  list.filter((c) => c.parent_id && !tops.some((t) => t.id === c.parent_id)).forEach((c) => out.push(c));
  return out;
}

export function catLabel(list, c) {
  if (!c.parent_id) return c.name;
  const p = list.find((x) => x.id === c.parent_id);
  return p ? `${p.name} › ${c.name}` : c.name;
}

// Selecting a category also matches its subcategories.
export function catFilterIds(list, id) {
  const n = Number(id);
  return new Set([n, ...list.filter((c) => c.parent_id === n).map((c) => c.id)]);
}

// A product can sit in several categories: its primary one plus any extra
// memberships. ids is a Set (catFilterIds) or an array of category ids.
export function productInCats(p, ids) {
  if (!ids) return true;
  const mine = new Set([
    ...(p.category_ids || []).map(Number),
    p.category_id != null && p.category_id !== '' ? Number(p.category_id) : null,
  ].filter((n) => n != null));
  for (const id of ids) if (mine.has(Number(id))) return true;
  return false;
}

// Decode a shared category barcode (601 + 9-digit category id + EAN-13 check
// digit) back to its category id — mirrors the server's categoryForBarcode.
export function categoryIdForBarcode(code) {
  const s = String(code || '').trim();
  if (!/^\d{13}$/.test(s) || !s.startsWith('601')) return null;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(s[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  if ((10 - (sum % 10)) % 10 !== Number(s[12])) return null;
  const id = Number(s.slice(3, 12));
  return id > 0 ? id : null;
}
