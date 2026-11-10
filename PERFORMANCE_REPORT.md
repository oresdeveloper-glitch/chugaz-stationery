# Performance Audit — Phase 5 Report

**Stack:** React 18.3 + Vite 5.4 + react-router-dom 6.26 (frontend); Express 4 + `node:sqlite` on Node v24.19.0 (backend). No Flutter project exists in this repository (no `pubspec.yaml`, no `*.dart`, no Flutter dependencies); Flutter DevTools/profile-mode guidance does not apply and is not faked.

**Scope:** Read-only diagnosis against a separate, realistic-size benchmark database (`%TEMP%\opencode\bench\bench.db` — 2,000 products, 20,000 sales, 80,000 sale items, 5,014 orders). The production database (`backend/data/stationery.db`) was never modified; production CRUD writes were not performed.

---

## 1. Root causes (with evidence)

Evidence was collected from real HTTP benchmarks (`bench-http.cjs`) and a per-statement SQL profiler (`profile-server.cjs`) running the actual Express app against the benchmark database.

| # | Root cause | Evidence |
|---|---|---|
| 1 | `reports.js` dashboard scanned `sales`/`sale_items`/`payments` 2–4 times each and looked up a product row for every sold line. | Profiler: `topProducts` 952 ms, `byCategory` 682 ms, `dailyProfit` 232 ms, `topCustomers` 163 ms, `byHour` 139 ms, `byWeekday` 126 ms, `dailySales` 108 ms — 44 statements, 3,039 ms total for `dashboard?range=all`. |
| 2 | Missing indexes on hot paths. `orders` list sorted the whole table; sale-item aggregates did a table lookup per line. | `ordersList` 52 → 8.1 ms with `idx_orders_created` + `idx_order_payments_order` + `idx_order_returns_order`. `topProducts` 550 → 152 ms with `idx_sale_items_cover` + grouped-first rewrite. |
| 3 | `/api/products` returned `p.*` (2.12 MB), including `description` (264 KB), `specifications` (178 KB), `unit_prices` (54 KB) and a derived `units` array for every row, even though POS/Products/Inventory/Purchases only read ~12 small fields. | Benchmark: `products list` 2,120,277 B per request, 210 ms. |
| 4 | `/shop/categories` ran two correlated subqueries per category (52 full scans of `products` for 26 categories). | 48 ms on 2,000 products; plan showed `SCAN p`. |
| 5 | `/api/customers` returned the whole customer book (242 KB) to the POS, whose dropdown only renders `id` + `name`. | Benchmark: 27.6 ms, 242,597 B. |
| 6 | `dbkeep.js` downloaded the entire SQLite file (`/api/system/backup`, 18.9 MB) every 3 minutes per browser and 1.2 s after live events, even when nothing changed. | 269 ms / 18,886,656 B per download; 3-minute interval + `chugaz-live` trigger. |
| 7 | Dashboard and Layout held a 1-second `setInterval` in component state, re-rendering the whole page (all charts + KPIs) every second. | `Dashboard.jsx` `setClock(new Date())` every 1 s; `Layout.jsx` same. |
| 8 | Products rendered all cards at once (2,000 cards → ~12,000 nodes) with no virtualization. | `Products.jsx` `filtered.map(...)`. |
| 9 | `content-visibility` not used on `.catalog-card` / `.pos-tile`, so off-screen cards were still laid out and painted. | `styles.css` rules lacked `content-visibility`. |
| 10 | ScanScreen fetched the full product list (without `specifications`/`category_description` it needs) via the same heavy endpoint. | `ScanScreen.jsx` used `/products?barcode=` and `/products?q=`. |

---

## 2. Files modified

| File | Change |
|---|---|
| `backend/src/db.js` | Added `ensureHotIndexes(conn)`; called after `migrate()` and in `reopenDb()`. |
| `backend/src/schema.sql` | Appended the 4 performance indexes so fresh installs get them. |
| `backend/src/routes/reports.js` | Dashboard rewritten: KPIs derived from daily grouped rows; payments inflow/outflow merged into one scan; single hour+weekday query; grouped-first `byCategory`/`byCashier`/`topProducts`/`topCustomers`; aging collapsed to one statement per table; deterministic tie ordering on alerts. |
| `backend/src/routes/products.js` | Lean list projection (`LIST_COLUMNS`); `?full=1` and `?scan=1` opt into heavy columns; `withUnits` only for full; `product_categories` lookup scoped to returned ids. |
| `backend/src/routes/shop.js` | Lean `/shop/products` projection; `/shop/categories` rewritten as a CTE (one pass). |
| `backend/src/routes/customers.js` | Added `?view=pos` returning `id, name` only. |
| `frontend/src/components/Clock.jsx` | New leaf components (`DashClock`, `StaffClock`) that own their own tick. |
| `frontend/src/pages/Dashboard.jsx` | Removed per-second state; uses `<DashClock />`. |
| `frontend/src/components/Layout.jsx` | Removed per-second state; uses `<StaffClock />`. |
| `frontend/src/pages/Products.jsx` | Progressive render: first 60 cards + "Show more". |
| `frontend/src/pages/Pos.jsx` | `/customers?view=pos`; lazy images. |
| `frontend/src/pages/ScanScreen.jsx` | `scan=1` on all three product fetches. |
| `frontend/src/lib/dbkeep.js` | Skip whole-file backup when `data_version` is unchanged; clear the stamp on reset/restore. |
| `frontend/src/styles.css` | `content-visibility: auto` + `contain-intrinsic-size` on `.catalog-card` and `.pos-tile`. |

---

## 3. Before / after measurements

Benchmark database: 2,000 products, 20,000 sales, 80,000 sale items, 5,014 orders. All timings are medians of 7 runs against the real Express app + SQLite.

| Endpoint | Before (ms) | After (ms) | Change | Payload before → after |
|---|---:|---:|---:|---|
| `dashboard?range=all` | 2,524 | 1,179 | **−53%** | 20 KB (unchanged) |
| `dashboard?range=month` | 217 | 160 | −27% | 18 KB (unchanged) |
| `dashboard?range=today` | 131 | 66 | −50% | 16 KB (unchanged) |
| `products list` | 210 | 90 | **−57%** | **2,120 KB → 963 KB (−55%)** |
| `orders list (300)` | 63.7 | 27.7 | **−57%** | 189 KB (unchanged) |
| `shop categories` | 48.2 | 16.2 | **−66%** | 4 KB (unchanged) |
| `shop products` | 14.1 | 15.5 | ~0 | **40 KB → 13 KB (−67%)** |
| `customers` (full) | 27.6 | 19.9 | −28% | 243 KB (unchanged) |
| `customers?view=pos` (new) | — | ~15 | — | **243 KB → 46 KB (−81%)** |
| `system backup file` | 269 | 220 | −18% | 18.9 MB (unchanged; dbkeep now skips when unchanged) |

Micro-benchmarks (single query, 9 runs) on the benchmark database:

| Query | Before | After |
|---|---:|---:|
| `topProducts` (dashboard) | 550 ms | 152 ms |
| `byCategory` (dashboard) | 522 ms | 106 ms |
| `dailyProfit` (dashboard) | 193 ms | 162 ms |
| `orders list` | 52 ms | 8 ms |
| `shop categories` | 144 ms | 9 ms |
| `sales aging` (4 → 1 statement) | 54 ms | 20 ms |

---

## 4. Tests performed

- `node --check` on every modified backend and frontend file: **pass**.
- `npm run build` (Vite): **pass** (13.3 s).
- Dashboard JSON value comparison (old vs. new code, same benchmark DB): every KPI, series, breakdown, aging and top value byte-identical except `out_of_stock` tie-order, which is now deterministic (`ORDER BY current_stock, id`).
- Shop categories output byte-identical (3,997 B) between the old correlated-subquery version and the new CTE.
- `aging` output byte-identical between the 4-statement and 1-statement versions.
- Smoke test against the real dev database (`backend/data/stationery.db`, 123 products): `/reports/dashboard`, `/products`, `/customers?view=pos`, `/shop/categories`, `/shop/products`, `/sync`, `/products/:id` all return 200 with the expected fields.
- `ScanScreen` now receives `specifications` + `category_description` via `?scan=1`.
- Products edit still loads full detail via `/products/:id` (units, unit_prices, variants present).
- Shop product detail still returns `units`/`piece_price` for `ProductDetail.jsx`.

---

## 5. Remaining issues / not addressed

1. **Persistent storage on Vercel.** Each alias has an ephemeral `/tmp` SQLite file; cross-instance durability still requires a persistent volume or managed database. Code changes cannot fix this.
2. **Shop list still leaks `purchase_price` to the public** via `/shop/products/:id` (pre-existing; not in scope; flagged for a follow-up).
3. **Storefront out-of-stock handling** relies on an `in_stock` field that the shop list does not currently compute (pre-existing latent bug; left untouched to avoid behavior change).
4. **`content-visibility: auto`** requires a `contain-intrinsic-size` estimate; very long cards may show a brief height jump on first render.
5. **No server-side pagination** on `/api/products` (still returns up to the full catalog). The frontend now pages the render, but the transfer remains ~963 KB for 2,000 products. Adding `?limit`/`?offset` is the next step if catalogs grow past ~5,000 items.
6. **Flutter-specific profiling** (DevTools, profile mode) is inapplicable — this is a React/Vite app.

---

## 6. Deployment recommendations

1. **Restart the running dev/production Node process** so `ensureHotIndexes()` runs against the existing database (the 4 new indexes are created on boot; no manual migration needed).
2. **Set `JWT_SECRET`** in the deployment environment (the app currently warns and falls back to a shared secret).
3. **Deploy the frontend build** (`frontend/dist`) — it contains the clock extraction, lazy render, content-visibility CSS, and the `?view=pos`/`?scan=1` calls.
4. **Do not run the benchmark harness against production**; the benchmark DB and harness live under `%TEMP%\opencode\bench\` and are not part of the repo.
5. **Monitor** `/api/reports/dashboard?range=all` and `/api/products` after deploy; expected medians on the real (small) database are ~10 ms and ~5 ms respectively.
6. If catalogs exceed ~5,000 products, add `?limit`/`?offset` to `/api/products` and the POS filter, and switch the product grid to a virtualized list.

---

## 7. Flutter note

No Flutter project is present in this repository (no `pubspec.yaml`, no `*.dart` files, no Flutter dependencies). The audit was adapted to the actual React 18 + Vite + Express + SQLite stack. Flutter DevTools, profile mode, and widget rebuild profiling are not applicable and were not simulated.
