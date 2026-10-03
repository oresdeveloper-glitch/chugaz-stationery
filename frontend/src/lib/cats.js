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
