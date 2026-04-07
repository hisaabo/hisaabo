# Hisaabo

> The open-source invoicing and accounting platform built for India's 63 million businesses.

[![CI](https://github.com/hisaabo/hisaabo/actions/workflows/ci.yml/badge.svg)](https://github.com/hisaabo/hisaabo/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/hisaabo/hisaabo/graph/badge.svg)](https://codecov.io/gh/hisaabo/hisaabo)
[![Release](https://img.shields.io/github/v/release/hisaabo/hisaabo?include_prereleases&label=release)](https://github.com/hisaabo/hisaabo/releases)
[![License: O'Saasy](https://img.shields.io/badge/license-O'Saasy-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1586_passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Expo](https://img.shields.io/badge/Expo-55-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)](https://tauri.app/)
[![Hono](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![tRPC](https://img.shields.io/badge/tRPC-11-2596BE?logo=trpc&logoColor=white)](https://trpc.io/)
[![Drizzle](https://img.shields.io/badge/Drizzle-0.38-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-GHCR-2496ED?logo=docker&logoColor=white)](https://ghcr.io/hisaabo/hisaabo)
[![@hisaabo/cli](https://img.shields.io/npm/v/@hisaabo/cli?logo=npm&logoColor=white&label=@hisaabo/cli)](https://www.npmjs.com/package/@hisaabo/cli)
[![@hisaabo/mcp](https://img.shields.io/npm/v/@hisaabo/mcp?logo=npm&logoColor=white&label=@hisaabo/mcp)](https://www.npmjs.com/package/@hisaabo/mcp)

**Hisaab, pakka.** (Honest accounting.)

---

## Why Hisaabo?

India has 63 million MSMEs. Most run their books on paper registers, WhatsApp messages, and a CA who shows up once a year.

**If you use a paper bahi khata** — you are one lost register away from losing years of business records. You cannot generate GST-compliant invoices, track outstanding payments across dozens of parties, or file GSTR-1 without manually copying numbers into a spreadsheet. Hisaabo digitises your entire operation in an afternoon, runs on your phone, and costs nothing.

**If you use Tally** — you paid Rs. 18,000-54,000 for a license that only works on Windows, only runs on one machine, and has no mobile app. Hisaabo runs on any device with a browser, works on Android and iOS, and your CA can access it from their own office. The entire source code is open — no vendor lock-in, no renewal anxiety.

**If you use myBillBook or Vyapar** — you started with a "free" plan that paywalls essential features behind Rs. 3,000-10,000/year subscriptions. Your data lives on their servers, and if you stop paying, you lose access to your own business records. Hisaabo has no feature gates. Every capability is available from day one, and your data stays on your infrastructure.

**If you use Zoho Books** — you are paying a monthly SaaS subscription designed for companies ten times your size, dealing with a complex interface, and hoping the pricing doesn't change next quarter. Hisaabo is built India-first: GST logic is foundational, not bolted on.

### What makes Hisaabo different

- **You own your data.** Self-host on a Rs. 500/month VPS, or use Hisaabo Cloud. Export everything, any time. No lock-in.
- **Rs. 0 forever.** No feature gates, no invoice limits, no "upgrade to unlock GST reports."
- **GST-compliant from the ground up.** CGST/SGST/IGST auto-split, GSTR-1 and GSTR-3B reports, HSN codes, UPI QR on every invoice, April-March financial year.
- **AI-native.** The only Indian invoicing platform with an MCP server and CLI. Connect Claude Desktop and run your bookkeeping in natural language.
- **Every platform, one codebase.** Web, Android, iOS, macOS, Windows, Linux, CLI, and a full API.
- **Production-hardened.** 1,586 tests. Structured logging. CSRF protection. Race-condition-safe payments. No floating-point errors on your balance sheet.

---

## Features

### Invoicing & Documents

| Document | What You Get |
|---|---|
| **Sale & Purchase Invoices** | GST-compliant with CGST/SGST/IGST auto-split, PDF generation (A4/A5/thermal), UPI QR code, delivery tracking |
| **Quotations & Proformas** | Convert to invoice with one click, preserving all line items and terms |
| **Delivery Challans** | Shipment tracking, convert to invoice without double stock deduction |
| **Credit & Debit Notes** | Separate numbering sequences (CN-00001, DN-00001), linked to original invoices |
| **Sales & Purchase Returns** | Stock auto-adjustment on creation, separate SR/PR number sequences |

Every document type gets its own prefix and number sequence (and even this is customizable!).

### GST Compliance

| Feature | Detail |
|---|---|
| **GSTR-1 Report** | B2B invoices (with GSTIN), B2C Large (inter-state > Rs. 2.5L), B2C Small, HSN-wise summary, Credit/Debit notes |
| **GSTR-3B Report** | Outward supplies (taxable, zero-rated, exempt), ITC from purchase invoices, tax payable calculation |
| **Tax Determination** | Automatic CGST+SGST (intra-state) or IGST (inter-state) based on business and party state codes |
| **HSN Codes** | Per-item HSN/SAC code field, included in PDF invoices and GSTR-1 HSN summary |
| **Invoice Titling** | Auto-switches: "TAX INVOICE" (regular), "BILL OF SUPPLY" (composition), "INVOICE" (unregistered) |
| **Financial Year** | April-March default, configurable per business |

### Parties & Ledger

- Customer and supplier management with **GSTIN validation** (regex + checksum)
- Per-party **chronological ledger** with debit/credit entries and running balance
- **Outstanding and overdue tracking** with aging buckets (Current, 31-60, 61-90, 90+ days)
- **Tally-compatible export** (CSV with voucher types, ledger names, amounts)
- Opening balance support, credit period and credit limit tracking

### Items & Inventory

- Real-time **stock tracking** with low-stock alerts
- **Unit conversion**: sell in kg, track in g (configurable conversion factors)
- **Item variants**: Size, Color, etc. with per-variant stock and pricing
- Tax-inclusive and tax-exclusive pricing modes
- HSN/SAC codes, categories, SKU codes
- **Online store pricing** separate from wholesale pricing

### Payments & Banking

- **9 payment modes**: Cash, UPI, Bank Transfer, Cheque, Credit Card, Debit Card, Net Banking, Wallet, Other
- **Multi-invoice allocation**: One payment split across multiple invoices
- **Bank account management**: Savings, Current, Cash, UPI, Credit Card, Payment Gateway
- **Inter-account transfers** with atomic dual-entry balance tracking
- **Payment gateway integration**: Not just "collect online" — full money-flow traceability. Every gateway payment records the transaction ID, auto-creates the expense entry for gateway charges (CC/DC/UPI/NB rates configurable per gateway), and auto-settles the net amount into your linked bank account. Reverse a payment and the charge + settlement unwind automatically.
- **Running balance** per account with full transaction history

### Reports

| Report | Description |
|---|---|
| **Profit & Loss** | Revenue, COGS, gross margin, expenses by category, net margin |
| **Daybook** | Chronological register of all transactions with debit/credit columns |
| **Sales & Purchase Register** | Tax breakdown by rate (5%, 12%, 18%, 28%) with CSV export |
| **Receivables & Payables Aging** | Current, 31-60, 61-90, 90+ day buckets |
| **Party Statement** | Full ledger per party, printable with CSV export |
| **Stock Summary** | Current stock levels with value calculation |
| **Cash Flow Forecast** | Projected inflows/outflows based on due dates |
| **Collection Efficiency** | Payment collection metrics and trends |

### Online Store

- Public storefront at `store.hisaabo.in/your-slug`
- Phone verification for customer orders
- WhatsApp order update notifications
- Custom shipping methods (in addition to built-in: self pickup, courier, transport)
- Configurable minimum order amount and delivery notes

### Team & Roles

| Role | Access |
|---|---|
| **Superadmin** | Full access + billing and tenant management |
| **Admin** | Full business access (invoices, payments, reports, settings) |
| **Seller Manager** | Sales + team oversight (no financial reports or settings) |
| **Seller** | Create invoices and quotations only |
| **Accountant** | Financial reports, payments, expenses (no invoice creation) |

Multi-business support: switch between businesses from the sidebar. Invitation system with plan-based limits.

---

## AI & Automation

**The only Indian invoicing platform with native AI agent support.**

Hisaabo is API-first. The web dashboard, mobile app, desktop app, CLI, and MCP server all use the same 130+ tRPC endpoints. Everything a human can do in the UI, an AI agent can do via API.

### MCP Server — Works with Claude Desktop today

The `@hisaabo/mcp` package exposes your entire business as tools, resources, and prompt templates to any MCP-compatible AI agent. 130+ operations, 14 business domains.

```
You: "How much does Montu Arora owe me?"
Claude: "Montu Arora has Rs. 12,450 outstanding across 3 invoices.
         The oldest is INV-12890 from 15 days ago. Should I draft a reminder?"

You: "Create an invoice for Gupta Enterprises — 20 bags of rice at Rs. 1,250"
Claude: "Done. Invoice BB-14821 created — Rs. 26,250 total (inc. 5% GST). PDF ready."

You: "Run my GST filing prep for March 2026"
Claude: "GSTR-1 data ready. 47 B2B invoices, 12 B2C. Total taxable: Rs. 8,43,200.
         2 invoices have missing HSN codes. Shall I list them?"
```

**Built-in prompt templates:**

| Prompt | What it does |
|---|---|
| `morning_briefing` | Daily summary: sales, cash position, overdue invoices, action items |
| `party_deep_dive` | Full analysis of any customer or supplier |
| `gst_filing_prep` | GSTR-1 and GSTR-3B data with cross-checks |
| `collection_follow_up` | Prioritized overdue list with suggested actions |
| `inventory_health` | Low stock, dead stock, fast movers |
| `month_close` | Month-end checklist: reconcile sales, expenses, balances |

Add to Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hisaabo": {
      "command": "npx",
      "args": ["@hisaabo/mcp"],
      "env": {
        "HISAABO_API_URL": "https://your-hisaabo-instance.com",
        "HISAABO_API_KEY": "sess_...",
        "HISAABO_TENANT_ID": "tenant-uuid",
        "HISAABO_BUSINESS_ID": "business-uuid"
      }
    }
  }
}
```

### CLI Tool — Script everything

```bash
npm install -g @hisaabo/cli
hisaabo login --api-url https://your-hisaabo-instance.com

# Morning business brief
hisaabo dashboard --json | jq '{revenue, outstanding, overdueCount}'

# This month's invoices as a CSV
hisaabo invoice list --this-month --format csv > invoices.csv

# GSTR-3B numbers for Q4 filing
hisaabo gst r3b --quarter Q4 --json | jq '.taxPayable'

# Mark all draft invoices as sent
hisaabo invoice list --status draft --format ids | xargs -I{} hisaabo invoice status {} sent

# Party outstanding report
hisaabo party list --outstanding --format csv > outstanding.csv
```

14 command groups: `invoice`, `party`, `item`, `payment`, `expense`, `bank`, `gst`, `report`, `shipment`, `target`, `store`, `import`, `dashboard`, `business`.

Every command supports `--json`, `--format csv`, and `--format ids` for piping.

### Build on Top

- **WhatsApp Bot** — Create invoices from voice notes via Claude + MCP
- **Slack/Teams** — Daily business summary in your team channel
- **Google Sheets** — Nightly sync of invoices, payments, and stock levels
- **Tally** — Export parties and invoices as Tally-compatible data
- **Custom Agents** — Deploy customer service agents for your online store

---

## Production Quality

Hisaabo is not a side project. It is production-hardened financial software.

| Dimension | What's in place |
|---|---|
| **Testing** | 1,586 automated tests (unit + integration against real PostgreSQL) |
| **Logging** | Structured JSON logging (pino) with request-ID correlation across the full request lifecycle |
| **Security** | CSRF protection, rate limiting (general + PDF-specific), session cookies with HttpOnly/Secure/SameSite=Lax, Argon2id password hashing |
| **Data Integrity** | All money as NUMERIC(15,2), `FOR UPDATE` row locking on payment allocation, PostgreSQL NUMERIC arithmetic for stock (no JS floats) |
| **Concurrency** | Semaphore-based PDF worker pool, atomic invoice number generation, bank balance updates inside transactions |
| **Performance** | Partial indexes on soft-delete columns, composite indexes for dashboard aggregates, session cache with 60s TTL |
| **Observability** | Crash handlers (unhandledRejection + uncaughtException), request tracing, audit logging for all write operations |
| **Deployment** | Docker with health checks, migration-failure-safe entrypoint, env validation at startup |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Client Layer                           │
│                                                               │
│  apps/web            apps/mobile        apps/store            │
│  React 19 + Vite     Expo SDK 55        React 19 + Vite      │
│  TanStack Router     Expo Router        (public storefront)   │
│                                                               │
│  apps/desktop                                                 │
│  Tauri v2 (wraps web)                                         │
└───────────────────────────┬──────────────────────────────────┘
                            │ tRPC (typed) + REST (store)
┌───────────────────────────▼──────────────────────────────────┐
│                       API Layer                               │
│                                                               │
│  packages/api                                                 │
│  Hono + tRPC v11 · 14 routers · 130+ procedures              │
│  pino logging · CSRF · Rate limiting · Audit log              │
└───────────────────────────┬──────────────────────────────────┘
                            │ Drizzle ORM
┌───────────────────────────▼──────────────────────────────────┐
│                     Database Layer                             │
│                                                               │
│  packages/db                                                  │
│  PostgreSQL 16 · NUMERIC(15,2) for money                      │
│  Control DB (auth, tenants) + Tenant DB (business data)       │
│  Partial indexes · FOR UPDATE locking                         │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    Shared Layer                                │
│  packages/shared                                              │
│  Zod validators · TypeScript types · Fixed-point money module │
│  Invoice calculation · Used by API + web + mobile             │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                  CLI & AI Agents                              │
│                                                               │
│  packages/cli    Terminal CLI (@hisaabo/cli on npm)           │
│  packages/mcp    MCP server for Claude, AI agents             │
│  Both call the API with x-business-id header                 │
└──────────────────────────────────────────────────────────────┘
```

**Tech stack:**

[![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![tRPC](https://img.shields.io/badge/tRPC-2596BE?logo=trpc&logoColor=white)](https://trpc.io/)
[![Drizzle](https://img.shields.io/badge/Drizzle_ORM-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![Expo](https://img.shields.io/badge/Expo-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![Tauri](https://img.shields.io/badge/Tauri-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Turborepo](https://img.shields.io/badge/Turborepo-EF4444?logo=turborepo&logoColor=white)](https://turbo.build/)

---

## Quick Start

Three paths depending on what you want to do.

### 1. Self-host and own your data

**Prerequisites:** Node.js 20+, pnpm 9+, Docker

```bash
git clone https://github.com/hisaabo/hisaabo.git
cd hisaabo
pnpm install

# Start PostgreSQL
docker compose up -d

# Configure environment (defaults work for local dev)
cp .env.example .env

# Push the database schema
pnpm db:push

# Start everything
pnpm dev
```

| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:3000 |
| Online store | http://localhost:5174 |

Create an account on first visit. The setup wizard creates your first business.

### 2. Try the API immediately

```bash
# Register an account on Hisaabo Cloud
curl -X POST https://api.hisaabo.in/api/trpc/auth.register \
  -H "Content-Type: application/json" \
  -d '{"json":{"email":"you@yourshop.in","name":"Your Name","password":"strongpass123","confirmPassword":"strongpass123"}}'
```

### 3. Connect AI to your Hisaabo instance

```bash
npm install -g @hisaabo/cli
hisaabo login --api-url https://your-hisaabo-instance.com
hisaabo whoami --json  # Copy token, tenantId, businessId
```

Then add to `claude_desktop_config.json` — see the [MCP Server guide](https://docs.hisaabo.in/ai/mcp-server/).

---

## Project Structure

```
hisaabo/
├── apps/
│   ├── web/          # React 19 admin dashboard
│   ├── mobile/       # Expo SDK 55 iOS + Android app
│   ├── store/        # Public customer-facing online storefront
│   ├── desktop/      # Tauri v2 desktop (macOS, Windows, Linux)
│   ├── docs/         # Starlight (Astro) documentation site
│   └── api-docs/     # API reference site
├── packages/
│   ├── api/          # Hono + tRPC server (14 routers, 130+ procedures)
│   ├── db/           # Drizzle ORM schema + PostgreSQL client
│   ├── shared/       # Zod validators, TypeScript types, money module
│   ├── cli/          # Terminal CLI (@hisaabo/cli on npm)
│   └── mcp/          # MCP server for AI agents (@hisaabo/mcp on npm)
├── docs/             # Architecture docs, research, roadmaps
├── nginx/            # Production nginx configuration
├── docker-compose.yml        # Local development
├── docker-compose.prod.yml   # Production deployment
├── Dockerfile                # API container image
└── Dockerfile.once           # All-in-one (PostgreSQL + API)
```

---

## Development

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | >= 20 | [nodejs.org](https://nodejs.org/) |
| pnpm | >= 9 | `npm install -g pnpm` |
| Docker | any | [docker.com](https://www.docker.com/) |
| Rust + Cargo | stable | Required only for desktop builds |

### Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start all dev servers (API + web + store) |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint all packages (oxlint) |
| `pnpm db:push` | Push schema changes to DB (dev) |
| `pnpm db:reset` | Drop all tables and repush schema |
| `pnpm db:generate` | Generate Drizzle migration files (production) |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm db:studio` | Open Drizzle Studio |

### Run a single package

```bash
pnpm --filter @hisaabo/api dev      # API server only
pnpm --filter @hisaabo/web dev      # Web app only
pnpm --filter @hisaabo/mobile dev   # Mobile (Expo Go)
pnpm --filter @hisaabo/store dev    # Online store only
```

### Testing

```bash
# Run all tests (1,586 tests)
pnpm --filter @hisaabo/api test

# Watch mode during development
pnpm --filter @hisaabo/api test:watch
```

### Mobile on WSL + Windows

```bash
# In WSL terminal — auto-sets EXPO_PUBLIC_API_URL to your WSL IP
pnpm dev:mobile:android
```

---

## Deployment

### Docker Compose (production)

```bash
cp .env.example .env  # Edit with production values
docker compose -f docker-compose.prod.yml up -d
```

### ONCE (all-in-one container)

PostgreSQL 16 + Node API in a single container with s6-overlay:

```bash
docker build -f Dockerfile.once -t hisaabo-once .
docker run -v /data/hisaabo:/storage -p 80:80 hisaabo-once
```

### Cloudflare Pages (frontends)

| App | Build command | Output directory |
|---|---|---|
| Web | `pnpm --filter @hisaabo/web build` | `apps/web/dist` |
| Store | `pnpm --filter @hisaabo/store build` | `apps/store/dist` |

Set `VITE_API_URL` in Cloudflare Pages environment variables.

### Desktop & Mobile

```bash
# Desktop (Tauri)
cd apps/desktop && cargo tauri build

# Android APK
pnpm --filter @hisaabo/mobile build:apk
```

Full production guide: [docs.hisaabo.in/self-hosting](https://docs.hisaabo.in/getting-started/self-hosting)

---

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://hisaabo:pass@localhost:5432/hisaabo` |
| `PORT` | API server port | `3000` |
| `CORS_ORIGINS` | Allowed origins (comma-separated) | `https://app.hisaabo.in` |
| `APP_URL` | Frontend URL (for magic link emails) | `https://app.hisaabo.in` |
| `NODE_ENV` | Environment | `production` |
| `RESEND_API_KEY` | Email sending (optional in dev) | |
| `MULTI_TENANT` | Enable multi-tenant cloud mode | `false` |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) | `info` |

---

## Roadmap

### Now Building
- HSN code validation against official master
- GSTR-1 JSON export for GST portal upload
- Tally XML export (full voucher format)
- Trial Balance and Balance Sheet reports
- Bank statement import (CSV) with auto-matching

### Coming Next
- E-Invoicing (IRP integration for IRN + QR)
- E-Way Bill generation
- ITC tracking and GSTR-2B reconciliation
- Invoice OCR (photograph a purchase bill, auto-fill fields)
- Chart of Accounts with journal entries

### Future
- Account Aggregator integration for bank feeds
- Direct GST filing via GSP
- TDS management
- Multi-currency support

See [docs/architecture/gst-accounting-roadmap.md](docs/architecture/gst-accounting-roadmap.md) for the full roadmap.

---

## Documentation

| Resource | URL |
|---|---|
| User documentation | [docs.hisaabo.in](https://docs.hisaabo.in) |
| API reference | [api.hisaabo.in](https://api.hisaabo.in) |
| Self-hosting guide | [docs.hisaabo.in/getting-started/self-hosting](https://docs.hisaabo.in/getting-started/self-hosting) |
| Contributing guide | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Security policy | [SECURITY.md](SECURITY.md) |

---

## Contributing

Contributions are welcome. Before opening a PR:

```bash
pnpm typecheck   # Must pass
pnpm lint        # Must pass (oxlint --deny-warnings)
pnpm build       # Must pass
pnpm --filter @hisaabo/api test  # 1,586 tests must pass
```

Key guidelines:
- Use the `money` module from `packages/shared` for all monetary arithmetic
- All input validation in `packages/shared/src/validators.ts` as Zod schemas
- No component libraries — pure Tailwind CSS
- New features ship with tests and a `feature-parity.yaml` update

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

---

## Compared to Alternatives

| | Hisaabo | Tally Prime | Zoho Books | myBillBook | Vyapar |
|---|---|---|---|---|---|
| **Price** | Free | Rs. 18K-54K | Rs. 749-2,499/mo | Rs. 2,999-9,999/yr | Rs. 2,499-7,999/yr |
| **Open source** | Yes | No | No | No | No |
| **Self-hostable** | Yes | Desktop only | No | No | No |
| **GST reports** | GSTR-1, 3B | GSTR-1, 3B, 9 | GSTR-1, 3B, 9 | Basic | Basic |
| **Mobile app** | Yes | No | Yes | Yes (primary) | Yes (primary) |
| **AI/API access** | MCP + CLI + API | XML API | REST API | No | No |
| **Payment gateway** | Full (charges + settlement + reversal) | No | Basic | No | No |
| **Online store** | Built-in | No | No | Basic | Basic |
| **Multi-tenant SaaS** | Yes | No | Yes | Cloud only | Cloud only |
| **Tally export** | Yes | N/A | Partial | Yes | No |
| **P&L / Balance Sheet** | Yes | Yes | Yes | No | No |
| **Bank reconciliation** | Coming | Yes | Yes | No | No |
| **E-invoicing** | Coming | Yes | Yes | No | No |

---

## License

[O'Saasy License (v1.0)](LICENSE) — Free to use, self-host, and modify. You cannot offer Hisaabo as a competing hosted service.

---

Built with care in India. *Hisaab, pakka.*
