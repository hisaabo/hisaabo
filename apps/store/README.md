# @hisaabo/store

The public-facing online storefront for Hisaabo businesses. A lightweight React 19 SPA that customers visit to browse a business's catalog and place orders — no login required.

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS-v4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

---

## What this app does

Every Hisaabo business can enable a public storefront at `store.hisaabo.in/<slug>`. The store app reads the business slug from the URL path, fetches the catalog from the API, and renders a mobile-first product listing with cart and checkout.

When a customer places an order, the API creates an unfulfilled invoice in the business's Hisaabo account. The business owner then fulfills and marks it from the web dashboard.

**Features:**
- Product catalog with category grouping and custom sort order
- Item variants and alternate unit support (e.g., order by kg or by packet)
- Cart with quantity controls and real-time total calculation in INR
- Phone-number-verified checkout with Cloudflare Turnstile bot protection
- Minimum order amount enforcement
- WhatsApp notification to the business owner on new orders
- Business-defined accent color, tagline, and delivery notes
- Auto-generated Privacy Policy, Terms of Service, and Refund Policy pages
- Mobile-first, no-dependency design

---

## Running locally

```bash
# From monorepo root
pnpm --filter @hisaabo/store dev

# Or from this directory
pnpm dev
```

The store dev server starts at `http://localhost:5174`. To test with a real business, you need a running API and a business with the store enabled and a `storeSlug` set. Navigate to `http://localhost:5174/<your-store-slug>`.

To enable a business's store, go to **Settings > Online Store** in the web dashboard and toggle it on.

---

## Building

```bash
pnpm --filter @hisaabo/store build
# Output: apps/store/dist/
```

---

## Deployment

The store is a static SPA deployed to Cloudflare Pages:

| Setting | Value |
|---|---|
| Build command | `pnpm --filter @hisaabo/store build` |
| Output directory | `apps/store/dist` |
| Node.js version | 20 |

Set this environment variable in Cloudflare Pages:

| Variable | Description |
|---|---|
| `VITE_API_URL` | Base URL of the API server (e.g., `https://api.yourdomain.com`) |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key for order form bot protection |

The store fetches catalog data from the API at `/store/<slug>/catalog.json` and posts orders to `/store/<slug>/order`. These are REST endpoints (not tRPC) defined in `packages/api/src/server.ts` — they are public and do not require authentication.

---

## How it works

### Catalog fetch

On load, the app reads the slug from the URL path and calls `GET /store/<slug>/catalog.json`. This returns the business's public store config: name, accent color, tagline, items grouped by category, store policies, and store settings.

```typescript
// apps/store/src/api.ts
const catalog = await fetchCatalog(slug);
// catalog.items, catalog.categories, catalog.config, ...
```

If the slug is not found or the store is disabled, the API returns 404 and the app shows a "Store not found" page.

### Order placement

The checkout form collects the customer's name, phone, optional email, and delivery address. On submission, the app sends a POST request to `/store/<slug>/order` with the cart contents and a Cloudflare Turnstile verification token.

The API validates the token, creates an unfulfilled invoice in the business database, and (if configured) sends a WhatsApp message to the business's `storeWhatsappNumber`.

### Variants and alternate units

Items with `itemMode: "variants"` display a variant selector (e.g., size, colour). Items with `itemMode: "alt_units"` let customers choose between measurement units — the price and quantity are converted automatically using the item's `conversionFactor`.

---

## Project structure

```
apps/store/
├── src/
│   ├── components/   # Header, ItemCard, CartDrawer, Checkout, PolicyPage, etc.
│   ├── App.tsx       # Root component — slug routing, catalog fetch, cart state
│   ├── api.ts        # fetchCatalog() and placeOrder() REST calls
│   ├── types.ts      # StoreConfig, CartItem, OrderResult types
│   └── styles.css    # Tailwind v4 base styles + accent color CSS variable
├── index.html
└── vite.config.ts
```

The store has no dependency on `@hisaabo/api` or tRPC. It uses plain `fetch` calls to the REST endpoints. Types in `src/types.ts` are manually maintained to match the API response shapes — if you change the catalog or order endpoint in the API, update these types.
