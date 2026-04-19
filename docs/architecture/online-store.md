# Online Store Architecture for Hisaabo

**Status**: Proposed
**Date**: 2026-03-25
**Author**: Architecture Review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Decision Records](#2-architecture-decision-records)
3. [Schema Design](#3-schema-design)
4. [API Design](#4-api-design)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Store Page Design](#6-store-page-design)
7. [Admin UI Design](#7-admin-ui-design)
8. [Routing and Subdomain Strategy](#8-routing-and-subdomain-strategy)
9. [Order Flow](#9-order-flow)
10. [Notification Flow](#10-notification-flow)
11. [Security](#11-security)
12. [Performance and Caching](#12-performance-and-caching)
13. [Future Extensibility](#13-future-extensibility)
14. [Migration Path](#14-migration-path)

---

## 1. Executive Summary

The online store is a public-facing storefront that lets Hisaabo businesses sell directly to customers via a unique URL. Orders placed on the store become draft invoices inside the business's Hisaabo account. The store is a read-heavy, public surface with fundamentally different requirements from the authenticated admin app: it must be fast, SEO-friendly, and completely isolated from private business data.

**Key constraints that shaped this design:**

- Hisaabo is multi-tenant with per-tenant databases (`getTenantDb`). The store must resolve a public slug to a tenant + business without authentication.
- The existing invoice pipeline (atomic numbering, `calcInvoiceTotals`, stock adjustment) is battle-tested. Orders should flow through it, not around it.
- The project uses an O'Saasy license where multi-tenancy is cloud-only. The online store must work in both self-hosted (single-tenant) and cloud (multi-tenant) modes.
- Quality bar is extremely high. The store page must load in under 1 second on a 4G Indian mobile connection.

---

## 2. Architecture Decision Records

### ADR-001: Store as a Separate Hono App (Not a Separate Deployment)

**Status**: Proposed

**Context**: The store needs public, unauthenticated access to item catalogs and order placement. The main app's tRPC is designed around authenticated sessions (`protectedProcedure`, `businessProcedure`). We need public endpoints, but creating a second deployment doubles infrastructure cost and operational complexity.

**Options considered**:

| Option | Pros | Cons |
|--------|------|------|
| A. Public tRPC procedures on existing router | Zero new infra; type-safe | Muddies the auth model; store SPA still client-rendered |
| B. Separate Hono routes on the same server | Clean separation; can return HTML; same process | Shares rate limit/memory budget; slightly larger server.ts |
| C. Entirely separate store service | Full isolation; independent scaling | Two deployments; duplicated DB access; operational overhead for self-hosters |

**Decision**: Option B -- Add a `/store` Hono route group on the existing API server. Store routes are plain Hono handlers (not tRPC) that return JSON for the store SPA. This keeps a single deployment for self-hosters while cleanly separating public and private APIs.

For the cloud tier, a CDN (Cloudflare) sits in front and caches catalog responses. If independent scaling is needed later, the `/store` routes can be extracted to a separate worker without changing the API contract.

**Consequences**:
- Easier: Single deployment, shared DB pool, simple ops for self-hosters.
- Harder: Must be disciplined about not leaking authenticated context into store routes. Need explicit rate limiting on store endpoints separate from the tRPC rate limiter.

---

### ADR-002: Path-Based Routing (`store.hisaabo.in/:slug`) Over Subdomain Routing

**Status**: Proposed

**Context**: The original request asks for `business-slug.store.hisaabo.in`. Wildcard subdomains require wildcard TLS certificates, DNS configuration, and custom domain support is complex (per-domain TLS via SNI). Self-hosters typically cannot set up wildcard DNS.

**Options considered**:

| Option | Pros | Cons |
|--------|------|------|
| A. Wildcard subdomain `slug.store.hisaabo.in` | Pretty URLs; feels premium | Wildcard TLS; DNS config; self-hosters cannot replicate; cookie scoping headaches |
| B. Path-based `store.hisaabo.in/slug` | Simple TLS; works for self-hosters; CDN-friendly | Less "branded" feel; slightly longer URLs |
| C. Path within main app `/store/slug` | Simplest; no new domain | Mixes public/private on same origin; cookie leakage risk |

**Decision**: Option B for launch, with a redirect layer for Option A as a cloud-only premium feature later. The store lives at `store.hisaabo.in/:slug` (cloud) or `localhost:3000/store/:slug` (self-hosted). In cloud mode, this is a separate domain from the admin app (`app.hisaabo.in`), which provides cookie isolation for free.

Self-hosted users access it at the same origin under `/store/:slug`, which is fine because they control their own domain and there is no cross-tenant concern.

Custom domains (Phase 2) are handled via a CNAME to `store.hisaabo.in` plus a `custom_domain` column in `store_settings`, resolved at the CDN/reverse-proxy layer.

**Consequences**:
- Easier: Standard TLS, trivial CDN config, works identically in self-hosted mode.
- Harder: Less "branded" than a subdomain. Mitigated by custom domain support in Phase 2.

---

### ADR-003: Orders Create Draft Invoices (Not a Separate Orders Table)

**Status**: Proposed

**Context**: We could model orders as a separate entity with their own lifecycle, or funnel them directly into the existing invoice pipeline. A separate `store_orders` table means duplicating line item logic, totals calculation, and status management.

**Options considered**:

| Option | Pros | Cons |
|--------|------|------|
| A. Separate `store_orders` table with own lifecycle | Clean separation; orders can have order-specific fields (delivery address, customer info) | Duplicates invoice logic; needs a "convert to invoice" step; two sources of truth |
| B. Orders are draft invoices with `source = 'online_store'` + a linked `store_order_details` table | Reuses invoice pipeline; single source of truth; business owner sees orders in their normal invoice list | Invoice table gains some order-specific foreign keys; slightly more complex invoice creation |

**Decision**: Option B. An online order creates a draft invoice (type=sale, status=draft, source='online_store') and a companion `store_orders` row that holds order-specific metadata (customer name, phone, delivery address, order status). The invoice ID is the foreign key.

The `source` column on invoices already exists as a `text` column (used for imports: "mybillbook", etc.). We use it with value `"online_store"` -- no schema change needed for the invoice table itself.

This means:
- The business owner sees online orders in their normal Sales Invoices list, filtered by `source = 'online_store'`.
- Confirming an order means changing the invoice status from `draft` to `sent`.
- All existing invoice features (PDF, payments, GST reports) work automatically.

**Consequences**:
- Easier: No duplicate calculation logic; invoices, payments, and GST reports work out of the box for online orders.
- Harder: Need a lightweight `store_orders` table for order-specific metadata (customer contact, delivery address) since the party on the invoice will be a generic "Walk-in Customer" or auto-created party. The `store_orders` table is the join between the anonymous store customer and the invoice.

---

### ADR-004: Store Frontend as a Lightweight SPA Embedded in the Monorepo

**Status**: Proposed

**Context**: The store page must be SEO-friendly and load fast. Options range from a fully server-rendered page to a separate SPA.

**Options considered**:

| Option | Pros | Cons |
|--------|------|------|
| A. Server-rendered HTML from Hono (template engine) | Best SEO; fastest first paint; no JS framework for store | Duplicates UI logic; no component reuse; hard to make interactive (cart) |
| B. Separate React SPA (`apps/store`) in the monorepo | Reuses React/Tailwind; can use same design tokens; fast build | SPA = poor SEO without SSR; needs its own build pipeline |
| C. React SPA with prerendering (vite-plugin-ssr or similar) | Good SEO; reuses React; interactive cart | Adds SSR complexity; another build step |
| D. Static JSON API + lightweight Preact/vanilla store app | Tiny bundle; fast; CDN-cacheable | Less component reuse; separate tech stack |

**Decision**: Option B with a critical optimization: the store catalog data is exposed as a JSON API (`GET /store/:slug/catalog.json`) that is CDN-cached. The store SPA (`apps/store`) is a minimal React app with:
- A `<meta>` tag prerenderer for SEO (the store Hono route serves an HTML shell with Open Graph tags populated server-side).
- Client-side hydration for cart interactivity.
- Bundle target under 50KB gzipped (no TanStack Router, no tRPC client -- just fetch + React).

The store app is a separate Vite entry (`apps/store`) in the monorepo. It shares `@hisaabo/shared` for validators and types but has no dependency on `@hisaabo/api` or `@tanstack/react-query`.

For Phase 2, this can be upgraded to full SSR (Hono + React server components or a prerender step) without changing the API contract.

**Consequences**:
- Easier: Stays in the monorepo; shares design tokens and validators; interactive cart works naturally.
- Harder: SEO is not perfect out of the box (mitigated by server-side HTML shell with OG tags and structured data). Full SSR deferred to Phase 2.

---

### ADR-005: Store Item Visibility as Columns on the Items Table (Not a Separate Junction Table)

**Status**: Proposed

**Context**: We need to track which items are visible on the online store, their store-specific price, sort order, and store category. This could be a separate `item_store_settings` junction table or columns on the existing `items` table.

**Options considered**:

| Option | Pros | Cons |
|--------|------|------|
| A. New columns on `items` table (`storeEnabled`, `storePrice`, `storeSortOrder`, `storeCategory`) | Simple queries; no joins; bulk toggle is a simple UPDATE | Adds nullable columns to items table; mixes concerns |
| B. Separate `item_store_settings` table (itemId FK, storeEnabled, storePrice, etc.) | Clean separation; items table stays focused | Requires JOIN for store catalog query; bulk operations need upserts; more complex |

**Decision**: Option A. Add columns directly to the `items` table. Rationale:

1. The items table already has mixed concerns (tax, stock, pricing, categories). Store visibility is a natural extension.
2. The bulk toggle UI is a simple `UPDATE items SET store_enabled = true WHERE id IN (...)` -- no upsert dance.
3. The store catalog query is `SELECT ... FROM items WHERE business_id = ? AND store_enabled = true` -- no join needed.
4. In the future, if we support multiple sales channels, we can extract to a junction table. For now, YAGNI.

New columns:
- `store_enabled` (boolean, default false)
- `store_price` (numeric(15,2), nullable -- null means use `sale_price`)
- `store_sort_order` (integer, default 0)
- `store_category` (text, nullable -- null means use `category`)
- `store_description` (text, nullable -- null means use `description`)

**Consequences**:
- Easier: Simpler queries, simpler bulk operations, no migration headaches.
- Harder: If we later need per-channel visibility (Shopify channel, Amazon channel, etc.), we will need to extract to a junction table. This is a reversible decision -- the columns can be deprecated and data migrated.

---

## 3. Schema Design

### 3.1 Modifications to Existing Tables

#### `items` table -- new columns

```typescript
// In packages/db/src/tenant-schema.ts, add to the items table:

// ── Online Store fields ──
storeEnabled: boolean("store_enabled").default(false).notNull(),
storePrice: numeric("store_price", { precision: 15, scale: 2 }),  // null = use salePrice
storeSortOrder: integer("store_sort_order").default(0).notNull(),
storeCategory: text("store_category"),         // null = use category
storeDescription: text("store_description"),   // null = use description
```

Add an index for the store catalog query:

```typescript
// In the items table index array:
index("items_store_idx").on(t.businessId, t.storeEnabled),
```

#### `businesses` table -- new columns

```typescript
// In packages/db/src/tenant-schema.ts, add to the businesses table:

// ── Online Store settings ──
storeEnabled: boolean("store_enabled").default(false).notNull(),
storeSlug: text("store_slug"),  // unique across all businesses (validated at app level)
storeTagline: text("store_tagline"),           // short description for store header
storeTheme: text("store_theme").default("default"),  // theme name
storeAccentColor: text("store_accent_color"),  // hex color, e.g., "#4F46E5"
storeCurrency: text("store_currency"),         // null = use business currency
storeMinOrderAmount: numeric("store_min_order_amount", { precision: 15, scale: 2 }),
storeDeliveryNote: text("store_delivery_note"),  // shown on checkout
storeWhatsappNumber: text("store_whatsapp_number"),  // for "Order on WhatsApp" button
```

Add a unique index for slug lookup:

```typescript
// In the businesses table index array:
uniqueIndex("businesses_store_slug_idx").on(t.storeSlug),
```

Note: In cloud/multi-tenant mode, store slugs must be globally unique across all tenants. This is enforced at the application level by querying the control DB before allowing slug creation. In self-hosted mode, slugs are unique within the single tenant's businesses table, which the unique index handles.

#### `invoices` table -- no changes needed

The existing `source` column (type `text`) already supports arbitrary source identifiers. Online store orders use `source = 'online_store'`. No schema change required.

### 3.2 New Tables

#### `store_orders` table

This table holds order-specific metadata that does not belong on the invoice. It is the bridge between the anonymous store customer and the invoice system.

```typescript
// In packages/db/src/tenant-schema.ts

export const storeOrderStatusEnum = pgEnum("store_order_status", [
  "pending",      // Just placed, awaiting business confirmation
  "confirmed",    // Business accepted the order
  "rejected",     // Business declined the order
  "fulfilled",    // Order delivered/completed
  "cancelled",    // Cancelled by customer or business
]);

export const storeOrders = pgTable("store_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),

  // Order status (separate from invoice status)
  orderStatus: storeOrderStatusEnum("order_status").default("pending").notNull(),

  // Customer info (NOT a party -- lightweight, anonymous)
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  customerEmail: text("customer_email"),
  deliveryAddress: text("delivery_address"),
  deliveryCity: text("delivery_city"),
  deliveryPincode: text("delivery_pincode"),

  // Order metadata
  orderNumber: text("order_number").notNull(),  // e.g., "ORD-00001"
  orderNotes: text("order_notes"),              // customer's note
  itemCount: integer("item_count").notNull(),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull(),

  // Tracking
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("store_orders_business_idx").on(t.businessId),
  index("store_orders_invoice_idx").on(t.invoiceId),
  index("store_orders_status_idx").on(t.businessId, t.orderStatus),
  index("store_orders_date_idx").on(t.businessId, t.createdAt),
  uniqueIndex("store_orders_number_idx").on(t.businessId, t.orderNumber),
  index("store_orders_phone_idx").on(t.businessId, t.customerPhone),
]);
```

#### `store_categories` table

Dedicated store categories with ordering, separate from the freeform `category` text field on items. This allows the store to have a curated navigation structure.

```typescript
export const storeCategories = pgTable("store_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),       // URL-safe, e.g., "dairy-products"
  description: text("description"),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("store_categories_business_idx").on(t.businessId),
  uniqueIndex("store_categories_slug_idx").on(t.businessId, t.slug),
]);
```

#### `store_order_sequence` on businesses table

Rather than a separate table, add a sequence counter to the businesses table:

```typescript
// Add to businesses table:
nextStoreOrderNumber: integer("next_store_order_number").default(1).notNull(),
storeOrderPrefix: text("store_order_prefix").default("ORD").notNull(),
```

### 3.3 Relations

```typescript
// Add to tenant-schema.ts relations section:

export const storeOrdersRelations = relations(storeOrders, ({ one }) => ({
  business: one(businesses, { fields: [storeOrders.businessId], references: [businesses.id] }),
  invoice: one(invoices, { fields: [storeOrders.invoiceId], references: [invoices.id] }),
}));

export const storeCategoriesRelations = relations(storeCategories, ({ one }) => ({
  business: one(businesses, { fields: [storeCategories.businessId], references: [businesses.id] }),
}));
```

### 3.4 Entity Relationship Summary

```
businesses 1──* items              (existing)
businesses 1──* invoices           (existing)
businesses 1──* store_orders       (new)
businesses 1──* store_categories   (new)
store_orders *──1 invoices         (new: order links to its draft invoice)
items.store_category ──> store_categories.slug  (soft reference, not FK)
```

---

## 4. API Design

### 4.1 Public Store API (Hono Routes, No Auth)

These are plain Hono handlers mounted at `/store` on the existing server. They do NOT use tRPC because:
1. Store consumers are anonymous browsers, not the React admin app.
2. Responses should be CDN-cacheable (GET with Cache-Control headers).
3. The store SPA uses plain `fetch`, not the tRPC client.

#### Slug Resolution Middleware

The core challenge is resolving a public slug to a tenantId + businessId without authentication. This middleware runs on all `/store/:slug/*` routes.

```typescript
// packages/api/src/store/middleware.ts

import { getTenantDb, controlDb, tenants, businesses } from "@hisaabo/db";
import type { Context, Next } from "hono";

// Cache: slug -> { tenantId, businessId, tenantDb }  (TTL 5 min)
const slugCache = new Map<string, {
  tenantId: string;
  businessId: string;
  expires: number;
}>();

export async function resolveStoreSlug(c: Context, next: Next) {
  const slug = c.req.param("slug");
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
    return c.json({ error: "Invalid store URL" }, 400);
  }

  const now = Date.now();
  let cached = slugCache.get(slug);

  if (!cached || now > cached.expires) {
    // In self-hosted mode (single tenant), query the tenant DB directly.
    // In multi-tenant mode, we need to scan across tenants.
    // For now: query all tenant DBs is not feasible.
    // Solution: add a store_slug_registry to the control DB (see Section 8).

    // Self-hosted fast path:
    const isMultiTenant = process.env.MULTI_TENANT === "true";

    if (!isMultiTenant) {
      const db = await getTenantDb("single");
      const [biz] = await db.select({
        id: businesses.id,
      }).from(businesses)
        .where(eq(businesses.storeSlug, slug))
        .limit(1);

      if (!biz) return c.json({ error: "Store not found" }, 404);

      cached = {
        tenantId: "single",
        businessId: biz.id,
        expires: now + 5 * 60_000,
      };
    } else {
      // Multi-tenant: lookup in control DB registry (see Section 8)
      // ... registry lookup logic ...
    }

    if (cached) slugCache.set(slug, cached);
  }

  if (!cached) return c.json({ error: "Store not found" }, 404);

  // Inject resolved context for downstream handlers
  c.set("tenantId", cached.tenantId);
  c.set("businessId", cached.businessId);

  await next();
}
```

#### Route Table

```
GET  /store/:slug                     -> Store HTML shell (with OG meta tags)
GET  /store/:slug/api/catalog         -> Item catalog (paginated, filterable)
GET  /store/:slug/api/categories      -> Store categories
GET  /store/:slug/api/info            -> Business public info (name, logo, tagline)
POST /store/:slug/api/orders          -> Place an order
GET  /store/:slug/api/orders/:id      -> Order status (by order ID + phone for verification)
```

#### Endpoint Details

**GET `/store/:slug/api/catalog`**

Returns items visible on the store. Cacheable for 60 seconds.

```
Query params:
  category?: string       (filter by store_category)
  search?: string         (ILIKE on name)
  page?: number           (default 1)
  limit?: number          (default 24, max 100)

Response:
{
  business: { name, logoUrl, tagline, currency },
  items: [
    {
      id, name, description, category,
      price: "250.00",          // storePrice ?? salePrice
      unit, taxPercent, taxInclusive,
      inStock: true,            // stockQuantity > 0
    },
    ...
  ],
  categories: ["Dairy", "Snacks", ...],
  total: 150,
  page: 1,
  limit: 24
}

Headers:
  Cache-Control: public, s-maxage=60, stale-while-revalidate=300
```

**Important**: This endpoint NEVER returns `salePrice`, `purchasePrice`, `stockQuantity` (exact number), `hsn`, `sku`, cost data, or any internal business fields. Only the derived `price` and boolean `inStock`.

**POST `/store/:slug/api/orders`**

Places an order. Rate limited to 5 orders per phone number per hour.

```
Request body:
{
  customerName: string,
  customerPhone: string,      // 10-digit Indian mobile
  customerEmail?: string,
  deliveryAddress?: string,
  deliveryCity?: string,
  deliveryPincode?: string,
  notes?: string,
  items: [
    { itemId: string, quantity: number },   // quantity as number here (simple)
    ...
  ]
}

Response:
{
  orderId: "uuid",
  orderNumber: "ORD-00001",
  totalAmount: "600.00",
  message: "Order placed successfully! The business will confirm shortly."
}
```

### 4.2 Private Admin API (tRPC Procedures)

These live in a new `storeRouter` on the existing tRPC app router, protected by `businessProcedure` / `authorizedProcedure`.

```typescript
// packages/api/src/routers/store.ts

export const storeRouter = router({
  // ── Store Settings ──

  getSettings: viewerProcedure.query(/* ... */),
  // Returns: { enabled, slug, tagline, theme, accentColor, ... }

  updateSettings: adminProcedure
    .input(updateStoreSettingsSchema)
    .mutation(/* ... */),
  // Validates slug uniqueness, updates businesses row

  // ── Item Visibility ──

  listStoreItems: viewerProcedure
    .input(z.object({
      search: z.string().nullish(),
      category: z.string().nullish(),
      storeEnabled: z.boolean().nullish(),  // filter: show only enabled/disabled/all
      ...paginationSchema.shape,
    }))
    .query(/* ... */),
  // Returns items with their store_enabled flag, for the bulk toggle UI

  bulkToggleItems: memberProcedure
    .input(z.object({
      itemIds: z.array(z.string().uuid()).min(1).max(500),
      storeEnabled: z.boolean(),
    }))
    .mutation(/* ... */),
  // UPDATE items SET store_enabled = ? WHERE id IN (?) AND business_id = ?

  updateItemStoreSettings: memberProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      storePrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullish(),
      storeSortOrder: z.number().int().min(0).nullish(),
      storeCategory: z.string().max(100).nullish(),
      storeDescription: z.string().max(1000).nullish(),
    }))
    .mutation(/* ... */),

  // ── Store Categories ──

  listCategories: viewerProcedure.query(/* ... */),
  createCategory: memberProcedure.input(createStoreCategorySchema).mutation(/* ... */),
  updateCategory: memberProcedure.input(updateStoreCategorySchema).mutation(/* ... */),
  deleteCategory: adminProcedure.input(z.object({ id: z.string().uuid() })).mutation(/* ... */),
  reorderCategories: memberProcedure
    .input(z.object({ ids: z.array(z.string().uuid()) }))
    .mutation(/* ... */),

  // ── Orders ──

  listOrders: viewerProcedure
    .input(z.object({
      status: z.enum(["pending", "confirmed", "rejected", "fulfilled", "cancelled"]).nullish(),
      fromDate: z.string().datetime().nullish(),
      toDate: z.string().datetime().nullish(),
      search: z.string().nullish(),  // search by customer name/phone/order number
      ...paginationSchema.shape,
    }))
    .query(/* ... */),

  getOrder: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(/* ... */),
  // Returns order + linked invoice + line items

  confirmOrder: memberProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(/* ... */),
  // Sets order status to "confirmed", invoice status to "sent"

  rejectOrder: memberProcedure
    .input(z.object({
      orderId: z.string().uuid(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(/* ... */),
  // Sets order status to "rejected", invoice status to "cancelled"

  fulfillOrder: memberProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(/* ... */),
  // Sets order status to "fulfilled"
});
```

Add to the app router:

```typescript
// packages/api/src/router.ts
import { storeRouter } from "./routers/store.js";

export const appRouter = router({
  // ... existing routers ...
  store: storeRouter,
});
```

### 4.3 Permission Model

Add `"Store"` to the CASL resource list in `packages/api/src/lib/permissions.ts`:

```typescript
export type Resource =
  | "Invoice" | "Payment" | "Party" | "Item" | "Expense"
  | "BankAccount" | "BankTransaction"
  | "Business" | "Team" | "Import" | "Report" | "GstReport"
  | "Store"   // NEW
  | "all";
```

Permission mapping:
- `superadmin` / `admin`: manage Store (enable/disable, settings, all order actions)
- `seller_manager`: create/read/update Store (toggle items, confirm orders)
- `seller`: read Store (view orders)
- `accountant`: read Store (view orders for reconciliation)

---

## 5. Frontend Architecture

### 5.1 Store App (`apps/store`)

A minimal React SPA. Separate from the admin app (`apps/web`) because:
1. Different users (anonymous customers vs authenticated business owners).
2. Different performance budget (store must be tiny; admin can be larger).
3. Different routing (store is a single page with client-side cart state, not a file-based router).

**Tech stack:**
- React 19 (shared with admin app)
- Vite (separate config)
- Tailwind CSS (shared config/design tokens from the monorepo)
- No TanStack Router (single "page" with tabs/filters)
- No TanStack Query (simple `fetch` + `useState`/`useReducer` for catalog)
- No tRPC client (plain `fetch` to `/store/:slug/api/*`)
- Cart state in `localStorage` + React context

**Bundle budget:** Under 50KB gzipped (React + app code). This is achievable because we exclude TanStack Router (~15KB), TanStack Query (~12KB), tRPC (~8KB), and SuperJSON (~4KB).

**Directory structure:**
```
apps/store/
  index.html
  vite.config.ts
  src/
    main.tsx              -- Entry point, reads slug from URL
    App.tsx               -- Layout: header, catalog, cart drawer
    api.ts                -- fetch wrappers for /store/:slug/api/*
    cart.tsx              -- Cart context + localStorage persistence
    components/
      StoreHeader.tsx     -- Business name, logo, search
      CategoryNav.tsx     -- Horizontal scrollable category pills
      ItemGrid.tsx        -- Product card grid
      ItemCard.tsx        -- Single product card with +/- buttons
      CartDrawer.tsx      -- Slide-out cart with order form
      OrderForm.tsx       -- Name, phone, address fields
      OrderConfirmation.tsx  -- "Order placed!" screen
    hooks/
      useCatalog.ts       -- Fetch + cache catalog data
      useStoreInfo.ts     -- Fetch business info
```

**Build output:** `apps/store/dist/` -- static files served by the API server (or CDN in cloud mode).

### 5.2 Admin UI (in `apps/web`)

The store management UI lives in the existing admin app as a new route and settings tab.

#### New route: `/store`

A dedicated page for managing the online store. This is where bulk item toggling and order management live.

```
apps/web/src/routes/
  store.tsx               -- Main store management page (tabs: Items, Orders, Settings)
```

#### Settings tab: "Online Store"

Add a new tab to the existing Settings page for store configuration (enable/disable, slug, theme, etc.).

```
apps/web/src/components/settings/
  StoreTab.tsx            -- Store enable/disable, slug config, theme picker
```

#### New components:

```
apps/web/src/components/store/
  StoreItemManager.tsx    -- Bulk item visibility manager (the main UI)
  StoreItemRow.tsx        -- Single item row with toggle, price override, category
  StoreOrderList.tsx      -- Order list with status badges
  StoreOrderDetail.tsx    -- Order detail with confirm/reject actions
  StoreCategoryManager.tsx -- Category CRUD with drag-and-drop ordering
```

---

## 6. Store Page Design

### 6.1 Store HTML Shell

The Hono server renders a minimal HTML page for SEO. This is NOT full SSR -- it is a static shell with meta tags populated from the business data, plus a `<script>` tag that bootstraps the store SPA.

```
GET /store/:slug  ->  HTML response:

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{Business Name} - Online Store</title>
  <meta name="description" content="{Business tagline or 'Shop online at {name}'}" />
  <meta property="og:title" content="{Business Name}" />
  <meta property="og:description" content="{tagline}" />
  <meta property="og:image" content="{logo URL}" />
  <meta property="og:type" content="website" />
  <link rel="stylesheet" href="/store/assets/store.css" />

  <!-- Structured data for Google -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Store",
    "name": "{Business Name}",
    "url": "https://store.hisaabo.in/{slug}"
  }
  </script>
</head>
<body>
  <div id="root"></div>
  <script>window.__STORE_SLUG__ = "{slug}";</script>
  <script type="module" src="/store/assets/store.js"></script>
</body>
</html>
```

### 6.2 Store Page Wireframe (Detailed)

```
MOBILE (375px)                          DESKTOP (1280px)
================================        ================================================

[Logo]  Business Name                   [Logo]  Business Name
         Tagline text                            Tagline text
--------------------------------        ------------------------------------------------
[  Search items...            ]         [  Search items...            ]  [Category pills >]
[All] [Dairy] [Snacks] [Drinks]
--------------------------------        ------------------------------------------------
                                        |                                               |
+----------+  +----------+             | +--------+ +--------+ +--------+ +--------+   |
| [  img  ]|  | [  img  ]|             | |[  img ]| |[  img ]| |[  img ]| |[  img ]|   |
| Item A   |  | Item B   |             | |Item A  | |Item B  | |Item C  | |Item D  |   |
| per kg   |  | per pcs  |             | |per kg  | |per pcs | |per l   | |per box |   |
| Rs 250   |  | Rs 45    |             | |Rs 250  | |Rs 45   | |Rs 80   | |Rs 320  |   |
| [ + Add ]|  | [ + Add ]|             | |[+ Add ]| |[+ Add ]| |[+ Add ]| |[+ Add ]|   |
+----------+  +----------+             | +--------+ +--------+ +--------+ +--------+   |
                                        |                                               |
+----------+  +----------+             | +--------+ +--------+ +--------+ +--------+   |
| [  img  ]|  | [  img  ]|             | |[  img ]| |[  img ]| |[  img ]| |[  img ]|   |
| Item C   |  | Item D   |             | |Item E  | |Item F  | |Item G  | |Item H  |   |
| ...      |  | ...      |             | |...     | |...     | |...     | |...     |   |
+----------+  +----------+             | +--------+ +--------+ +--------+ +--------+   |
                                        |                                               |
================================        ================================================

--- After adding items ---               --- Cart is a side panel on desktop ---

+-------------------------------+       +----------------------------+  +-----------+
| FLOATING CART BAR             |       | Catalog grid               |  | CART      |
| Cart (3 items) - Rs 600      |       |                            |  |           |
| [View Cart -->]               |       |                            |  | Item A x2 |
+-------------------------------+       |                            |  |   Rs 500  |
                                        |                            |  | Item B x1 |
--- Cart drawer (slides up) ---         |                            |  |   Rs 45   |
                                        |                            |  |-----------|
+-------------------------------+       |                            |  | Total     |
| YOUR ORDER                    |       |                            |  | Rs 545    |
|-------------------------------|       |                            |  |           |
| Item A              x2  Rs500|       |                            |  | [Place    |
|  [- 2 +]            Remove   |       |                            |  |  Order]   |
| Item B              x1  Rs 45|       |                            |  +-----------+
|  [- 1 +]            Remove   |
|-------------------------------|
| Subtotal              Rs 545 |
| Tax (18%)             Rs  98 |
| Total                 Rs 643 |
|-------------------------------|
| Your Details                  |
| Name*    [_______________]   |
| Phone*   [_______________]   |
| Address  [_______________]   |
| City     [_______] Pin[____]|
| Notes    [_______________]   |
|                               |
| [     PLACE ORDER      ]     |
+-------------------------------+
```

### 6.3 After Order Placement

```
+-------------------------------+
|          [checkmark]          |
|     Order Placed!             |
|                               |
|  Order #ORD-00042             |
|  Total: Rs 643                |
|                               |
|  {Business Name} will confirm |
|  your order shortly. You'll   |
|  receive updates on WhatsApp. |
|                               |
|  [Continue Shopping]          |
|  [Contact on WhatsApp]        |
+-------------------------------+
```

---

## 7. Admin UI Design

### 7.1 Store Management Page (`/store` route)

Tab layout with three sections: Items, Orders, Settings.

```
/store
================================

Store Management                [Store URL: store.hisaabo.in/mithai-palace  (copy)]

[Items]  [Orders (3 new)]  [Categories]  [Settings]

--- ITEMS TAB ---

+---------------------------------------------------------------+
| Manage Store Items                [Enable All] [Disable All]  |
|---------------------------------------------------------------|
| [Search items...]  [Category: All v]  [Show: All / On / Off] |
|---------------------------------------------------------------|
| [ ] | Item Name          | Sale Price | Store Price | Cat   | |
|-----|--------------------+------------+-------------+-------|  |
| [x] | Kaju Katli         | Rs 800/kg  | Rs 750/kg   | Sweets| |
| [x] | Gulab Jamun        | Rs 400/kg  | --           | Sweets| |
| [ ] | Rasgulla           | Rs 350/kg  | --           | --    | |
| [x] | Samosa             | Rs 20/pcs  | Rs 18/pcs   | Snacks| |
| [ ] | Chai Masala         | Rs 150/pkt | --           | --    | |
|---------------------------------------------------------------|
| Selected: 2 items                                             |
| [Enable for Store]  [Disable from Store]  [Set Category]      |
+---------------------------------------------------------------+
| Showing 1-20 of 156 items              [< 1 2 3 4 5 ... >]  |
+---------------------------------------------------------------+
```

**Key UX patterns:**
- Checkbox column for multi-select. Shift-click for range select.
- "Enable All" / "Disable All" with confirmation dialog (operates on current filter, not all items).
- Inline editing for Store Price (click to edit, Enter to save).
- Bulk "Set Category" action: opens a dropdown to assign a store category to selected items.
- The "Show: On/Off" filter lets the user quickly see which items are already listed vs not.

### 7.2 Orders Tab

```
--- ORDERS TAB ---

+---------------------------------------------------------------+
| Online Orders                                                 |
|---------------------------------------------------------------|
| [Status: All v]  [Date: Last 7 days v]  [Search...]          |
|---------------------------------------------------------------|
| #ORD-00042 | Rahul Sharma    | Rs 643  | Pending  | 2 min ago|
|            | 98765 43210     | 3 items | [Confirm] [Reject]  |
|---------------------------------------------------------------|
| #ORD-00041 | Priya Patel     | Rs 1200 | Confirmed| 1 hr ago |
|            | 98765 43211     | 5 items | [Mark Fulfilled]    |
|---------------------------------------------------------------|
| #ORD-00040 | Amit Kumar      | Rs 320  | Fulfilled| Yesterday|
|            | 98765 43212     | 2 items |                      |
+---------------------------------------------------------------+
```

Clicking an order expands to show:
- Line items with quantities and prices
- Customer details (name, phone, address)
- Linked invoice number (clickable, opens invoice detail)
- Action buttons: Confirm / Reject / Mark Fulfilled
- Rejection requires a reason (optional text field)

### 7.3 Settings Tab Content (Store Section)

```
--- SETTINGS > ONLINE STORE ---

+---------------------------------------------------------------+
| Online Store                                                  |
|---------------------------------------------------------------|
| Enable Store    [====ON====]                                  |
|                                                               |
| Store URL                                                     |
| store.hisaabo.in/ [mithai-palace    ] [Check Availability]    |
| (lowercase letters, numbers, hyphens only)                    |
|                                                               |
| Tagline                                                       |
| [Premium sweets & snacks since 1985_________]                |
|                                                               |
| Minimum Order Amount                                          |
| Rs [200_____]  (leave empty for no minimum)                   |
|                                                               |
| Delivery Note (shown at checkout)                             |
| [Free delivery above Rs 500. Otherwise Rs 50 delivery charge]|
|                                                               |
| WhatsApp Number (for "Order on WhatsApp" button)              |
| [+91 98765 43210_____]                                        |
|                                                               |
| Theme                                                         |
| (o) Default  ( ) Minimal  ( ) Bold                            |
|                                                               |
| Accent Color                                                  |
| [#4F46E5] [color picker swatch]                               |
|                                                               |
|                                      [Save Changes]          |
+---------------------------------------------------------------+
```

---

## 8. Routing and Subdomain Strategy

### 8.1 Self-Hosted Mode

In self-hosted mode, the store is served from the same origin as the admin app:

```
http://localhost:3000/store/:slug          -- Store HTML shell
http://localhost:3000/store/:slug/api/*    -- Store API
http://localhost:3000/api/trpc/*           -- Admin tRPC (existing)
http://localhost:5173/                      -- Admin SPA (Vite dev server)
```

The store SPA's static assets (`/store/assets/*`) are served by the Hono server in production (from `apps/store/dist/`). In development, a second Vite dev server on port 5174 serves the store, and the Hono server proxies to it.

### 8.2 Cloud Mode

In cloud mode, there are two domains:

```
app.hisaabo.in          -- Admin SPA (served by CDN, API proxied to backend)
store.hisaabo.in/:slug  -- Store pages (served by CDN, API proxied to backend)
```

Cookie isolation is automatic because different domains cannot share cookies. The store domain has no session cookies.

### 8.3 Multi-Tenant Slug Resolution

In multi-tenant mode, the store slug must be globally unique across all tenants. We need a fast lookup from slug to tenantId + businessId.

**Option A: Control DB registry table**

Add a `store_slug_registry` table to the control DB:

```typescript
// In packages/db/src/control-schema.ts

export const storeSlugRegistry = pgTable("store_slug_registry", {
  slug: text("slug").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  businessId: uuid("business_id").notNull(),  // No FK -- lives in tenant DB
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

This table is updated whenever a business sets or changes their store slug (via the admin API). The public store middleware queries this table to resolve the slug, then calls `getTenantDb(tenantId)` to get the tenant database.

**Why this works:** The control DB is shared across all tenants and is the natural place for cross-tenant lookups. The table is tiny (one row per store-enabled business) and easily cacheable in memory.

### 8.4 Hono Route Registration

```typescript
// In packages/api/src/server.ts, add before the tRPC handler:

import { storeRoutes } from "./store/routes.js";

// Store routes -- public, no auth
app.route("/store", storeRoutes);
```

```typescript
// packages/api/src/store/routes.ts

import { Hono } from "hono";
import { resolveStoreSlug } from "./middleware.js";
import { catalogHandler } from "./handlers/catalog.js";
import { orderHandler } from "./handlers/order.js";
import { infoHandler } from "./handlers/info.js";
import { shellHandler } from "./handlers/shell.js";

const store = new Hono();

// Rate limit: 120 req/min for catalog browsing, 5 req/min for order placement
store.use("/:slug/api/orders", orderRateLimit);
store.use("/:slug/*", resolveStoreSlug);

store.get("/:slug/api/catalog", catalogHandler);
store.get("/:slug/api/categories", categoriesHandler);
store.get("/:slug/api/info", infoHandler);
store.post("/:slug/api/orders", orderHandler);

// HTML shell -- must be last (catch-all for the SPA)
store.get("/:slug", shellHandler);
store.get("/:slug/*", shellHandler);  // SPA client-side routes

export { store as storeRoutes };
```

### 8.5 CORS for Store Routes

Store routes need their own CORS config. In cloud mode, the store SPA is served from `store.hisaabo.in` and the API is at the same origin, so CORS is not needed (same-origin). In self-hosted mode, same thing.

However, if a business uses a custom domain (Phase 2), the store SPA at `custom.example.com` needs CORS to access `store.hisaabo.in/:slug/api/*`. This is handled per-request by checking the `custom_domain` field in store settings.

For Phase 1: no additional CORS configuration needed since the store SPA and API share the same origin.

---

## 9. Order Flow

### 9.1 Happy Path: Customer Places Order

```
Customer (Store SPA)                    API Server                          Database
        |                                   |                                  |
        |  GET /store/mithai-palace/api/catalog                                |
        |---------------------------------->|                                  |
        |                                   |  SELECT items WHERE              |
        |                                   |  store_enabled = true            |
        |                                   |  AND business_id = ?             |
        |                                   |--------------------------------->|
        |        { items: [...] }           |<---------------------------------|
        |<----------------------------------|                                  |
        |                                   |                                  |
        |  [Customer browses, adds to cart -- all client-side]                 |
        |                                   |                                  |
        |  POST /store/mithai-palace/api/orders                                |
        |  { customerName, phone, items }   |                                  |
        |---------------------------------->|                                  |
        |                                   |  BEGIN TRANSACTION               |
        |                                   |                                  |
        |                                   |  1. Validate all item IDs exist  |
        |                                   |     and are store_enabled         |
        |                                   |                                  |
        |                                   |  2. Calculate totals using       |
        |                                   |     calcInvoiceTotals()           |
        |                                   |                                  |
        |                                   |  3. Find or create "Walk-in"     |
        |                                   |     party for the business        |
        |                                   |                                  |
        |                                   |  4. Atomic: get next invoice     |
        |                                   |     number + next order number   |
        |                                   |                                  |
        |                                   |  5. INSERT invoice               |
        |                                   |     (type=sale, status=draft,    |
        |                                   |      source='online_store')      |
        |                                   |                                  |
        |                                   |  6. INSERT invoice_items         |
        |                                   |                                  |
        |                                   |  7. INSERT store_orders          |
        |                                   |     (links to invoice,           |
        |                                   |      customer details)           |
        |                                   |                                  |
        |                                   |  8. Stock NOT decremented yet    |
        |                                   |     (only on confirmation)       |
        |                                   |                                  |
        |                                   |  COMMIT                          |
        |                                   |--------------------------------->|
        |                                   |                                  |
        |                                   |  9. Queue notification           |
        |                                   |     (in-app + WhatsApp later)    |
        |                                   |                                  |
        |  { orderId, orderNumber,          |                                  |
        |    totalAmount, message }         |                                  |
        |<----------------------------------|                                  |
```

### 9.2 Business Confirms Order

```
Admin App                               API Server                          Database
    |                                       |                                  |
    |  trpc.store.confirmOrder              |                                  |
    |  { orderId }                          |                                  |
    |-------------------------------------->|                                  |
    |                                       |  BEGIN TRANSACTION               |
    |                                       |                                  |
    |                                       |  1. UPDATE store_orders           |
    |                                       |     SET order_status='confirmed'  |
    |                                       |     confirmed_at = NOW()          |
    |                                       |                                  |
    |                                       |  2. UPDATE invoices               |
    |                                       |     SET status = 'sent'           |
    |                                       |                                  |
    |                                       |  3. Decrement stock quantities    |
    |                                       |     (same logic as invoice.create)|
    |                                       |                                  |
    |                                       |  COMMIT                          |
    |                                       |--------------------------------->|
    |                                       |                                  |
    |                                       |  4. Queue notification to         |
    |                                       |     customer (WhatsApp, Phase 2) |
    |                                       |                                  |
    |  { success: true }                    |                                  |
    |<--------------------------------------|                                  |
```

**Key design decisions in the order flow:**

1. **Stock is NOT decremented on order placement.** It is decremented on confirmation. This prevents customers from "reserving" stock by placing orders they never follow through on. The store shows `inStock: boolean` but not exact quantities.

2. **"Walk-in Customer" party.** Orders use a single "Walk-in Customer" party per business (auto-created on first order). The actual customer details live in `store_orders`. This avoids polluting the parties table with one-time store customers. In Phase 2, if a phone number has ordered 3+ times, the system can offer to create a proper party.

3. **Invoice numbering follows the existing atomic pattern.** The order placement handler calls the same `SELECT ... FOR UPDATE` + increment pattern used in the invoice router. This is extracted to a shared function.

4. **Tax calculation uses the existing `calcInvoiceTotals`.** The store API handler imports `calcLineItem` and `calcInvoiceTotals` from `@hisaabo/shared`. The store price (or sale price if no store price) is used as the unit price. The item's `taxPercent` and `taxInclusive` flags are respected.

### 9.3 Business Rejects Order

```
1. UPDATE store_orders SET order_status = 'rejected', rejection_reason = ?
2. UPDATE invoices SET status = 'cancelled'
3. No stock changes (stock was never decremented)
4. Notify customer (Phase 2)
```

### 9.4 Edge Cases

**Out of stock during order placement:**
- The order handler checks `stockQuantity > 0` for each item at order time.
- If an item is out of stock, the order is rejected with a message listing which items are unavailable.
- This is a point-in-time check, not a reservation. Two simultaneous orders for the last item can both succeed at the order level -- the business resolves the conflict when confirming.

**Business disables store after orders are pending:**
- Existing pending orders remain in the queue. The business can still confirm/reject them.
- New orders are blocked (the catalog endpoint returns 404 when `storeEnabled = false`).

**Item removed from store after it is in someone's cart:**
- The order handler validates each item is still `storeEnabled`. If not, the order is rejected with a clear error message.

---

## 10. Notification Flow

### 10.1 Phase 1: In-App Notifications

No separate notifications table in Phase 1. Instead:

1. The admin dashboard shows a "New Online Orders" badge count (query `store_orders WHERE order_status = 'pending'`).
2. The `/store` route in the admin app has a "Orders (N new)" tab badge.
3. Polling: the admin SPA polls `trpc.store.listOrders` every 30 seconds when the store page is open (via `refetchInterval` on TanStack Query).

This is intentionally simple. A real-time notification system (WebSockets, SSE) is Phase 2.

### 10.2 Phase 2: Push Notifications

```
Order Placed
    |
    v
Notification Queue (in-memory or Redis in cloud)
    |
    +--> In-App: WebSocket push to admin app (if connected)
    |
    +--> WhatsApp Business API: Send template message to business owner
    |
    +--> (Order confirmed) WhatsApp to customer: "Your order has been confirmed!"
```

### 10.3 Phase 3: Email Notifications

- Order confirmation email to customer (with order summary).
- Daily digest to business owner (summary of orders received).

---

## 11. Security

### 11.1 Data Isolation

The public store API must NEVER expose:
- `purchasePrice` (cost data)
- `stockQuantity` (exact number -- only boolean `inStock`)
- `hsn`, `sku` (internal codes)
- `salePrice` when a `storePrice` is set (the store price is the public price)
- Any data from other tables (invoices, payments, expenses, parties, bank accounts)
- Business-sensitive fields (GSTIN, PAN, bank details) -- only name, logo, tagline
- Other businesses' data (even within the same tenant)

This is enforced by:
1. The store API handlers explicitly SELECT only safe columns (allowlist, not denylist).
2. No use of `SELECT *` in store routes.
3. The store SPA never has access to the tRPC client or admin API.

### 11.2 Rate Limiting

Store routes have their own rate limits, separate from the tRPC rate limiter:

| Endpoint | Limit | Key |
|----------|-------|-----|
| `GET /store/:slug/api/catalog` | 120 req/min | IP |
| `GET /store/:slug/api/info` | 120 req/min | IP |
| `POST /store/:slug/api/orders` | 5 req/min | IP + phone number |
| `GET /store/:slug/api/orders/:id` | 30 req/min | IP |

The order placement limit is per phone number to prevent spam. The phone number is hashed before use as a rate limit key to avoid storing PII in the rate limit map.

### 11.3 Input Validation

All store API inputs are validated with Zod schemas (defined in `@hisaabo/shared`):

```typescript
// In packages/shared/src/validators.ts

export const placeStoreOrderSchema = z.object({
  customerName: z.string().min(1).max(200),
  customerPhone: z.string().regex(/^[6-9]\d{9}$/, "Valid 10-digit Indian mobile number"),
  customerEmail: z.string().email().max(255).optional(),
  deliveryAddress: z.string().max(500).optional(),
  deliveryCity: z.string().max(100).optional(),
  deliveryPincode: z.string().regex(/^\d{6}$/).optional(),
  notes: z.string().max(500).optional(),
  items: z.array(z.object({
    itemId: z.string().uuid(),
    quantity: z.number().int().positive().max(9999),
  })).min(1).max(50),
});
```

### 11.4 CSRF Protection

Since the store uses plain `fetch` (not cookie-based auth), CSRF is not a concern for the store API. The order endpoint is protected by:
1. Rate limiting (5/min per phone).
2. Phone number validation (must be a valid Indian mobile number).
3. No sensitive actions (placing an order is not destructive -- the business must confirm).

**Security model invariant (store POSTs):** the global CSRF middleware at `packages/api/src/server.ts` intentionally skips every `/store/*` path (`skipPathPrefixes: ["/api/trpc/", "/store/"]`). The exemption is correct only while the two layers below remain the protection model: (a) server-side Turnstile verification on `POST /store/:slug/identify` and `POST /store/:slug/order`, (b) per-IP rate limit (20/min per path) plus the existing per-phone 5/min cap on `order`, and (c) the Origin/Referer allow-list in `packages/api/src/lib/store-origin.ts`. The store SPA calls both endpoints with `credentials: "omit"` so the admin `session_id` cookie never rides along on a same-origin self-hosted deploy. If an authenticated `/store/*` endpoint is ever added (for example `POST /store/:slug/fulfill` reading the admin session), the `/store/` entry in the CSRF skip list must be narrowed to an explicit allow-list of public paths before that change merges.

### 11.5 Bot / Spam Protection

Phase 1: Rate limiting + phone validation is sufficient for launch.

Phase 2: Add a simple proof-of-work challenge or invisible reCAPTCHA to the order form. A honeypot field (hidden input that bots fill) is a zero-cost addition in Phase 1.

---

## 12. Performance and Caching

### 12.1 Catalog Caching Strategy

The store catalog is the hottest path. It must be fast.

**Layer 1: CDN (Cloudflare, cloud mode only)**
- `GET /store/:slug/api/catalog` responds with `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.
- CDN caches the response for 60 seconds, serves stale for up to 5 minutes while revalidating.
- Cache key: `slug + category + search + page`.

**Layer 2: Application-level cache (both modes)**
- The catalog handler maintains an in-memory cache per business (TTL: 60 seconds).
- Cache is invalidated when `bulkToggleItems` or `updateItemStoreSettings` is called (via a simple version counter).

**Layer 3: Database query optimization**
- The `items_store_idx` index on `(business_id, store_enabled)` makes the catalog query fast.
- For large catalogs (1000+ items), use cursor-based pagination instead of offset.

### 12.2 Store SPA Performance

- **Bundle size:** Under 50KB gzipped. No heavy dependencies.
- **Code splitting:** None needed (the store is a single page).
- **Image optimization:** Phase 2 (when item images are supported). For now, placeholder/no-image icons.
- **Font:** Inherit the system font stack for the store (no custom font load). The admin app uses DM Sans, but the store should not require a 50KB font download.

### 12.3 Database Performance

New indexes added:
- `items_store_idx` on `(business_id, store_enabled)` -- catalog query.
- `store_orders_business_idx`, `store_orders_status_idx`, `store_orders_date_idx` -- order listing.
- `store_orders_phone_idx` on `(business_id, customer_phone)` -- repeat customer lookup.
- `businesses_store_slug_idx` (unique) -- slug resolution.
- `store_slug_registry` primary key on slug -- multi-tenant slug resolution.

### 12.4 Performance Budget

| Metric | Target | How |
|--------|--------|-----|
| Store page first paint | < 500ms | CDN + small bundle + no custom fonts |
| Catalog API response | < 100ms (p95) | Index + cache + simple query |
| Order placement | < 500ms | Single transaction, no external calls |
| Admin order list load | < 200ms | Paginated, indexed |

---

## 13. Future Extensibility

### 13.1 Third-Party Store Integration (Shopify, WooCommerce)

The `source` field on invoices already supports this pattern. Future integrations:

```
source = "online_store"     -- Hisaabo's own store
source = "shopify"          -- Shopify webhook
source = "woocommerce"      -- WooCommerce webhook
source = "amazon"           -- Amazon Seller API
```

Each integration creates invoices through the same pipeline. A new `integrations` table would store API keys and webhook URLs:

```typescript
// Future: packages/db/src/tenant-schema.ts
export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").references(() => businesses.id),
  provider: text("provider").notNull(),  // "shopify", "woocommerce"
  config: jsonb("config"),               // encrypted API keys, store URL, etc.
  isActive: boolean("is_active").default(true),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

Webhook handlers would be additional Hono routes: `POST /webhooks/shopify/:businessId`, etc.

### 13.2 Payment Gateway (Razorpay / Cashfree)

When payment is added:
1. The store checkout gets a "Pay Online" option alongside "Pay on Delivery".
2. Order placement creates a Razorpay order (via their API) and returns the order ID.
3. The store SPA opens the Razorpay checkout widget.
4. On payment success, a webhook handler records the payment.
5. The invoice is auto-confirmed and a payment record is created against it.

Schema additions:
```typescript
// On store_orders:
paymentMethod: text("payment_method"),  // "cod", "razorpay", "cashfree"
paymentId: text("payment_id"),          // external payment ID
paymentStatus: text("payment_status"),  // "pending", "paid", "failed"
```

### 13.3 Inventory Sync

The store already reads `stockQuantity` to compute `inStock`. For real-time inventory:
1. `inStock` becomes a computed field: `stockQuantity > 0`.
2. Stock decrements on order confirmation (already in the design).
3. A `lowStockThreshold` per item triggers a warning in the admin UI.
4. Real-time stock updates push to the store via SSE or polling (Phase 2).

### 13.4 Store Theme Customization

The `storeTheme` and `storeAccentColor` fields on businesses enable basic theming. Future:
- Additional theme options (header layout, card style, footer content).
- Custom CSS injection (stored in a `storeCustomCss` text column -- sandboxed).
- Banner images and promotional sections.

### 13.5 Item Images

When item images are added:
1. New `item_images` table: `itemId, url, sortOrder, altText`.
2. Images uploaded to object storage (S3/R2).
3. Store catalog includes `images: [{ url, alt }]` array.
4. CDN serves images with automatic resizing (Cloudflare Images or similar).

---

## 14. Migration Path

### Phase 1: Core Store (Target: 2-3 weeks of development)

**Week 1: Schema + API**
1. Add new columns to `items` and `businesses` tables (schema change + migration).
2. Create `store_orders` and `store_categories` tables.
3. Add `store_slug_registry` to control schema (multi-tenant).
4. Implement public store Hono routes: catalog, info, order placement.
5. Implement `storeRouter` tRPC procedures: settings, bulk toggle, order management.
6. Add `placeStoreOrderSchema` and related validators to `@hisaabo/shared`.

**Week 2: Admin UI**
7. Create `StoreTab` in settings (enable/disable, slug, theme).
8. Create `/store` route with Items and Orders tabs.
9. Build `StoreItemManager` with bulk toggle, search, filter.
10. Build `StoreOrderList` and `StoreOrderDetail` with confirm/reject.
11. Add store order count badge to sidebar navigation.

**Week 3: Store Frontend**
12. Set up `apps/store` with Vite + React.
13. Build store SPA: catalog grid, category filter, search.
14. Build cart (localStorage persistence, quantity adjustment).
15. Build order form and confirmation screen.
16. Wire up Hono HTML shell handler for SEO meta tags.
17. End-to-end testing: place order, confirm in admin, verify invoice.

### Phase 2: Polish + Scale (4-6 weeks after Phase 1)

- Custom domains (CNAME + CDN config).
- WhatsApp notifications (Business API integration).
- Real-time order notifications (WebSocket/SSE).
- Store page SSR for better SEO.
- Item images.
- Store analytics (views, orders, conversion rate).

### Phase 3: Monetization + Integrations (Ongoing)

- Payment gateway integration (Razorpay/Cashfree).
- Shopify/WooCommerce webhooks.
- Store as a premium feature (free tier: 20 items, paid: unlimited).
- Advanced themes and customization.

### Migration Commands

```bash
# After implementing schema changes:
pnpm db:generate    # Generate Drizzle migration files
pnpm db:migrate     # Apply to database

# Development:
pnpm db:push        # Push schema directly (dev mode, no migrations)
```

### Backward Compatibility

All schema changes are additive (new columns with defaults, new tables). No existing columns or tables are modified. Existing features continue to work without changes. The store is opt-in per business (`storeEnabled` defaults to false).

---

## Appendix A: File Inventory

New and modified files required for Phase 1:

```
Modified files:
  packages/db/src/tenant-schema.ts         -- Add columns to items + businesses, new tables
  packages/db/src/control-schema.ts        -- Add store_slug_registry (multi-tenant)
  packages/shared/src/validators.ts        -- Add store-related Zod schemas
  packages/api/src/server.ts               -- Mount /store routes
  packages/api/src/router.ts               -- Add storeRouter
  packages/api/src/lib/permissions.ts      -- Add "Store" resource
  apps/web/src/routes/settings.tsx         -- Add Store tab
  apps/web/src/components/settings/SettingsNav.tsx  -- Add Store nav item

New files (API):
  packages/api/src/routers/store.ts        -- tRPC store router
  packages/api/src/store/routes.ts         -- Public Hono store routes
  packages/api/src/store/middleware.ts      -- Slug resolution middleware
  packages/api/src/store/handlers/catalog.ts
  packages/api/src/store/handlers/order.ts
  packages/api/src/store/handlers/info.ts
  packages/api/src/store/handlers/shell.ts
  packages/api/src/store/handlers/categories.ts

New files (Admin UI):
  apps/web/src/routes/store.tsx
  apps/web/src/components/settings/StoreTab.tsx
  apps/web/src/components/store/StoreItemManager.tsx
  apps/web/src/components/store/StoreItemRow.tsx
  apps/web/src/components/store/StoreOrderList.tsx
  apps/web/src/components/store/StoreOrderDetail.tsx
  apps/web/src/components/store/StoreCategoryManager.tsx

New app (Store SPA):
  apps/store/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/main.tsx
    src/App.tsx
    src/api.ts
    src/cart.tsx
    src/components/StoreHeader.tsx
    src/components/CategoryNav.tsx
    src/components/ItemGrid.tsx
    src/components/ItemCard.tsx
    src/components/CartDrawer.tsx
    src/components/OrderForm.tsx
    src/components/OrderConfirmation.tsx
    src/hooks/useCatalog.ts
    src/hooks/useStoreInfo.ts
```

## Appendix B: Open Questions

1. **Minimum order amount enforcement**: Should this be enforced server-side (reject orders below minimum) or just shown as a warning in the store UI? Recommendation: Server-side enforcement with a clear error message.

2. **Repeat customer handling**: When the same phone number places multiple orders, should we auto-create a party after N orders? Recommendation: Phase 2, with a "Convert to Party" button in the admin order detail view.

3. **Store item limit for free tier**: How many items can a free-tier business list on their store? Recommendation: 50 items for free tier, unlimited for paid. Enforce in the `bulkToggleItems` mutation.

4. **Order expiry**: Should pending orders auto-cancel after N hours? Recommendation: Yes, auto-cancel after 48 hours with a notification to the business. Implement as a scheduled task (like the existing session cleanup).

5. **Multi-language support**: Should the store support Hindi/regional languages? Recommendation: Phase 3. The architecture supports it (store settings would include `storeLanguage`, and the store SPA would use i18n). Not a priority for launch.
