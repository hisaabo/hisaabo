# Hisaabo

> The open-source accounting and compliance platform that CAs trust and Indian businesses love.

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

Your clients' bank passwords are on WhatsApp. Their books close two weeks late. GST filing is a monthly panic. Hisaabo fixes all three.

---

## Why Hisaabo?

### If you run a CA firm

You manage 30-100 clients. Each one sends you bank statements in a different format. You chase GST data over WhatsApp the week before filing. Some clients share their net banking credentials in plain text messages. Your articled clerks spend 80% of their time on data entry that should not exist.

Hisaabo gives you a single platform where every client is a separate business with role-based access. You log in once and see all your clients. Bank statements come in through CSV import with auto-detection for 10 Indian banks. GSTR-1 and GSTR-3B auto-generate from invoice data. Trial Balance, P&L, and Balance Sheet derive automatically from transactions. When you need depreciation entries or year-end adjustments, journal entries are there. When you need to hand off to Tally for audit, there is a clean XML export.

No more credential sharing. No more data re-entry. No more month-end panic.

### If you run a business

**If you use a paper bahi khata** -- you are one lost register away from losing years of business records. You cannot generate GST-compliant invoices, track outstanding payments across dozens of parties, or file GSTR-1 without manually copying numbers into a spreadsheet. Hisaabo digitises your entire operation in an afternoon, runs on your phone, and costs nothing.

**If you use Tally** -- you paid Rs. 18,000-54,000 for a license that only works on Windows, only runs on one machine, and has no mobile app. Hisaabo runs on any device with a browser, works on Android and iOS, and your CA can access it from their own office. The entire source code is open -- no vendor lock-in, no renewal anxiety.

**If you use myBillBook or Vyapar** -- you started with a "free" plan that paywalls essential features behind Rs. 3,000-10,000/year subscriptions. Your data lives on their servers, and if you stop paying, you lose access to your own business records. Hisaabo has no feature gates. Every capability is available from day one, and your data stays on your infrastructure.

**If you use Zoho Books** -- you are paying a monthly SaaS subscription designed for companies ten times your size, dealing with a complex interface, and hoping the pricing does not change next quarter. Hisaabo is built India-first: GST logic is foundational, not bolted on.

### What makes Hisaabo different

- **You own your data.** Self-host on a Rs. 500/month VPS, or use Hisaabo Cloud. Export everything, any time. No lock-in.
- **Rs. 0 forever.** No feature gates, no invoice limits, no "upgrade to unlock GST reports."
- **Full accounting stack.** Chart of Accounts, derived double-entry ledger, Trial Balance, Balance Sheet, P&L, Cash Flow Statement, General Ledger, journal entries for CA adjustments -- all derived automatically from the invoices and payments your business already records.
- **Complete GST compliance.** GSTR-1/3B/9 generation, GSTR-2B reconciliation, e-invoicing (NIC IRP), e-way bill, ITC tracking with 180-day aging, HSN validation against 19K official codes, composition scheme with CMP-08, reverse charge mechanism.
- **Bank reconciliation built for India.** CSV import with pre-built templates for SBI, HDFC, ICICI, Axis, Kotak, PNB, BOB, Union, IDBI, and IndusInd. Auto-detection of bank format. 4-tier matching algorithm. Auto-categorization rules.
- **AI-native.** The only Indian accounting platform with an MCP server and CLI. Connect Claude Desktop and run your bookkeeping in natural language.
- **Every platform, one codebase.** Web, Android, iOS, macOS, Windows, Linux, CLI, and a full API.
- **Production-hardened.** 1,809 tests. Structured logging. CSRF protection. Race-condition-safe payments. No floating-point errors on your balance sheet.

---

## Features

### 1. Secure Client Operations

| Feature | Detail |
|---|---|
| **Multi-business management** | Each client is a separate business. Switch from the sidebar. One login, all your clients. |
| **Role-based access** | Superadmin, Admin, Seller Manager, Seller, Accountant -- each with scoped permissions |
| **Audit logging** | Every write operation logged with user, timestamp, and before/after state |
| **No credential sharing** | Clients upload their own statements. CAs access via role-based login. No bank passwords on WhatsApp. |
| **Team invitations** | Add articled clerks, managers, or clients with plan-based limits |
| **Business isolation** | All API queries scoped by business ID. No cross-business data leakage. |

### 2. Bank Statement Ingestion and Reconciliation

| Feature | Detail |
|---|---|
| **10 Indian bank templates** | SBI, HDFC, ICICI, Axis, Kotak, PNB, BOB, Union, IDBI, IndusInd -- pre-built column mappings |
| **Auto-detection** | Upload a CSV and Hisaabo identifies the bank from headers. Falls back gracefully if the format changed. |
| **4-tier matching** | Exact match (amount + date + reference), strong match (amount + 2-day window), narration parsing (UPI ID, cheque number), partial match (amount only, date within 7 days) |
| **Bank mismatch warnings** | Detects when the CSV bank does not match the selected account bank |
| **Auto-categorization rules** | "If narration contains NEFT-SALARY then expense category Salary." User-created and system-suggested. |
| **Template versioning** | Banks change CSV formats. Hisaabo tracks revisions and degrades gracefully. |
| **Manual resolution** | Match manually, create expense from unmatched transactions, mark as timing differences |
| **BRS summary** | Bank Reconciliation Statement with matched, unmatched, and timing difference totals |

### 3. Accounting and Financial Reports

| Feature | Detail |
|---|---|
| **Chart of Accounts** | Indian CoA seeded on business creation (40 accounts across assets, liabilities, equity, income, expenses). Customizable. |
| **Derived ledger engine** | Invoices, payments, expenses, and bank transfers auto-map to double-entry without users seeing debits and credits |
| **Trial Balance** | Period-filtered, with opening + closing balances. Balances to zero. |
| **Balance Sheet** | Assets, liabilities, equity -- derived from live transaction data |
| **Profit and Loss** | Revenue, COGS, gross margin, expenses by category, net margin |
| **General Ledger** | Per-account transaction detail with running balance |
| **Cash Flow Statement** | Indirect method -- operating, investing, financing activities |
| **Comparative reports** | FY vs FY comparison for P&L, Balance Sheet, and Trial Balance with absolute and percentage variance |
| **Journal entries** | Create, update, void, templates. For CA adjustments: depreciation, bad debt write-offs, opening balances, provisions |
| **Tally XML export** | Ledger masters + vouchers (sales, purchase, receipt, payment, journal, contra). Clean import into Tally Prime. |

### 4. GST Compliance

| Feature | Detail |
|---|---|
| **HSN master validation** | 19,000+ official codes. Autocomplete on item creation. Turnover-based 4/6/8 digit enforcement. |
| **GSTR-1 export** | B2B invoices, B2C Large (inter-state > Rs. 2.5L), B2C Small, HSN summary, Credit/Debit notes. JSON + CSV for portal upload. |
| **GSTR-3B generation** | Outward supplies (taxable, zero-rated, exempt), ITC summary, reverse charge, net tax payable. Auto-populated from transaction data. |
| **GSTR-9 annual return** | 12-month aggregation across all return periods. Portal-compatible JSON export. |
| **GSTR-2B reconciliation** | Upload JSON/CSV from GST portal. Auto-match against purchase invoices. Mismatch detection with drill-down. |
| **E-Invoicing** | NIC IRP integration. IRN generation, QR code embedded in PDF invoices, cancel within 24 hours, sandbox mode for testing. |
| **E-Way Bill** | NIC API integration. Auto-generate for goods > Rs. 50,000. Vehicle number updates, transporter details, validity tracking. |
| **ITC tracking** | Auto-creation from purchase invoices. 180-day aging alerts (Section 16(4)). Blocked ITC under Section 17(5). Utilization in prescribed order (IGST > CGST > SGST). GSTR-3B Table 4 auto-population. |
| **Composition scheme** | CMP-08 quarterly return generation. Inter-state sales blocked. Tax rates locked to composition slab. |
| **Reverse Charge Mechanism** | Auto-suggest when supplier has no GSTIN. Populates GSTR-3B Table 3.1(d) and Table 4 separately. |
| **Tax determination** | Automatic CGST+SGST (intra-state) or IGST (inter-state) based on business and party state codes |
| **Invoice titling** | Auto-switches: "TAX INVOICE" (regular), "BILL OF SUPPLY" (composition), "INVOICE" (unregistered) |

### 5. Invoicing and Documents

| Document | What You Get |
|---|---|
| **Sale and Purchase Invoices** | GST-compliant with CGST/SGST/IGST auto-split, PDF generation (A4/A5/thermal), UPI QR code, e-invoice IRN + QR when enabled |
| **Quotations and Proformas** | Convert to invoice with one click, preserving all line items and terms |
| **Delivery Challans** | Shipment tracking, convert to invoice without double stock deduction, e-way bill linkage |
| **Credit and Debit Notes** | Separate numbering sequences (CN-00001, DN-00001), linked to original invoices |
| **Sales and Purchase Returns** | Stock auto-adjustment on creation, separate SR/PR number sequences |

Every document type gets its own prefix and number sequence (customizable).

### 6. Parties, Items, and Payments

**Parties and Ledger**

- Customer and supplier management with GSTIN validation (regex + checksum)
- Per-party chronological ledger with debit/credit entries and running balance
- Outstanding and overdue tracking with aging buckets (Current, 31-60, 61-90, 90+ days)
- Opening balance support, credit period and credit limit tracking

**Items and Inventory**

- Real-time stock tracking with low-stock alerts
- Unit conversion: sell in kg, track in g (configurable conversion factors)
- Item variants: Size, Color, etc. with per-variant stock and pricing
- Tax-inclusive and tax-exclusive pricing modes
- HSN/SAC codes with autocomplete from 19K master, categories, SKU codes
- Online store pricing separate from wholesale pricing

**Payments and Banking**

- 9 payment modes: Cash, UPI, Bank Transfer, Cheque, Credit Card, Debit Card, Net Banking, Wallet, Other
- Multi-invoice allocation: one payment split across multiple invoices
- Bank account management: Savings, Current, Cash, UPI, Credit Card, Payment Gateway
- Inter-account transfers with atomic dual-entry balance tracking
- Payment gateway integration with full money-flow traceability: transaction ID recording, auto-expense for gateway charges (CC/DC/UPI/NB rates configurable per gateway), auto-settlement into linked bank account, automatic reversal of charges and settlements
- Running balance per account with full transaction history

### 7. Reports

| Report | Description |
|---|---|
| **Trial Balance** | Period-filtered, opening + closing balances, derived from all transactions |
| **Balance Sheet** | Assets, liabilities, equity -- live from transaction data |
| **Profit and Loss** | Multi-level: revenue, COGS, gross margin, expenses by category, net margin |
| **Cash Flow Statement** | Indirect method with operating, investing, and financing activities |
| **General Ledger** | Per-account transaction detail with running balance |
| **Comparative FY vs FY** | P&L, Balance Sheet, and Trial Balance with absolute and percentage variance |
| **Daybook** | Chronological register of all transactions with debit/credit columns |
| **Sales and Purchase Register** | Tax breakdown by rate (5%, 12%, 18%, 28%) with CSV export |
| **Receivables and Payables Aging** | Current, 31-60, 61-90, 90+ day buckets |
| **Party Statement** | Full ledger per party, printable with CSV export |
| **Stock Summary** | Current stock levels with value calculation |
| **Cash Flow Forecast** | Projected inflows/outflows based on due dates |
| **Collection Efficiency** | Payment collection metrics and trends |
| **Bank Reconciliation Statement** | Matched, unmatched, timing differences -- against imported bank statements |
| **GSTR-1 / GSTR-3B / GSTR-9** | GST returns auto-generated from transaction data |

### 8. Online Store

- Public storefront at `store.hisaabo.in/your-slug`
- Phone verification for customer orders
- WhatsApp order update notifications
- Custom shipping methods (in addition to built-in: self pickup, courier, transport)
- Configurable minimum order amount and delivery notes

### 9. AI and Automation

**The only Indian accounting platform with native AI agent support.**

Hisaabo is API-first. The web dashboard, mobile app, desktop app, CLI, and MCP server all use the same tRPC endpoints. Everything a human can do in the UI, an AI agent can do via API.

**MCP Server -- Works with Claude Desktop today**

The `@hisaabo/mcp` package exposes your entire business as tools, resources, and prompt templates to any MCP-compatible AI agent.

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

**CLI Tool -- Script everything**

```bash
npm install -g @hisaabo/cli
hisaabo login --api-url https://your-hisaabo-instance.com

# Morning business brief
hisaabo dashboard --json | jq '{revenue, outstanding, overdueCount}'

# This month's invoices as a CSV
hisaabo invoice list --this-month --format csv > invoices.csv

# GSTR-3B numbers for Q4 filing
hisaabo gst r3b --quarter Q4 --json | jq '.taxPayable'

# Bank reconciliation summary
hisaabo bank recon --account "HDFC Current" --format csv > brs.csv

# Party outstanding report
hisaabo party list --outstanding --format csv > outstanding.csv
```

14 command groups: `invoice`, `party`, `item`, `payment`, `expense`, `bank`, `gst`, `report`, `shipment`, `target`, `store`, `import`, `dashboard`, `business`.

Every command supports `--json`, `--format csv`, and `--format ids` for piping.

**Build on Top**

- **WhatsApp Bot** -- Create invoices from voice notes via Claude + MCP
- **Slack/Teams** -- Daily business summary in your team channel
- **Google Sheets** -- Nightly sync of invoices, payments, and stock levels
- **Tally** -- Export full voucher XML for clean Tally Prime import
- **Custom Agents** -- Deploy customer service agents, tax filing assistants, audit preparation bots

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

**Security model**

- No shared credentials. Each user has their own login with role-based permissions.
- Session cookies with HttpOnly, Secure, and SameSite=Lax. Argon2id password hashing.
- All API queries scoped by business ID. Impossible to access another client's data by accident or intent.
- Full audit log. Every invoice created, payment recorded, and journal entry posted is traceable to a user.

**Better with every firm**

As more businesses run through Hisaabo, the platform gets smarter. Transaction narration patterns improve auto-categorization accuracy. HSN classifications from one business help validate another. GST matching algorithms learn from confirmed reconciliations. The network effect compounds.

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
| **Chart of Accounts** | Yes (Indian CoA, 40 accounts) | Yes | Yes | No | No |
| **Trial Balance / Balance Sheet** | Yes (derived) | Yes | Yes | No | No |
| **P&L** | Yes | Yes | Yes | No | No |
| **Cash Flow Statement** | Yes (indirect method) | Yes | Yes | No | No |
| **Journal entries** | Yes | Yes | Yes | No | No |
| **GST returns** | GSTR-1, 3B, 9, 2B recon | GSTR-1, 3B, 9 | GSTR-1, 3B, 9 | Basic | Basic |
| **E-Invoicing (IRP)** | Yes | Yes | Yes | No | No |
| **E-Way Bill** | Yes | Yes | Yes | No | No |
| **ITC tracking** | Yes (aging + blocked + utilization) | Yes | Yes | No | No |
| **Bank reconciliation** | Yes (10 banks, auto-match) | Yes | Yes | No | No |
| **Tally export** | Yes (XML, clean import) | N/A | Partial | Yes | No |
| **Mobile app** | Yes | No | Yes | Yes (primary) | Yes (primary) |
| **AI / API access** | MCP + CLI + API | XML API | REST API | No | No |
| **Payment gateway** | Full (charges + settlement + reversal) | No | Basic | No | No |
| **Online store** | Built-in | No | No | Basic | Basic |
| **Multi-tenant SaaS** | Yes | No | Yes | Cloud only | Cloud only |

---

## Architecture

```
+--------------------------------------------------------------+
|                        Client Layer                          |
|                                                              |
|  apps/web            apps/mobile        apps/store           |
|  React 19 + Vite     Expo SDK 55        React 19 + Vite     |
|  TanStack Router     Expo Router        (public storefront)  |
|                                                              |
|  apps/desktop                                                |
|  Tauri v2 (wraps web)                                        |
+----------------------------+---------------------------------+
                             | tRPC (typed) + REST (store)
+----------------------------v---------------------------------+
|                       API Layer                              |
|                                                              |
|  packages/api                                                |
|  Hono + tRPC v11 · 20+ routers · 200+ procedures            |
|  pino logging · CSRF · Rate limiting · Audit log             |
+----------------------------+---------------------------------+
                             | Drizzle ORM
+----------------------------v---------------------------------+
|                     Database Layer                            |
|                                                              |
|  packages/db                                                 |
|  PostgreSQL 16 · NUMERIC(15,2) for money                     |
|  Control DB (auth, tenants) + Tenant DB (business data)      |
|  Partial indexes · FOR UPDATE locking                        |
+--------------------------------------------------------------+

+--------------------------------------------------------------+
|                    Shared Layer                               |
|  packages/shared                                             |
|  Zod validators · TypeScript types · Fixed-point money       |
|  Invoice calculation · HSN master (19K codes)                |
|  Used by API + web + mobile                                  |
+--------------------------------------------------------------+

+--------------------------------------------------------------+
|                  CLI & AI Agents                             |
|                                                              |
|  packages/cli    Terminal CLI (@hisaabo/cli on npm)          |
|  packages/mcp    MCP server for Claude, AI agents            |
|  Both call the API with x-business-id header                |
+--------------------------------------------------------------+
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

Create an account on first visit. The setup wizard creates your first business with a seeded Chart of Accounts.

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

Everything listed in Features above is shipped and tested. The full accounting layer, GST compliance suite, and bank reconciliation engine were built in Q4 FY26.

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
