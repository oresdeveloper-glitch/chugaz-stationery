# CHUGAZ STATIONERY - POS & Inventory

A full-stack Point of Sale and Inventory Management System for stationery shops.

## Features
- **POS System** - Sales, cart, checkout, receipts
- **Inventory Management** - Products, categories, suppliers, stock tracking
- **Customer Management** - Accounts, addresses, orders, credit
- **Staff Dashboard** - Orders, sales, reports, expenses
- **Email Verification** - SMTP configurable via Settings
- **Lipa Na Mpesa** - Payment instructions configurable
- **Role-based Access** - Admin, Manager, Cashier, Clerk
- **Multi-office Support**

## Tech Stack
- **Frontend**: React 18 + Vite + React Router
- **Backend**: Node.js + Express + SQLite (better-sqlite3)
- **Auth**: JWT with refresh tokens
- **Database**: SQLite (better-sqlite3)
- **Email**: Nodemailer (SMTP configurable)

## Environment Variables
| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `7860` |
| `NODE_ENV` | Environment | `production` |
| `DB_PATH` | SQLite database path | `/data/backend/stationery.db` |
| `JWT_SECRET` | JWT signing secret | auto-generated |
| `JWT_EXPIRY` | Token expiry | `7d` |
| `SMTP_HOST` | SMTP server | - |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | - |
| `SMTP_PASS` | SMTP password | - |
| `SMTP_FROM` | Sender email | - |

## Deployment
### Local
```bash
npm install
cd backend && npm install
cd ../frontend && npm install
npm run dev          # frontend (port 5173)
node backend/server.js  # backend (port 4000)
```

### Docker
```bash
docker build -t chugaz-stationery .
docker run -p 7860:7860 -v ./data:/data chugaz-stationery
```

### Hugging Face Spaces
1. Create new Space → Docker
2. Connect this GitHub repo
3. Set Environment Variables in Space Settings:
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
   - `JWT_SECRET` (random 32-char string)
3. Space will auto-build and deploy

## Default Login
| Role | Email | Password |
|------|-------|----------|
| Admin | `admin@shop.com` | `admin123` |
| Manager | `manager@shop.com` | `manager123` |
| Cashier | `cashier@shop.com` | `cashier123` |
| Clerk | `clerk@shop.com` | `clerk123` |

## API Endpoints
- `GET /api/health` - Health check
- `GET /api/system/settings` - Get settings (admin)
- `PUT /api/system/settings` - Update settings (admin)
- `POST /api/system/test-email` - Test SMTP (admin)
- `POST /api/auth/login` - Staff login
- `POST /api/shop/register` - Customer registration
- `POST /api/shop/verify-email` - Email verification
- `POST /api/shop/resend-verification` - Resend code
- `GET /api/shop/info` - Public shop info

## Lipa Na Mpesa
Configure payment instructions in **Admin → Settings → Lipa Namba**:
```
356322054 - CHUGAZ STATIONERY
```

## License
MIT