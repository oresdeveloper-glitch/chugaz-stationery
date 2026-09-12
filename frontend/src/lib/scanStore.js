let pending = [];

export function pushScanned(items) {
  for (const it of items) {
    const f = pending.find((p) => p.product_id === it.product_id);
    if (f) f.quantity += it.quantity;
    else pending.push({ ...it });
  }
}

export function takeScanned() {
  const out = pending;
  pending = [];
  return out;
}