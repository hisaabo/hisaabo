# @hisaabo/db

The Hisaabo database layer. Drizzle ORM schema definitions, PostgreSQL client setup, and migration tooling for both the control database (auth and tenants) and tenant databases (all business data).

[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.36-C5F74F?logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

---

## Overview

Hisaabo uses two logical databases:

| Database | Purpose | Schema file |
|---|---|---|
| **Control DB** | Users, sessions, tenants, team memberships, magic link tokens | `src/control-schema.ts` |
| **Tenant DB** | All business data — businesses, parties, items, invoices, payments, expenses, inventory, bank accounts | `src/tenant-schema.ts` |

In self-hosted mode (`MULTI_TENANT=false`), both databases are the same PostgreSQL database — the same `DATABASE_URL`. In cloud/SaaS mode, the control database is separate and each tenant has its own database.

---

## Schema overview

### Control database (`control-schema.ts`)

| Table | Description |
|---|---|
| `tenants` | Organizations. Each has a slug, plan, status, and optional per-tenant DB credentials (cloud mode) |
| `users` | User accounts with email, optional name, Argon2id password hash, email verification status |
| `sessions` | Active sessions with token hash, user ID, expiry timestamp |
| `tenant_members` | Join table: which users belong to which tenants, with their role |
| `magic_link_tokens` | Hashed magic link tokens with expiry |

**Roles** (`member_role` enum): `superadmin`, `admin`, `seller_manager`, `seller`, `accountant`

### Tenant database (`tenant-schema.ts`)

| Table | Description |
|---|---|
| `businesses` | Business profiles: name, GSTIN, address, invoice prefix/numbering, store settings, financial year |
| `parties` | Customers and suppliers: GSTIN, PAN, state code, address, running balance |
| `items` | Products and services: HSN, unit, pricing, stock quantity, variant/alt-unit config |
| `item_variants` | Variant entries for items with `itemMode = "variants"` (e.g., size, colour) |
| `invoices` | All document types: invoices, quotations, proformas, challans, credit notes, returns |
| `invoice_items` | Line items on invoices: quantity, unit price, tax rate, discount, totals |
| `payments` | Payment records: amount, mode, bank account, date |
| `payment_allocations` | Multi-invoice payment allocation: which payment covers which invoice amount |
| `expenses` | Business expenses: amount, category, description, bank account |
| `bank_accounts` | Bank, cash, UPI, and credit card accounts with running balance |
| `bank_transactions` | Individual transactions on bank accounts |
| `audit_logs` | Immutable audit trail: every mutation with user, entity, action, IP |

**Key invariants:**
- All monetary columns use `NUMERIC(15,2)` — never `FLOAT` or `DOUBLE PRECISION`
- Invoice numbering uses atomic PostgreSQL transactions via `nextval`-style increments on the `businesses` table
- `invoices.deletedAt` is a soft-delete timestamp — deleted invoices are never physically removed
- Every tenant DB table has `businessId` as a foreign key to `businesses.id` with `ON DELETE CASCADE`

---

## Database clients

### `src/client.ts` — single-tenant (self-hosted)

```typescript
import { db } from "@hisaabo/db";
// db is a Drizzle instance connected to DATABASE_URL
```

### `src/control-client.ts` — control database

```typescript
import { controlDb } from "@hisaabo/db";
// controlDb is a Drizzle instance for the control schema
// In self-hosted mode, points to the same DATABASE_URL
// In multi-tenant mode, points to CONTROL_DATABASE_URL
```

### `src/tenant-pool.ts` — dynamic tenant connections (cloud)

```typescript
import { getTenantDb } from "@hisaabo/db";
const db = await getTenantDb(tenantId);
```

`getTenantDb` maintains an LRU connection pool (max 50 connections, 5-minute idle eviction). In self-hosted mode it always returns the same connection.

---

## Migration workflow

### Development (schema push — no migration files)

```bash
# Push current schema.ts directly to the database (destructive if tables exist)
pnpm db:push

# Drop everything and repush from scratch
pnpm db:reset
```

### Production (migration files — safe and reversible)

```bash
# Generate a migration file from schema changes
pnpm db:generate

# Review the generated SQL in packages/db/drizzle/
# Then apply it
pnpm db:migrate
```

Migration files are in `packages/db/drizzle/`. These are committed to the repository and applied on production deploys via the Docker entrypoint script.

### Schema change process

1. Edit `src/tenant-schema.ts` or `src/control-schema.ts`.
2. Run `pnpm db:push` in development to apply to your local database immediately.
3. When ready to commit, run `pnpm db:generate` to produce a migration file.
4. Commit the schema change and the migration file together.
5. The Docker entrypoint runs `pnpm db:migrate` on startup in production.

---

## Drizzle Studio

```bash
pnpm db:studio
```

Opens a browser-based database explorer at `https://local.drizzle.studio`. Useful for inspecting data, running ad-hoc queries, and verifying schema changes during development.

---

## Money precision

All monetary values in the tenant schema use `NUMERIC(15,2)`:

```typescript
// Example from tenant-schema.ts
totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),
```

In TypeScript, Drizzle returns these as strings (not `number`). Use the `money` module from `@hisaabo/shared` for all arithmetic:

```typescript
import { money } from "@hisaabo/shared";

const total = money.add(subtotal, taxAmount);  // Returns "1050.00"
const tax   = money.percent("1000.00", 5);     // Returns "50.00"
```

Never use `parseFloat` or `Number()` for monetary calculations — floating-point errors accumulate across invoice totals.
