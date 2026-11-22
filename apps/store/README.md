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
- Cart hand-off links: a business's own website can send shoppers here with a prefilled cart (`#cart=...`), and link to a single item (`?item=<id>`)
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

## Testing

```bash
pnpm --filter @hisaabo/store test        # Vitest: pure logic and the Dialog component (jsdom)
pnpm --filter @hisaabo/store test:e2e    # Playwright against fixtures, no backend needed
```

Vitest covers the pure logic (cart link parsing and merging, cart persistence, money formatting, the low-stock rule, accent colours) and the shared `Dialog` primitive (Esc, focus trap, focus return, scroll lock). A component test opts into a DOM with `// @vitest-environment jsdom` on its first line.

The Playwright specs in `e2e/` serve the API from a fixture catalog (`e2e/fixtures.ts`, `e2e/mockStore.ts`: a farm store that holds no inventory, so every item reports `lowStock`), start the Vite dev server themselves and need no database. They assert that the cart never shifts the layout (`layout-shift.spec.ts`), that every dialog closes on Esc, traps and returns focus (`dialogs.spec.ts`), and the visible fixes of the UI lift (`storefront.spec.ts`). Headless Chromium hides scrollbars by default; the config turns that off, because a scrollbar appearing or vanishing is one of the shifts under test.

To capture screenshots for design review (catalog, cart, checkout and a policy dialog at 1440, 1024 and 390px):

```bash
STORE_SHOTS_DIR=/tmp/shots STORE_SHOTS_PREFIX=after pnpm --filter @hisaabo/store test:e2e capture
```

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
| `API_URL` | Base URL of the API server, read at runtime by the Pages Function for per-store share metadata (e.g., `https://api.yourdomain.com`) |

The store runs on its own subdomain (e.g., `store.hisaabo.in`). Customer-facing URLs are clean: `store.hisaabo.in/my-bakery` — no `/store/` prefix.

### Per-store share metadata (Open Graph)

The SPA ships with generic default `<meta>` tags. Social crawlers (WhatsApp, X,
Facebook, LinkedIn) don't run JS, so they'd never see a per-store title or
image. The Pages Function in `functions/_middleware.ts` intercepts each store
document request, fetches the store's identity from the API
(`GET /store/<slug>/meta.json`), and rewrites the `<title>` + `og:`/`twitter:`
tags — pointing `og:image` at the API's dynamic, top-sellers share card
(`GET /store/<slug>/og.png`). It reads the `API_URL` env var (above).

For self-host, the API serves the equivalent shell at `GET /store/<slug>`, so
no Pages Function is needed.

The backend API endpoints still use the `/store/` prefix internally (`/store/<slug>/catalog.json`, `/store/<slug>/order`). In dev, the Vite proxy rewrites `/<slug>/catalog.json` → `/store/<slug>/catalog.json`. In production, `VITE_API_URL` points to the API server directly.

---

## How it works

### Catalog fetch

On load, the app reads the slug from the first URL path segment (`/<slug>`) and fetches the catalog from the API. This returns the business's public store config: name, accent color, tagline, items grouped by category, store policies, and store settings.

```typescript
// apps/store/src/api.ts
const catalog = await fetchCatalog(slug);
// catalog.items, catalog.categories, catalog.config, ...
```

If the slug is not found or the store is disabled, the API returns 404 and the app shows a "Store not found" page.

### Order placement

The checkout form collects the customer's name, phone, optional email, and delivery address. On submission, the app sends a POST request to `/store/<slug>/order` with the cart contents and a Cloudflare Turnstile verification token.

The API validates the token, creates an unfulfilled invoice in the business database, and (if configured) sends a WhatsApp message to the business's `storeWhatsappNumber`.

### Cart links and item links

A business's own website can list items from the public `GET /store/<slug>/catalog.json` and hand the shopper's cart to the store:

```
https://store.hisaabo.in/<slug>#cart=<encodeURIComponent(JSON)>
JSON = { "v": 1, "items": [{ "id": "<item uuid>", "qty": 2, "variantId"?: "<variant uuid>", "unit"?: "<alternate unit name>" }] }
```

The cart is in the URL fragment, so it never reaches a server or CDN log. On load the app (`src/cartLink.ts`, wired up in `App.tsx`):

1. Parses the fragment. Anything malformed or over a limit (8 KB, 50 lines, non-UUID ids, `qty` not a whole number 1 or more, `v` other than 1) ignores the whole link and shows "This cart link couldn't be read". `qty` above 9999 is clamped; lines for the same item, variant and unit are summed.
2. Fetches those items from the live catalog with `catalog.json?ids=<comma-separated ids>` (max 50) and builds the cart lines from it. Only the ids, quantity, unit and variant come from the link; name, price, tax, unit conversion and stock come from the catalog. Lines whose item, variant or unit is missing or out of stock are dropped and listed in a dismissible notice.
3. Merges into the persisted cart: a line for the same item+variant+unit has its quantity **set** (not added), so reopening the link is idempotent; other lines are appended and existing lines are kept.
4. Opens the cart, shows "N items added from a link", and removes the fragment with `history.replaceState`.

`https://store.hisaabo.in/<slug>?item=<item uuid>` opens that item's detail view (an unknown id shows the store normally).

The cart is persisted in `localStorage` under `hisaabo-store-cart:<slug>`. Every store shares the `store.hisaabo.in` origin, so the key includes the slug and one store's cart is never shown in another. Carts saved by earlier versions under the single key `hisaabo-store-cart` are migrated lazily: when a store loads, it looks those lines' item ids up in itself (`catalog.json?ids=`), moves the lines it sells into its own cart (lines already there win) and removes them from the old list; lines for other stores stay for them to claim, the old key is deleted once empty, and a failed lookup changes nothing. Every `?ids=` lookup (`fetchItemsByIds` in `src/api.ts`) is chunked to 50 ids and filtered client-side to the ids requested, so an API that ignores `ids` and returns its first page cannot add unrelated items. Integrator documentation: `apps/docs/src/content/docs/online-store/own-website.mdx`.

### Variants and alternate units

Items with `itemMode: "variants"` display a variant selector (e.g., size, colour). Items with `itemMode: "alt_units"` let customers choose between measurement units — the price and quantity are converted automatically using the item's `conversionFactor`.

---

## Project structure

```
apps/store/
├── src/
│   ├── components/   # Dialog (the one overlay primitive), Header, ItemGrid, ItemCard, Cart (a drawer), Checkout, PhoneVerify, Footer, etc.
│   ├── App.tsx       # Root component — slug routing, catalog fetch, cart state
│   ├── money.ts      # One price formatter: Indian grouping, integer paise (unit tested)
│   ├── stock.ts      # What `inStock` / `lowStock` mean, and the low-stock badge rule (unit tested)
│   ├── color.ts      # Accent tokens kept AA-legible for any accent (unit tested)
│   ├── api.ts        # fetchCatalog() and placeOrder() REST calls
│   ├── cartLink.ts   # Pure: parse/resolve/merge #cart= links, ?item= param (unit tested)
│   ├── cartStorage.ts # Per-store cart persistence + old shared-cart migration (unit tested)
│   ├── catalogIds.ts # Chunking and client-side filtering for ?ids= lookups (unit tested)
│   ├── types.ts      # StoreConfig, CartItem, OrderResult types
│   └── styles.css    # Design tokens and component CSS (in @layer components, below Tailwind utilities)
├── e2e/              # Playwright specs and the fixture catalog
├── index.html
└── vite.config.ts
```

The store has no dependency on `@hisaabo/api` or tRPC. It uses plain `fetch` calls to the REST endpoints. Types in `src/types.ts` are manually maintained to match the API response shapes — if you change the catalog or order endpoint in the API, update these types.
