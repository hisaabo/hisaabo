# Hisaabo

> The first agent-native financial operating system for India.

[![CI](https://github.com/hisaabo/hisaabo/actions/workflows/ci.yml/badge.svg)](https://github.com/hisaabo/hisaabo/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/hisaabo/hisaabo/graph/badge.svg)](https://codecov.io/gh/hisaabo/hisaabo)
[![Release](https://img.shields.io/github/v/release/hisaabo/hisaabo?include_prereleases&label=release)](https://github.com/hisaabo/hisaabo/releases)
[![License: O'Saasy](https://img.shields.io/badge/license-O'Saasy-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1809_passing-brightgreen)]()
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

Hisaabo is not accounting software with an AI add-on. It is a financial operating system where humans and AI agents operate on the same structured primitives -- creating invoices, reconciling bank statements, filing GST returns, closing books. The web dashboard, mobile app, CLI, and MCP server are all equal clients of the same API. There is no "AI layer." The entire system is the AI interface.

Open source. Self-hostable. Free forever. Built India-first.

---

## What is Hisaabo?

Every accounting tool built in the last 30 years follows the same pattern: a database, a forms-based UI, and maybe an API bolted on later. AI gets added as a chat widget that reads from the same database humans already see.

Hisaabo inverts this. The system is built as a set of structured financial operations -- 200+ typed tRPC endpoints -- that any client can execute. The React dashboard is one client. The Expo mobile app is another. The CLI is another. An MCP-connected AI agent is another. They all have identical capabilities, identical permissions, identical audit trails.

This means an AI agent does not "read your screen" or "fill in forms." It calls the same `invoice.create` procedure your accountant does, with the same validation, the same GST logic, the same atomic invoice numbering. The result is deterministic, auditable, and indistinguishable from human input.

That is what makes this a financial operating system, not an accounting app.

---

## Financial Actions

Hisaabo does not expose spreadsheets and forms. It exposes structured financial operations.

| Action | What happens |
|---|---|
| **Record a GST-compliant sale** | Tax determination (CGST+SGST or IGST) from state codes, HSN validation against 19K codes, atomic invoice numbering, PDF with QR, optional e-invoice IRN via NIC IRP |
| **Reconcile a bank statement** | Auto-detect format across 10 Indian banks, 4-tier matching (exact, strong, narration parse, partial), auto-categorization rules, BRS generation |
| **Generate filing-ready GST returns** | GSTR-1 (B2B, B2C Large, B2C Small, HSN summary, CDN), GSTR-3B (outward, ITC, RCM, net payable), GSTR-9 annual, GSTR-2B reconciliation |
| **Close a financial period** | Journal entries for depreciation, provisions, bad debt write-offs, opening balances. Trial Balance, P&L, Balance Sheet, Cash Flow derived automatically. |
| **Track ITC compliance** | Auto-creation from purchase invoices, 180-day aging alerts (Section 16(4)), blocked ITC under 17(5), utilization in prescribed order (IGST > CGST > SGST) |
| **Manage parties and receivables** | GSTIN validation (regex + checksum), per-party ledger, aging buckets (Current, 31-60, 61-90, 90+), credit period and limit tracking |
| **Run bank operations** | 9 payment modes, multi-invoice allocation, inter-account transfers with atomic dual-entry, payment gateway integration with charge/settlement/reversal traceability |

Every action is: deterministic (same input, same output), auditable (traced to a user or agent), and executable identically by a human clicking a button or an AI agent calling an endpoint.

This is the design constraint that makes everything else possible.

---

## Agent-Native Architecture

This is not "AI-powered accounting." This is accounting infrastructure that AI agents operate natively.

**How it works:**

The entire Hisaabo API is a set of typed, validated procedures. Every capability -- from creating an invoice to generating GSTR-3B -- is a structured tool with defined inputs, outputs, and side effects. There is no screen-scraping, no form-filling, no prompt-engineering around a UI.

```
                 +------------------+
                 |   tRPC API       |
                 |   200+ typed     |
                 |   procedures     |
                 +--------+---------+
                          |
          +------+--------+--------+--------+
          |      |        |        |        |
        Web    Mobile   Desktop   CLI     MCP
       React   Expo     Tauri    npm     Claude
```

All five clients call the same procedures, with the same `x-business-id` header, the same role-based permissions, the same audit logging. An invoice created by Claude Desktop through MCP is byte-for-byte identical to one created through the web dashboard.

**What this enables today:**

```
You: "How much does Montu Arora owe me?"
Claude: "Montu Arora has Rs. 12,450 outstanding across 3 invoices.
         The oldest is INV-12890 from 15 days ago. Should I draft a reminder?"

You: "Create an invoice for Gupta Enterprises -- 20 bags of rice at Rs. 1,250"
Claude: "Done. Invoice BB-14821 created -- Rs. 26,250 total (inc. 5% GST). PDF ready."

You: "Run my GST filing prep for March 2026"
Claude: "GSTR-1 data ready. 47 B2B invoices, 12 B2C. Total taxable: Rs. 8,43,200.
         2 invoices have missing HSN codes. Shall I list them?"
```

**What this enables tomorrow:**

- A WhatsApp bot that creates invoices from voice notes via Claude + MCP
- A Slack integration that posts daily business summaries to your team channel
- A customer service agent that answers "where is my order?" from live data
- A tax filing assistant that prepares GSTR-1 and flags anomalies before your CA reviews
- An audit preparation bot that generates schedules and reconciliations

None of these require new API development. The surface area already exists. Every agent is a new client of the same financial primitives.

**MCP Server**

The `@hisaabo/mcp` package exposes your entire business as tools, resources, and prompt templates to any MCP-compatible AI agent.

Built-in prompt templates:

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

**CLI**

```bash
npm install -g @hisaabo/cli
hisaabo login --api-url https://your-hisaabo-instance.com

hisaabo dashboard --json | jq '{revenue, outstanding, overdueCount}'
hisaabo invoice list --this-month --format csv > invoices.csv
hisaabo gst r3b --quarter Q4 --json | jq '.taxPayable'
hisaabo bank recon --account "HDFC Current" --format csv > brs.csv
```

14 command groups. Every command supports `--json`, `--format csv`, and `--format ids` for piping.

---

## Controlled Financial Access

The adoption wedge for Hisaabo is not features. It is trust.

Right now, Indian businesses share bank passwords over WhatsApp so their CA can download statements. Articled clerks have unscoped access to every client's data. There is no audit trail for who changed what. This is the status quo for millions of businesses.

Hisaabo replaces this with structured access control:

| Layer | What it enforces |
|---|---|
| **5 roles** | Superadmin, Admin, Seller Manager, Seller, Accountant -- each with scoped permissions per resource and action |
| **Business isolation** | Every API query scoped by `x-business-id`. Impossible to access another client's data by accident or intent. |
| **No credential sharing** | Clients upload their own statements or create their own invoices. CAs access via their own role-based login. |
| **Full audit trail** | Every write operation logged with user, timestamp, and before/after state. Every invoice, payment, and journal entry traceable to a specific person. |
| **Session security** | HttpOnly + Secure + SameSite=Lax cookies. Argon2id password hashing. 30-day expiry. No JWTs. |
| **Team invitations** | Add articled clerks, managers, or clients with plan-based limits. Revoke access instantly. |

This is what gets CAs to adopt. Not a better spreadsheet -- a system where access is controlled, actions are auditable, and no one needs to share a bank password ever again.

---

## Why Hisaabo?

### If you run a CA firm

You manage 30-100 clients. Each one sends you bank statements in a different format. You chase GST data over WhatsApp the week before filing. Some clients share their net banking credentials in plain text messages. Your articled clerks spend 80% of their time on data entry that should not exist.

Hisaabo gives you a single platform where every client is a separate business with role-based access. You log in once and see all your clients. Bank statements import with auto-detection for 10 Indian banks. GSTR-1 and GSTR-3B auto-generate from invoice data. Trial Balance, P&L, and Balance Sheet derive automatically. When you need depreciation entries or year-end adjustments, journal entries are there. When you need to hand off to Tally for audit, there is a clean XML export.

### If you run a business

**If you use a paper bahi khata** -- you are one lost register away from losing years of records. Hisaabo digitises your entire operation in an afternoon, runs on your phone, and costs nothing.

**If you use Tally** -- you paid Rs. 18,000-54,000 for a license that only works on Windows, on one machine, with no mobile app. Hisaabo runs on any device with a browser, and your CA can access it from their own office.

**If you use myBillBook or Vyapar** -- you started with a "free" plan that paywalls essential features behind Rs. 3,000-10,000/year. Your data lives on their servers. If you stop paying, you lose access to your own records. Hisaabo has no feature gates.

**If you use Zoho Books** -- you are paying a monthly SaaS subscription designed for companies ten times your size. Hisaabo is built India-first: GST logic is foundational, not bolted on.

---

## Features

### Invoicing and Documents

GST-compliant sale and purchase invoices with automatic CGST/SGST/IGST split, PDF generation (A4/A5/thermal), and UPI QR code. Quotations and proformas convert to invoices with one click. Delivery challans with e-way bill linkage and stock-safe invoice conversion. Credit notes, debit notes, sales returns, and purchase returns with separate numbering sequences and automatic stock adjustment.

### Accounting

Full double-entry accounting derived automatically from business transactions. Chart of Accounts seeded with 40 standard Indian accounts on business creation. Trial Balance, Balance Sheet, Profit and Loss, Cash Flow Statement (indirect method), General Ledger, Daybook, and comparative FY-vs-FY reports with variance analysis. Journal entries for CA adjustments: depreciation, provisions, bad debt write-offs, opening balances. Tally XML export for clean import into Tally Prime.

### GST Compliance

GSTR-1/3B/9 generation, GSTR-2B reconciliation, e-invoicing (NIC IRP with IRN and QR), e-way bill (auto-generate for goods over Rs. 50,000), ITC tracking with 180-day aging and blocked ITC, HSN validation against 19K official codes, composition scheme with CMP-08, reverse charge mechanism, automatic tax determination from state codes. Complete.

### Bank Reconciliation

CSV import with pre-built templates for SBI, HDFC, ICICI, Axis, Kotak, PNB, BOB, Union, IDBI, and IndusInd. Auto-detection of bank format from headers. 4-tier matching: exact (amount + date + reference), strong (amount + 2-day window), narration parsing (UPI ID, cheque number), partial (amount only, 7-day window). Auto-categorization rules. Template versioning for format changes. BRS with matched, unmatched, and timing difference totals.

### Parties, Items, and Payments

Customer and supplier management with GSTIN validation, per-party ledger, aging buckets, credit period and limit tracking. Real-time stock with low-stock alerts, unit conversion, item variants, HSN/SAC autocomplete, online store pricing. 9 payment modes, multi-invoice allocation, inter-account transfers, payment gateway integration with full charge/settlement/reversal traceability.

### Reports

Trial Balance, Balance Sheet, P&L, Cash Flow, General Ledger, Daybook, Sales and Purchase Register (by tax rate), Receivables and Payables Aging, Party Statement, Stock Summary, Cash Flow Forecast, Collection Efficiency, Bank Reconciliation Statement, GSTR-1/3B/9. All exportable as CSV.

### Online Store

Public storefront at `store.hisaabo.in/your-slug`. Phone verification for orders. WhatsApp notifications. Custom shipping methods. Configurable minimum order amount.

---

## For CA Firms

### How Hisaabo works for your practice

**Onboarding a new client (30 minutes)**

1. Add the client as a new business in your Hisaabo instance
2. Configure their GST registration (regular, composition, or unregistered), financial year, and state
3. Chart of Accounts seeds automatically with 40 standard Indian accounts
4. Invite the client with Seller or Admin access -- they can create invoices from their phone
5. Import opening balances via journal entries if migrating mid-year

**Monthly workflow**

1. Client creates invoices and records payments through the app or their phone
2. You import their bank statement CSV -- Hisaabo auto-detects the bank and matches 70%+ of transactions
3. Review unmatched items: create expenses, flag timing differences, or match manually
4. GSTR-1 auto-generates from invoice data -- review, export JSON, upload to portal
5. GSTR-3B auto-calculates outward supplies, ITC, and net tax payable
6. Trial Balance and P&L are always current -- no "closing the books" step

**Year-end**

1. Post depreciation, provisions, and adjustments via journal entries
2. Generate Balance Sheet and P&L for the full financial year
3. Run comparative FY vs FY reports for the client review
4. Export GSTR-9 annual return data
5. Export Tally XML for statutory audit -- imports cleanly into Tally Prime

**What changes for your practice**

| Before Hisaabo | After Hisaabo |
|---|---|
| Clients share bank passwords over WhatsApp | Clients upload statements themselves, or you import CSV directly |
| Articled clerks type bank entries into Tally manually | 4-tier auto-matching handles 70%+ of entries |
| Chase GST data the week before filing | GSTR-1 and GSTR-3B auto-generate from live invoice data |
| P&L and Balance Sheet only at year-end | Financial statements current at all times |
| Each client on a different system (Tally, Excel, paper) | All clients on one platform with a single login |
| No audit trail for changes | Every write operation logged with user, timestamp, and state |

---

## Gets Smarter With Every Firm

Hisaabo is not a static tool. It is a system that compounds.

**Transaction patterns improve auto-categorization.** When a CA categorizes "NEFT-SALARY" as a salary expense for one business, that rule applies across similar transactions. Every manual categorization trains the matching engine.

**GST classifications validate across businesses.** HSN codes confirmed for one business help validate classifications for others in the same industry. A textile trader's HSN mappings benefit the next textile trader onboarded.

**Bank reconciliation accuracy compounds.** As more bank statements flow through the system, narration parsing patterns improve. New UPI formats, changed NEFT descriptions, updated bank CSV layouts -- each resolved case makes the next one faster.

**This is a data moat, not a feature.** Every firm on the platform makes the platform better for every other firm. A new entrant building accounting software from scratch starts at zero. Hisaabo starts with the accumulated intelligence of every transaction ever reconciled.

---

## Production Quality

Hisaabo is not a side project. It is production-hardened financial software.

| Dimension | What is in place |
|---|---|
| **Testing** | 1,809 automated tests (unit + integration against real PostgreSQL) |
| **Logging** | Structured JSON logging (pino) with request-ID correlation across the full request lifecycle |
| **Security** | CSRF protection, rate limiting (general + PDF-specific), session cookies with HttpOnly/Secure/SameSite=Lax, Argon2id password hashing |
| **Data Integrity** | All money as NUMERIC(15,2), `FOR UPDATE` row locking on payment allocation, PostgreSQL NUMERIC arithmetic for stock (no JS floats) |
| **Concurrency** | Semaphore-based PDF worker pool, atomic invoice number generation, bank balance updates inside transactions |
| **Performance** | Partial indexes on soft-delete columns, composite indexes for dashboard aggregates, session cache with 60s TTL |
| **Observability** | Crash handlers (unhandledRejection + uncaughtException), request tracing, audit logging for all write operations |
| **Deployment** | Docker with health checks, migration-failure-safe entrypoint, env validation at startup |

---

## Compared to Alternatives

| | Hisaabo | Tally Prime | Zoho Books | myBillBook | Vyapar |
|---|---|---|---|---|---|
| **Price** | Free | Rs. 18K-54K | Rs. 749-2,499/mo | Rs. 2,999-9,999/yr | Rs. 2,499-7,999/yr |
| **Open source** | Yes | No | No | No | No |
| **Self-hostable** | Yes | Desktop only | No | No | No |
| **Full accounting (CoA, TB, BS, P&L, CF)** | Yes | Yes | Yes | No | No |
| **Journal entries** | Yes | Yes | Yes | No | No |
| **GST returns (1, 3B, 9, 2B recon)** | Yes | Yes | Yes | Basic | Basic |
| **E-Invoicing (IRP)** | Yes | Yes | Yes | No | No |
| **E-Way Bill** | Yes | Yes | Yes | No | No |
| **ITC tracking (aging + blocked + utilization)** | Yes | Yes | Yes | No | No |
| **Bank reconciliation (10 banks, auto-match)** | Yes | Yes | Yes | No | No |
| **Tally export** | Yes (XML, clean import) | N/A | Partial | Yes | No |
| **Mobile app** | Yes | No | Yes | Yes (primary) | Yes (primary) |
| **AI agent access (MCP + CLI)** | Yes | No | No | No | No |
| **Payment gateway (charges + settlement)** | Yes | No | Basic | No | No |
| **Online store** | Built-in | No | No | Basic | Basic |
| **Multi-tenant SaaS** | Yes | No | Yes | Cloud only | Cloud only |
| **Agent-native architecture** | Yes | No | No | No | No |

---

## Architecture

```
+--------------------------------------------------------------+
|                      Client Layer                            |
|                                                              |
|  apps/web            apps/mobile        apps/store           |
|  React 19 + Vite     Expo SDK 55        React 19 + Vite     |
|  TanStack Router     Expo Router        (public storefront)  |
|                                                              |
|  apps/desktop        packages/cli       packages/mcp         |
|  Tauri v2            Terminal CLI        MCP Server           |
|  (wraps web)         (@hisaabo/cli)     (Claude, AI agents)  |
+----------------------------+---------------------------------+
                             | tRPC (typed) + REST (store)
                             | x-business-id header
                             | Role-based permissions
+----------------------------v---------------------------------+
|                     API Layer                                |
|                                                              |
|  packages/api                                                |
|  Hono + tRPC v11 -- 20+ routers -- 200+ procedures          |
|  Three procedure levels:                                     |
|    publicProcedure / protectedProcedure / businessProcedure  |
|  pino logging -- CSRF -- Rate limiting -- Audit log          |
+----------------------------+---------------------------------+
                             | Drizzle ORM
+----------------------------v---------------------------------+
|                   Database Layer                             |
|                                                              |
|  packages/db                                                 |
|  PostgreSQL 16 -- NUMERIC(15,2) for money                    |
|  Control DB (auth, tenants) + Tenant DB (business data)      |
|  Partial indexes -- FOR UPDATE locking                       |
+--------------------------------------------------------------+

+--------------------------------------------------------------+
|                  Shared Layer                                 |
|  packages/shared                                             |
|  Zod validators -- TypeScript types -- Fixed-point money     |
|  Invoice calculation -- HSN master (19K codes)               |
|  Used by API + web + mobile + CLI + MCP                      |
+--------------------------------------------------------------+
```

All six clients (web, mobile, desktop, store, CLI, MCP) call the same API with the same typed contracts. There is no separate "AI API" or "bot API." The architecture enforces that every capability available to a human is available to an agent.

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

Create an account on first visit. The setup wizard creates your first business with a seeded Chart of Accounts.

### 2. Try the API immediately

```bash
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

Then add to `claude_desktop_config.json` -- see the [MCP Server guide](https://docs.hisaabo.in/ai/mcp-server/).

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
│   ├── api/          # Hono + tRPC server (20+ routers, 200+ procedures)
│   ├── db/           # Drizzle ORM schema + PostgreSQL client
│   ├── shared/       # Zod validators, TypeScript types, money module, HSN master
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
# Run all tests (1,809 tests)
pnpm --filter @hisaabo/api test

# Watch mode during development
pnpm --filter @hisaabo/api test:watch
```

### Mobile on WSL + Windows

```bash
# In WSL terminal -- auto-sets EXPO_PUBLIC_API_URL to your WSL IP
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

### Desktop and Mobile

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

### Delivered (April 2026)

Everything listed in Features above is shipped and tested. The full accounting layer, GST compliance suite, bank reconciliation engine, and agent-native architecture were built in Q4 FY26.

### Coming Next

- **PDF invoice OCR** -- Photograph a purchase bill, auto-extract line items, HSN codes, and amounts
- **Account Aggregator integration** -- Consent-based automatic bank data pull (replacing CSV import)
- **TDS management** -- TDS deduction tracking, Form 26AS reconciliation

### Future

- **Direct GST filing via GSP** -- File GSTR-1 and GSTR-3B directly from Hisaabo without the GST portal
- **Agent ecosystem** -- Third-party tax, audit, and compliance agents built on the MCP server
- **IMS integration** -- Invoice Management System support as it matures
- **Multi-currency support** -- For export-oriented businesses

See [docs/architecture/gst-accounting-roadmap.md](docs/architecture/gst-accounting-roadmap.md) for the full technical specification.

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
pnpm --filter @hisaabo/api test  # 1,809 tests must pass
```

Key guidelines:
- Use the `money` module from `packages/shared` for all monetary arithmetic
- All input validation in `packages/shared/src/validators.ts` as Zod schemas
- No component libraries -- pure Tailwind CSS
- New features ship with tests and a `feature-parity.yaml` update

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

---

## License

[O'Saasy License (v1.0)](LICENSE) -- Free to use, self-host, and modify. You cannot offer Hisaabo as a competing hosted service.

---

Built with care in India. *Hisaab, pakka.*
