# @hisaabo/api

The Hisaabo backend. A [Hono](https://hono.dev/) HTTP server with a [tRPC v11](https://trpc.io/) router that provides fully type-safe access to all business data. 14 routers, 130+ procedures, rate limiting, audit logging, PDF generation, and email.

[![Hono](https://img.shields.io/badge/Hono-4-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![tRPC](https://img.shields.io/badge/tRPC-v11-2596BE?logo=trpc&logoColor=white)](https://trpc.io/)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

---

## Running locally

```bash
# From monorepo root
pnpm --filter @hisaabo/api dev

# Or from this directory
pnpm dev
```

The API starts at `http://localhost:3000`. Requires a running PostgreSQL instance — see the root README for Docker setup.

---

## Building

```bash
pnpm --filter @hisaabo/api build
```

Uses [tsup](https://tsup.egoist.dev/) to bundle `src/server.ts` → `dist/server.js`. The PDF worker is compiled separately:

```bash
# Handled automatically by the build script
npx tsup src/lib/pdf-worker.ts --format esm --out-dir dist/lib
```

---

## Architecture

### Hono server (`src/server.ts`)

The Hono app handles:
- Security headers (HSTS, X-Frame-Options, CSP, etc.)
- CORS with origin allowlist from `CORS_ORIGINS` env var
- Rate limiting: 120 requests/minute per IP
- Health check: `GET /health`
- tRPC endpoint: `POST /trpc/*` and `GET /trpc/*`
- Public store REST endpoints: `GET /store/:slug/catalog.json`, `POST /store/:slug/order`
- Invoice PDF endpoint: `GET /invoice/:id/pdf`

### tRPC procedure hierarchy

Three levels of middleware protection, each extending the previous:

```
publicProcedure          — No auth required (login, register, magic link)
  └── protectedProcedure — Requires valid session (user settings, business list)
        └── tenantProcedure    — Requires tenant selection (injects ctx.db)
              └── businessProcedure  — Requires business selection (scopes queries)
                    └── authorizedProcedure — CASL ability object in context
```

All mutation and query procedures that touch business data use `authorizedProcedure` (aliased as `viewerProcedure`, `memberProcedure`, `adminProcedure` for backward compatibility). Granular permission checks happen per-procedure via `requireCan(ctx.ability, action, subject)`.

### Multi-tenancy

In self-hosted mode (`MULTI_TENANT=false`), all tenants share a single PostgreSQL database. The tenant ID is still tracked — it is just resolved to the same database for every request.

In cloud/SaaS mode (`MULTI_TENANT=true`), each tenant has its own database. The `getTenantDb()` function in `packages/db` resolves the tenant's connection string from the control database and maintains a connection pool (max 50 pools, 5-minute idle eviction).

---

## Routers

| Router | File | Key procedures |
|---|---|---|
| `auth` | `routers/auth.ts` | `register`, `login`, `logout`, `sendMagicLink`, `verifyMagicLink`, `me` |
| `business` | `routers/business.ts` | `list`, `create`, `update`, `switchBusiness` |
| `party` | `routers/party.ts` | `list`, `create`, `update`, `delete`, `ledger`, `merge`, `exportTally` |
| `item` | `routers/item.ts` | `list`, `create`, `update`, `delete`, `adjustStock`, `stockHistory` |
| `invoice` | `routers/invoice.ts` | `list`, `create`, `update`, `delete`, `updateStatus`, `pdf` |
| `payment` | `routers/payment.ts` | `list`, `create`, `update`, `delete`, `allocate` |
| `expense` | `routers/expense.ts` | `list`, `create`, `update`, `delete` |
| `bankAccount` | `routers/bankAccount.ts` | `list`, `create`, `update`, `transfer`, `transactions` |
| `gst` | `routers/gst.ts` | `gstr1`, `gstr3b` |
| `dashboard` | `routers/dashboard.ts` | `summary`, `salesTrend`, `topParties`, `expenseBreakdown` |
| `document` | `routers/document.ts` | Quotation, proforma, delivery challan, credit note procedures |
| `store` | `routers/store.ts` | `getConfig`, `updateConfig`, `listOrders`, `fulfillOrder` |
| `import` | `routers/import.ts` | MyBillBook data import (parties, items, invoices, payments) |
| `tenant` | `routers/tenant.ts` | Tenant management for cloud/SaaS deployments |

---

## Authentication model

### Web app (cookie-based sessions)

1. User logs in via password or magic link.
2. API creates a session record in the control database with a 30-day expiry.
3. API sets a `session_id` HttpOnly, Secure, SameSite=Lax cookie.
4. Every request reads the `session_id` cookie, validates the session in the database (with in-memory LRU cache), and resolves the user.

### Mobile app (Bearer token sessions)

The mobile app cannot reliably use cookies. It sends `Authorization: Bearer <session_id>` as a header instead. The session model is identical — the same session table, same 30-day expiry, same server-side invalidation.

### Magic links

1. Client calls `auth.sendMagicLink` with an email address.
2. API generates a token, hashes it with SHA-256, and stores the hash in the database with a 15-minute expiry.
3. API sends an email (via Resend) containing the raw token as a URL parameter.
4. Client calls `auth.verifyMagicLink` with the raw token.
5. API hashes the token, looks it up, validates expiry, and creates a session.

If `RESEND_API_KEY` is not set, the magic link URL is printed to the console (development convenience).

---

## PDF generation

Invoice PDFs are generated by PDFKit in `src/lib/invoice-pdf.ts`. The PDF worker (`src/lib/pdf-worker.ts`) runs in a separate thread via Node's `worker_threads` to avoid blocking the event loop during generation.

Fonts are bundled in `packages/api/fonts/`:
- NotoSans (Latin + Devanagari) for body text and Indian script support
- JetBrains Mono for invoice numbers and codes

PDF formats:
- **A4 portrait** — standard business invoice
- **A5 landscape** — compact format
- **Thermal (80mm)** — for thermal receipt printers

Every invoice PDF includes a UPI QR code if the business has a UPI account configured.

---

## Permissions (CASL)

`src/lib/permissions.ts` defines abilities for five roles:

| Role | Can |
|---|---|
| `superadmin` | Everything |
| `admin` | All CRUD, manage team members |
| `seller_manager` | Invoices (all), parties, items, payments, expenses |
| `seller` | Create invoices (cannot modify tax rates or discounts), view |
| `accountant` | Read everything, manage payments and expenses, cannot create invoices |

Permission checks use `requireCan(ctx.ability, action, subject)` at the start of each procedure. Unauthorized requests throw a `FORBIDDEN` tRPC error.

---

## Audit logging

Every mutation (create, update, delete) is logged via `logAudit()` in `src/lib/audit.ts`. Audit records include:
- User ID and tenant ID
- Entity type and entity ID
- Action performed
- Client IP address
- Timestamp

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | Server port (default: 3000) |
| `CORS_ORIGINS` | Yes | Comma-separated allowed origins |
| `APP_URL` | Yes | Frontend URL (for magic link emails) |
| `NODE_ENV` | No | `development` or `production` |
| `RESEND_API_KEY` | No | Resend API key for transactional email |
| `EMAIL_FROM` | No | Sender address for emails |
| `MULTI_TENANT` | No | Enable multi-tenant mode (default: `false`) |
| `CONTROL_DATABASE_URL` | Multi-tenant only | Separate control database URL |
| `TURNSTILE_SECRET_KEY` | Production store | Cloudflare Turnstile backend key |
