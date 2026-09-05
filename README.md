# Stationery Shop — Inventory Management System (MVP)

A full-stack web app for managing a small stationery shop: products, inventory, purchases, point-of-sale (POS), sales returns, suppliers, customers, expenses, role-based users, reports, receipt printing, and backup/restore — plus a **customer CHUGAZ STATIONERY** (catalog, cart, checkout, order tracking, returns, contact).

**Stack:** Node.js (Express) + built-in `node:sqlite` database + React (Vite)

## Features

- **Login & roles** — admin / manager / cashier / clerk with role-based permissions and audit log
- **Products** — SKU/barcode, category, brand, unit (piece/box/pack…), cost & price, tax, reorder level, image, active/inactive
- **Inventory** — stock-in from purchases, stock-out from sales, returns, adjustments, full movement history, low-stock alerts
- **POS** — barcode scan/search, product grid, discount, tax, cash/card/bank/mobile/credit, printable receipt
- **Sales** — history, detail view, payments, returns (stock restored + refund)
- **Purchases** — stock-in, supplier payments/credit, supplier balance tracking
- **Customers** — profiles, credit limit, running balance, purchase/payment history
- **Suppliers** — profiles, ledger balance, outstanding balances
- **Expenses** — recording and totals by category
- **Reports** — dashboard, profit & loss, sales summary (daily/weekly/monthly), best sellers, inventory valuation, supplier balances, customer credit, cashier performance, tax report, audit log
- **Analytics dashboard** — KPI cards with day/month trend indicators (vs previous periods), sales & profit trend chart, receipts by payment method, POS vs online channel split, revenue by category, receivables/payables, low-stock & out-of-stock alerts, recent orders/payments/stock movements
- **Settings** — shop details, currency, negative-stock policy, receipt footer
- **Backup/restore** — one-click database download and restore
- **Online store** — customer registration/login, product catalog with search & filters, product details, cart, checkout (delivery or pickup), delivery fee + free-delivery threshold, payment methods (COD, at shop, card, mobile money, bank transfer, credit), order tracking, cancel/reorder/return requests, printable invoice, contact form
- **Customer order management (staff)** — order queue by status, confirm (deducts stock), reject, advance status, print invoice/packing list, refunds, return approval (restores stock), stats, customer messages inbox

## Business rules enforced

- A sale **cannot** make stock negative (configurable in Settings).
- Every stock change writes a **stock movement** record.
- Product cost and selling price stored separately; COGS uses cost at time of sale.
- Products with history are **deactivated**, not deleted.
- Stock adjustments require **manager/admin**; every action is **audited**.
- Returns reference the original sale/purchase and restore stock.
- Online orders **reserve stock** when placed and only deduct it when confirmed; cancelled/rejected orders release the reservation.

## Project structure

```
backend/            Express API + SQLite database
  src/db.js         database connection (node:sqlite) + transaction helper
  src/schema.sql    full relational schema
  src/routes/       auth, products, suppliers, customers, purchases, sales,
                    stock, expenses, users, reports, system (settings/backup),
                    shop, customer, cart, customerOrders, orderAdmin, messages
  seed.js           creates roles, admin user, demo customer, sample data
  server.js         entry point (also serves built frontend)
  data/             SQLite file lives here (gitignored)
frontend/           React + Vite SPA
  src/pages/        one page per screen (Dashboard, Products, POS, Sales, ...)
  src/pages/shop/   storefront pages (Catalog, ProductDetail, Cart, Checkout,
                    MyOrders, OrderDetail, Invoice, Profile, Addresses, ...)
  src/shop/         shop context + layout (separate customer session)
  src/components/   Layout, Modal, Toast
```

## Run locally (development)

Requires Node.js **22+** (uses the built-in `node:sqlite` module).

```bash
# 1. install backend dependencies
cd backend && npm install

# 2. seed the database (creates roles, users, sample products, and ~75 days of
#    realistic demo history: POS sales, purchases, expenses, payments, online orders)
npm run seed
#    default admin: admin@shop.com / admin123

# 3. start API on http://localhost:4000
npm start
```

In a second terminal:

```bash
cd frontend && npm install && npm run dev   # http://localhost:5173
```

The Vite dev server proxies `/api` and `/uploads` to the backend on port 4000.

## Run in production (single server)

```bash
npm run setup        # installs deps + builds frontend
npm run seed         # first time only
SERVE_FRONTEND=1 npm start    # serves app + API together on :4000
```

Open `http://localhost:4000`. The CHUGAZ STATIONERY is at `http://localhost:4000/shop`.

## Deploy to cloud

### Option A — Docker (any VPS, Render, Railway, Fly.io…)

```bash
docker compose up -d --build
```

- App runs on port `4000`.
- The database is persisted in the `shopdata` Docker volume.
- Set a strong `JWT_SECRET` before first run (in `.env` next to `docker-compose.yml`).

To seed in Docker (first run):

```bash
docker compose exec app node seed.js
```

### Option B — Platform (Render / Railway / Fly)

1. Push this repo.
2. Set build command: `npm run setup` and start command: `npm start`.
3. Environment variables: `PORT` (set by platform), `SERVE_FRONTEND=1`, `JWT_SECRET`.
4. Mount a persistent disk on the app and set `DB_PATH=/path/on/disk/stationery.db` so the database survives restarts.
5. Open a one-off console once and run `node seed.js`.

### Option C — Local computer / LAN

Run as in "production" above. For other computers on the LAN to access it, bind the server to the machine's LAN IP (set `PORT` and start with `node server.js`); open `http://<lan-ip>:4000` from other devices.

## Default login

| Role    | Email                | Password |
|---------|----------------------|----------|
| admin   | `admin@shop.com`     | `admin123` |
| manager | `manager@shop.com`   | `manager123` |
| cashier | `cashier@shop.com`   | `cashier123` |
| clerk   | `clerk@shop.com`     | `clerk123` |
| customer (store) | `customer@shop.com` | `cust123` |

The storefront session is separate from the staff session — you can be signed in to both. Change the admin password immediately after first login, and set a real `JWT_SECRET`.

### Role-based access

Each role sees only the pages they are allowed to use; the sidebar, routes and API all enforce the same rules (customers use the CHUGAZ STATIONERY, not the staff app).

| Page / area            | Minimum role |
|------------------------|--------------|
| Dashboard              | clerk        |
| Point of Sale, Sales   | cashier      |
| Products, Purchases, Customers, Customer Orders | clerk |
| Inventory, Suppliers, Expenses, Reports, Users, Messages | manager |
| Settings               | admin        |
| Online store           | public       |

Staff sign-in at the main login; customer accounts get a message directing them to the CHUGAZ STATIONERY. Deep links to pages you can't access show an **Access denied** screen.

## Backup

Go to **Settings → Backup & restore** to download a `.db` snapshot anytime. Restore uploads a snapshot back. Before a restore the current database is automatically saved as `stationery-pre-restore.db`.
