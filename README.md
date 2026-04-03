# Hisaabo

> Free, open-source invoicing and business management for Indian businesses. GST-compliant. Multi-platform.

[![CI](https://github.com/hisaabo/hisaabo/actions/workflows/ci.yml/badge.svg)](https://github.com/hisaabo/hisaabo/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/hisaabo/hisaabo/graph/badge.svg)](https://codecov.io/gh/hisaabo/hisaabo)
[![Release](https://img.shields.io/github/v/release/hisaabo/hisaabo?include_prereleases&label=release)](https://github.com/hisaabo/hisaabo/releases)
[![License: O'Saasy](https://img.shields.io/badge/license-O'Saasy-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Expo](https://img.shields.io/badge/Expo-55-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![React Native](https://img.shields.io/badge/React_Native-0.83-61DAFB?logo=react&logoColor=black)](https://reactnative.dev/)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)](https://tauri.app/)
[![Hono](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![tRPC](https://img.shields.io/badge/tRPC-11-2596BE?logo=trpc&logoColor=white)](https://trpc.io/)
[![Drizzle](https://img.shields.io/badge/Drizzle-0.38-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-GHCR-2496ED?logo=docker&logoColor=white)](https://ghcr.io/hisaabo/hisaabo)
[![@hisaabo/cli](https://img.shields.io/npm/v/@hisaabo/cli?logo=npm&logoColor=white&label=@hisaabo/cli)](https://www.npmjs.com/package/@hisaabo/cli)
[![@hisaabo/mcp](https://img.shields.io/npm/v/@hisaabo/mcp?logo=npm&logoColor=white&label=@hisaabo/mcp)](https://www.npmjs.com/package/@hisaabo/mcp)

**Hisaab, pakka.** (Honest accounting.)

---

## Why Hisaabo?

Indian billing apps like MyBillBook and Vyaapaar charge monthly fees for basic features, lock your data behind proprietary clouds, and force you to trust third parties with your customers' financial records. Hisaabo is different:

- **You own your data.** Hisaabo runs on your server. Your invoices, your parties, your accounts — none of it touches someone else's cloud unless you put it there.
- **GST-ready, built for India.** CGST/SGST/IGST auto-split by state, HSN codes, GSTR-1 and GSTR-3B reports, UPI QR on every invoice, April–March financial year — it all works out of the box.
- **Every platform covered.** Fully-featured web dashboard accessible from any browser on any device. Hisaabo Cloud adds native Android/iOS apps and a desktop app (macOS/Windows/Linux) — one codebase, one API, one source of truth.
- **Open source core.** The entire product is source-available. Read the code, modify it, self-host it forever at no cost.

---

## Features

| Feature | What you get |
|---|---|
| **Invoicing** | Sale & purchase invoices, quotations, proformas, delivery challans, credit notes — all with PDF generation and UPI QR codes |
| **Parties** | Customer and supplier ledgers, GSTIN validation, outstanding balances, Tally XML export |
| **Items & Inventory** | Stock tracking, conversion units (kg/g, L/mL), variants, low-stock alerts, purchase/sale/store pricing |
| **Payments** | Multi-mode (Cash, UPI, Bank, Cheque), multi-invoice allocation, running party balances |
| **Expenses** | Category-based tracking with bank account linkage |
| **Banking** | Bank, cash, UPI, and credit card account management with reconciliation |
| **GST Compliance** | GSTR-1 (B2B, B2C, HSN summary), GSTR-3B, inter/intra-state tax determination |
| **Online Store** | Free public storefront at `store.hisaabo.in/your-slug`, phone verification, WhatsApp order updates |
| **Reports** | P&L, receivables aging, sales trends, expense breakdowns, party ledgers |
| **Team & Roles** | 5 CASL-based roles: Superadmin, Admin, Seller Manager, Seller, Accountant |
| **Import** | Full MyBillBook data import: parties, items, invoices, payments, expenses, transfers |
| **Auth** | Magic link (passwordless) + password login, 30-day HttpOnly sessions |

---

## AI & Automation

**The only Indian invoicing platform with native AI agent support.**

Your competitors are automating their bookkeeping. A textile merchant in Jaipur creates invoices from WhatsApp voice notes. An accountant in Mumbai reconciles 500 invoices across three businesses before lunch. A Delhi logistics company auto-generates GST prep data every month without a single manual step.

Hisaabo's entire product is API-first. The web dashboard, mobile app, and desktop app are thin clients over the same tRPC API — which means any AI agent, automation script, or CI/CD pipeline can do everything a human can do in the UI.

### MCP Server — Works with Claude Desktop today

Connect Hisaabo to Claude, OpenClaw, or any MCP-compatible AI agent. Five-minute setup. Natural conversation becomes real business operations:

```
You: "How much does Montu Arora owe me?"
Claude: "Montu Arora has ₹12,450 outstanding across 3 invoices.
         The oldest is INV-12890 from 15 days ago. Should I draft a reminder?"

You: "Create an invoice for Gupta Enterprises — 20 bags of rice at ₹1,250"
Claude: "Done. Invoice BB-14821 created — ₹26,250 total (inc. 5% GST). PDF ready."
```

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

Get your credentials: `npm install -g @hisaabo/cli && hisaabo login --api-url https://your-instance.com && hisaabo whoami --json`

130+ API endpoints. 14 business domains. GST-compliant out of the box. Multi-tenant with full business isolation.

### CLI Tool — Script everything

Manage your entire business from the terminal. Every command supports `--json` for piping into `jq`, `--format csv` for spreadsheets, and `--format ids` for scripting with `xargs`.

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
```

14 command groups: `invoice`, `party`, `item`, `payment`, `expense`, `bank`, `gst`, `report`, `shipment`, `target`, `store`, `import`, `dashboard`, `business`.

**Deep-dive:** [@hisaabo/cli on npm](https://www.npmjs.com/package/@hisaabo/cli) | [docs.hisaabo.in/ai/cli/](https://docs.hisaabo.in/ai/cli/)

### Integrations

Build on top of Hisaabo's open API to connect anything:
- **WhatsApp Bot** — Create invoices from voice notes via Claude + MCP
- **Slack** — Daily business summary in your team channel via webhook
- **Google Sheets** — Nightly sync of invoices, payments, and stock levels
- **Shiprocket** — Auto-generate shipping labels from delivery challans *(roadmap)*
- **Tally** — Export parties and invoices as Tally XML *(built-in today)*
- **OpenClaw Agents** — Deploy customer service agents for your online store

### Coming Soon
- **Auto GST Rate Updates** — AI monitors government notifications and suggests rate changes. You review and approve.
- **Dynamic Pricing Intelligence** — Market pricing analysis and margin-aware recommendations.
- **AI Customer Service** — OpenClaw-powered agents handling order status, payment queries, and support for your online store.

**Deep-dive:** [docs.hisaabo.in/ai](https://docs.hisaabo.in/ai)

---

## Quick Start for Developers

Three paths, pick the one that matches your goal:

### 1. Try the API immediately (no setup)

Call the Hisaabo Cloud API directly:

```bash
# Register an account
curl -X POST https://api.hisaabo.in/api/trpc/auth.register \
  -H "Content-Type: application/json" \
  -d '{"json":{"email":"you@yourshop.in","name":"Your Name","password":"strongpass123","confirmPassword":"strongpass123"}}'

# The response includes sessionToken — use it as a Bearer token
# and your businessId from the setup wizard
```

Full API reference: [api.hisaabo.in](https://api.hisaabo.in)

### 2. Self-host and build on top

**Prerequisites:** Node.js 20+, pnpm 9+, Docker

```bash
git clone https://github.com/hisaabo/hisaabo.git
cd hisaabo

# Install all dependencies
pnpm install

# Start local PostgreSQL (creates hisaabo database on port 5432)
docker compose up -d

# Configure environment (defaults work for local dev)
cp .env.example .env

# Push the database schema
pnpm db:push

# Start all dev servers
pnpm dev
```

| Service | URL |
|---|---|
| Web app | http://localhost:5173 |
| API | http://localhost:3000 |
| Online store | http://localhost:5174 |

On first visit, create an account and follow the setup wizard to create your first business.

### 3. Connect AI to your existing Hisaabo instance

If you already have Hisaabo running and want to connect Claude Desktop:

```bash
npm install -g @hisaabo/cli
hisaabo login --api-url https://your-hisaabo-instance.com
hisaabo whoami --json  # copy token, tenantId, businessId from the output
```

Then add to `claude_desktop_config.json` — see the [MCP Server guide](https://docs.hisaabo.in/ai/mcp-server/).

---

For production deployment, database setup, and HTTPS configuration, see the [self-hosting guide](https://docs.hisaabo.in/getting-started/self-hosting).

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Client Layer                        │
│                                                          │
│  apps/web          apps/mobile      apps/store           │
│  React 19 + Vite   Expo SDK 52      React 19 + Vite      │
│  TanStack Router   Expo Router      (public storefront)  │
│                                                          │
│  apps/desktop                                            │
│  Tauri v2 (wraps web)                                    │
└──────────────────────────┬──────────────────────────────┘
                           │ tRPC (typed) + REST (store)
┌──────────────────────────▼──────────────────────────────┐
│                     API Layer                            │
│                                                          │
│  packages/api                                            │
│  Hono + tRPC v11, 14 routers, 130+ procedures            │
│  Rate limiting · CORS · Security headers · Audit log     │
└──────────────────────────┬──────────────────────────────┘
                           │ Drizzle ORM
┌──────────────────────────▼──────────────────────────────┐
│                   Database Layer                         │
│                                                          │
│  packages/db                                             │
│  PostgreSQL 16 · NUMERIC(15,2) for money                 │
│  Control DB (auth, tenants) + Tenant DB (business data)  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  Shared Layer                            │
│  packages/shared                                         │
│  Zod validators · TypeScript types · money module        │
│  Invoice calculation · Used by API + web + mobile        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              CLI & AI Agents                              │
│                                                          │
│  packages/cli    Terminal CLI (@hisaabo/cli)              │
│  packages/mcp    MCP server for Claude, OpenClaw, etc.   │
│  Both call the API with x-business-id header             │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│               Documentation                              │
│  apps/docs (Starlight/Astro) · apps/api-docs (React)     │
└─────────────────────────────────────────────────────────┘
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

## Project Structure

```
hisaabo/
├── apps/
│   ├── web/          # React 19 admin dashboard (main application)
│   ├── mobile/       # Expo SDK 52 iOS + Android app
│   ├── store/        # Public customer-facing online storefront
│   ├── desktop/      # Tauri v2 desktop wrapper (macOS, Windows, Linux)
│   ├── docs/         # Starlight (Astro) user documentation site
│   └── api-docs/     # Stripe-style API reference site
├── packages/
│   ├── api/          # Hono + tRPC server (14 routers, 130+ procedures)
│   ├── db/           # Drizzle ORM schema + PostgreSQL client
│   ├── shared/       # Zod validators, TypeScript types, money module
│   ├── cli/          # Terminal CLI (@hisaabo/cli on npm)
│   └── mcp/          # MCP server for AI agents (@hisaabo/mcp on npm)
├── nginx/            # Production nginx configuration
├── docker-compose.yml        # Local development PostgreSQL
├── docker-compose.prod.yml   # Production API + PostgreSQL deployment
├── Dockerfile                # API container image
└── Dockerfile.once           # ONCE all-in-one image (PostgreSQL + API)
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
| `pnpm dev` | Start all dev servers (API + web + store, mobile excluded) |
| `pnpm dev:mobile:android` | Start mobile on Android emulator |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm lint` | Lint all packages (oxlint) |
| `pnpm db:push` | Push schema changes to DB (dev — no migration files) |
| `pnpm db:reset` | Drop all tables and repush schema |
| `pnpm db:generate` | Generate Drizzle migration files (for production) |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm db:studio` | Open Drizzle Studio (browser-based DB explorer) |

### Run a single package

```bash
pnpm --filter @hisaabo/api dev      # API server only
pnpm --filter @hisaabo/web dev      # Web app only
pnpm --filter @hisaabo/mobile dev   # Mobile (Expo Go)
pnpm --filter @hisaabo/store dev    # Online store only
```

### Mobile development on WSL + Windows

The Android emulator must run in Windows (not WSL). The API runs in WSL and the `dev:android` script auto-detects your WSL IP to pass to the emulator:

```bash
# In WSL terminal — auto-sets EXPO_PUBLIC_API_URL to your WSL IP
pnpm dev:mobile:android
```

Android Studio and the emulator must be installed on Windows. Open the Expo Go app on the emulator and scan the QR code from the terminal output.

See [apps/mobile/README.md](apps/mobile/README.md) for the full setup guide.

---

## Deployment

### Docker Compose (production)

The standard production setup runs the API and PostgreSQL in containers on your VPS:

```bash
# Copy and edit environment variables
cp .env.example .env

# Pull and start
docker compose -f docker-compose.prod.yml up -d
```

The web and store frontends are static SPAs — deploy them to Cloudflare Pages for free.

### ONCE (Basecamp-style all-in-one)

For the simplest possible self-hosted setup, the `Dockerfile.once` image bundles PostgreSQL 16 and the Node API into a single container managed by s6-overlay. Suitable for [ONCE](https://once.com/)-style deployments where you want everything in one process-supervised container.

```bash
docker build -f Dockerfile.once -t hisaabo-once .
docker run -v /data/hisaabo:/storage -p 80:80 hisaabo-once
```

### Cloudflare Pages (web + store frontends)

| App | Build command | Output directory |
|---|---|---|
| Web | `pnpm --filter @hisaabo/web build` | `apps/web/dist` |
| Store | `pnpm --filter @hisaabo/store build` | `apps/store/dist` |

Set `VITE_API_URL` to your API server URL in the Cloudflare Pages environment variables.

### Desktop builds (Tauri)

The desktop app is distributed as part of **Hisaabo Cloud**. Self-hosted users access the full application through a web browser — no desktop installation needed.

```bash
cd apps/desktop

# Development
cargo tauri dev

# Production build
cargo tauri build
# Outputs: .dmg (macOS), .msi (Windows), .AppImage (Linux)
```

### Android APK

The mobile app is distributed as part of **Hisaabo Cloud**. Self-hosted users can access Hisaabo from any mobile browser — the web app is fully responsive.

```bash
# Local build via EAS (requires Expo account)
pnpm --filter @hisaabo/mobile build:apk
```

For a full production deployment guide covering nginx, TLS, backups, and WAL archiving, see [docs.hisaabo.in/self-hosting](https://docs.hisaabo.in/getting-started/self-hosting).

---

## Environment Variables

Copy `.env.example` to `.env`. Required variables:

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://hisaabo:pass@localhost:5432/hisaabo` |
| `PORT` | API server port | `3000` |
| `CORS_ORIGINS` | Comma-separated allowed origins | `https://app.hisaabo.in` |
| `APP_URL` | Frontend URL (for magic link emails) | `https://app.hisaabo.in` |
| `NODE_ENV` | Environment | `production` |
| `RESEND_API_KEY` | Email sending (optional — magic links print to console if unset) | |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile for store bot protection (production only) | |
| `MULTI_TENANT` | Enable multi-tenant cloud mode | `false` |

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
pnpm lint        # Must pass
pnpm build       # Must pass
```

To run the test suite:

```bash
# Run all tests
pnpm --filter @hisaabo/api test

# Run tests in watch mode during development
pnpm --filter @hisaabo/api test:watch
```

Key contribution guidelines:
- Use the `money` module from `packages/shared` for all monetary arithmetic — never `parseFloat` for financial values
- All input validation goes in `packages/shared/src/validators.ts` as Zod schemas
- No component libraries — styling is pure Tailwind CSS
- New features ship with a `feature-parity.yaml` update

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines, code style, and areas where help is most needed (translations, testing, accessibility).

---

## License

[O'Saasy License (v1.0)](LICENSE) — Free to use, self-host, and modify. You cannot offer Hisaabo as a competing hosted service.

---

Built with care in India. *Hisaab, pakka.*
