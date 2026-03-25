# Hisaabo

**Open-source invoicing and business management for Indian SMBs.**

GST-compliant invoicing, inventory, payments, expenses, reports, and a built-in online store — all in one self-hosted app. A modern replacement for Vyaapaar, Khatabook, and myBillBook.

[![License: O'Saasy](https://img.shields.io/badge/license-O'Saasy-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

---

## Why Hisaabo?

Indian billing apps charge monthly fees for basic features, lock your data behind proprietary clouds, and haven't updated their UIs since 2018. Hisaabo is different:

- **Self-hosted** — Your data stays on your server. No vendor lock-in.
- **Free forever** — The core product is open source. No feature walls.
- **Built for India** — GST/HSN, INR formatting, UPI QR on invoices, Indian FY (April-March), state codes for CGST/SGST vs IGST.
- **Modern stack** — React 19, TypeScript end-to-end, sub-second page loads.
- **Online store included** — Every business gets a free storefront at `store.hisaabo.in/your-business`.

## Features

### Invoicing
- Sale and purchase invoices with auto-numbering and custom prefixes
- Tax Invoice / Bill of Supply / Invoice — auto-selected based on GST registration
- Line-item tax (CGST/SGST or IGST based on state codes), discounts, HSN codes
- Tax-inclusive pricing support with back-calculation
- A5 landscape and A4 portrait PDF generation
- UPI QR code with invoice amount on every PDF
- Bank account details on invoices
- Quotations, proforma invoices, delivery challans, credit notes, sales returns

### Payments
- Multi-mode: Cash, Bank Transfer, UPI, Cheque, Credit/Debit Card
- Multi-invoice allocation (one payment across many invoices)
- Auto-status updates (draft -> sent -> partial -> paid)
- Running balance per party

### Inventory
- Stock tracking with automatic adjustments on invoice create/edit/delete
- Low stock alerts with configurable thresholds
- Conversion units (kg/g, L/mL, etc.) with automatic conversion
- Purchase price, sale price, store price per item
- Stock movement history

### Online Store
- Free storefront for every business (`store.hisaabo.in/your-slug`)
- Phone-verified ordering with Cloudflare Turnstile bot protection
- Custom accent colors, tagline, delivery notes
- Category organization with custom sort order
- Store-specific pricing and descriptions
- Minimum order amount enforcement
- WhatsApp integration for order updates
- Low stock ordering toggle
- Orders create unfulfilled invoices automatically
- Auto-generated Privacy Policy, Terms of Service, Refund Policy
- Mobile-first responsive design

### Parties (Customers & Suppliers)
- GSTIN validation, PAN, state code
- Outstanding and overdue balance tracking
- Party ledger with running balance
- Party merge (deduplicate imported data)
- Ledger PDF and CSV export
- Tally-compatible XML export

### GST Compliance
- GSTR-1 report (B2B, B2C, HSN summary)
- GSTR-3B summary
- HSN-wise tax breakdown
- State code comparison for CGST/SGST vs IGST determination
- Works for non-GST businesses too (labels adapt: "Sales Report" instead of "GSTR-1")

### Reports & Dashboard
- Sales trend charts with period selector (This Month / Quarter / FY / Last FY / All)
- Invoice status breakdown
- Top outstanding parties
- Expenses by category
- Profit & Loss statement
- Receivables aging report
- Party ledger reports

### Import
- Full myBillBook data import (parties, items, invoices, payments, expenses, transfers)
- Batch processing for large datasets
- Multi-invoice payment allocation during import
- Account detection (Cash, Bank, UPI) with auto-creation

### Access Control
- CASL-based RBAC with 5 roles: Superadmin, Admin, Seller Manager, Seller, Accountant
- Granular per-resource permissions
- Sellers cannot modify tax rates or discounts on invoices
- Team invitations via email

### Auth
- Magic link (passwordless) as primary auth — no OTP costs
- Password login as fallback for self-hosted without email
- Session-based auth (HttpOnly, Secure, SameSite=Lax cookies)
- Argon2id password hashing
- 30-day sessions with server-controlled invalidation

### Other
- Multi-business support per user
- Dark mode
- Keyboard shortcuts
- Expense tracking with categories
- Audit log (every mutation tracked with user, entity, IP)
- Desktop app via Tauri v2

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 19 + Vite 6 + TanStack Router | Code-splitting, file-based routing, Tauri-native |
| Styling | Tailwind CSS + CSS custom properties | Dark mode, design tokens, zero runtime |
| API | tRPC v11 + Hono | End-to-end type safety, 14KB server |
| ORM | Drizzle | Type-safe SQL, readable queries, no binary |
| Database | PostgreSQL 16 | ACID, NUMERIC(15,2) for money, WAL for PITR |
| Auth | Sessions + Argon2id + Magic Links | No JWT leaks, passwordless option |
| Permissions | CASL | Attribute-based access control |
| Desktop | Tauri v2 | Lightweight native shell |
| Store | React SPA + Tailwind v4 | Separate lightweight storefront |
| Monorepo | Turborepo + pnpm workspaces | Shared types, parallel builds |
| PDF | PDFKit + NotoSans | A4/A5/thermal, UPI QR, multi-font |
| Deploy | Cloudflare Pages + VPS + Docker | Free frontend hosting, full DB control |

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker (for local PostgreSQL)

### Setup

```bash
git clone https://github.com/your-org/hisaabo.git
cd hisaabo
pnpm install

# Start PostgreSQL
docker compose up -d

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL

# Push schema to database
pnpm db:push

# Start all dev servers
pnpm dev
```

Web app: `http://localhost:5173` | API: `http://localhost:3000` | Store: `http://localhost:5174`

On first visit, create an account and you'll be guided through business setup.

## Project Structure

```
hisaabo/
├── apps/
│   ├── web/                  # Main React SPA
│   │   └── src/
│   │       ├── routes/       # TanStack file-based routes
│   │       ├── components/   # UI components, settings, import wizard
│   │       └── lib/          # tRPC client, utils, hooks
│   ├── store/                # Online store SPA (separate lightweight app)
│   │   └── src/
│   │       ├── components/   # Header, ItemCard, Cart, Checkout, etc.
│   │       └── api.ts        # Store API client
│   └── desktop/              # Tauri v2 shell
├── packages/
│   ├── api/                  # Hono + tRPC server
│   │   └── src/
│   │       ├── routers/      # auth, business, party, item, invoice,
│   │       │                 # payment, expense, dashboard, gst, store
│   │       ├── lib/          # PDF generation, email, permissions, audit
│   │       └── server.ts     # Hono server + public store routes
│   ├── db/                   # Drizzle ORM schema + client
│   │   └── src/
│   │       ├── tenant-schema.ts   # Business data (invoices, items, etc.)
│   │       └── control-schema.ts  # Auth, tenants, members
│   └── shared/               # Zod validators, types, calc, money module
│       └── src/
│           ├── validators.ts
│           ├── calc.ts       # Line item + invoice total calculations
│           └── money.ts      # Fixed-point decimal arithmetic
├── .github/workflows/        # CI/CD pipelines
├── nginx/                    # Production nginx config
├── docker-compose.yml        # Local PostgreSQL
├── docker-compose.prod.yml   # Production deployment
├── Dockerfile                # API container
└── turbo.json                # Build pipeline
```

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all dev servers (API + web + store) |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint all packages |
| `pnpm db:push` | Push schema to DB (dev mode) |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm db:studio` | Open Drizzle Studio |

## Deployment

### Frontend (Cloudflare Pages)

```bash
# Build command: cd apps/web && pnpm build
# Output directory: apps/web/dist
```

### API (Docker)

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Desktop (Tauri)

```bash
cd apps/desktop && cargo tauri build
# Outputs .dmg (macOS), .msi (Windows), .AppImage (Linux)
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full production deployment guide including nginx, TLS, backups, and WAL archiving.

## Security

See [SECURITY.md](SECURITY.md) for:
- Reporting vulnerabilities
- Security architecture overview
- Supported versions

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR guidelines.

## License

[O'Saasy License (v1.0)](LICENSE) — Free to use, self-host, and modify. Cannot be offered as a competing hosted service.

---

Built with care in India. *Hisaab, pakka.*
