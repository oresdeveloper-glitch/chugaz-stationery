# CHUGAZ STATIONERY — POS & Inventory

Point of sale, stock control and online orders for CHUGAZ STATIONERY, Mbeya.

## Stack

- Backend: Node.js, Express, SQLite (`node:sqlite`), JWT auth, Nodemailer
- Frontend: React 18 + Vite
- Hosted on Vercel — a push to `main` deploys (`api/index.js` is the
  serverless entry; `backend/server.js` is the same app for local use)

## Run locally

```bash
npm install && (cd backend && npm install) && (cd frontend && npm install)
node backend/server.js         # API on http://localhost:7860
(cd frontend && npm run dev)   # UI on http://localhost:5173
```

## Docker

```bash
docker compose up -d --build   # app on port 7860
```

## Settings

Shop details, SMTP (for email verification codes) and M-Pesa payment
instructions are configured at runtime in Admin → Settings. Env vars you
may set: `PORT`, `DB_PATH`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
and the `SMTP_*` family.

## Test logins (fresh database)

| Role    | Email               | Password    |
|---------|---------------------|-------------|
| Admin   | `admin@shop.com`    | `admin123`  |
| Manager | `manager@shop.com`  | `manager123`|
| Cashier | `cashier@shop.com`  | `cashier123`|
| Clerk   | `clerk@shop.com`    | `clerk123`  |
| Customer| `customer@shop.com` | `cust123`   |

Office cashiers `cashier-a@shop.com` and `cashier-b@shop.com` (password
`cashier123`) are created automatically as well.

## Phone install

The customer shop is a PWA. Open the site in the phone browser and choose
"Add to Home screen" (manifest lives in `frontend/public/manifest.json`).

## Data note

The database is one SQLite file (`backend/data/stationery.db`). On Vercel it
sits in `/tmp`, so each serverless instance starts empty — the app seeds the
catalog on boot and staff browsers keep a rolling backup that is merged back
after a reset.
