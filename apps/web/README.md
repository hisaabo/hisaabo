# @hisaabo/web

The main admin dashboard for Hisaabo. A React 19 single-page application that gives business owners and their teams full access to invoicing, inventory, parties, payments, GST reports, and settings.

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![TanStack Router](https://img.shields.io/badge/TanStack_Router-1-FF4154?logo=reactquery&logoColor=white)](https://tanstack.com/router)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

---

## What this app does

- Full invoicing workflow: create, send, track, and collect payment on sale and purchase invoices
- Party (customer and supplier) management with ledger view and outstanding balances
- Item and inventory management with stock tracking
- Expense tracking and cash/bank account management
- GST compliance: GSTR-1 and GSTR-3B report generation
- Online store settings and order management
- Team member management with role-based permissions
- MyBillBook data import wizard
- Dark mode, keyboard shortcuts, and audit log

The desktop app (`apps/desktop`) wraps this app in a Tauri v2 shell with no code differences — they share the same build output.

---

## Running locally

**Prerequisites:** Node.js 20+, pnpm 9+, a running API server

```bash
# From the monorepo root
pnpm --filter @hisaabo/web dev
```

The dev server starts at `http://localhost:5173`. All `/api` requests are proxied to `http://localhost:3000` via the Vite config — you need the API running before the web app is useful.

To start the full stack at once:

```bash
# From monorepo root
docker compose up -d   # PostgreSQL
pnpm dev               # API + web + store in parallel
```

---

## Building

```bash
# From monorepo root
pnpm --filter @hisaabo/web build

# Or from this directory
pnpm build
```

Output is in `dist/`. The build produces a static SPA — no server-side rendering.

---

## Deployment

Deploy the `dist/` folder to Cloudflare Pages (or any static host):

| Setting | Value |
|---|---|
| Build command | `pnpm --filter @hisaabo/web build` |
| Output directory | `apps/web/dist` |
| Node.js version | 20 |

Set these environment variables in Cloudflare Pages:

| Variable | Description |
|---|---|
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile key for the online store (optional if store is disabled) |

The app proxies all API calls through `/api` in development. In production, the API must be deployed separately and the web app must be able to reach it. If your API is at `https://api.yourdomain.com`, configure the Vite proxy or set up a Cloudflare Pages Function to proxy `/api/*` requests.

---

## Project structure

```
apps/web/
├── src/
│   ├── routes/           # TanStack file-based routes (auto-generates routeTree.gen.ts)
│   │   ├── __root.tsx    # Root layout with nav, business selector, auth guard
│   │   ├── index.tsx     # Dashboard
│   │   ├── invoices.tsx
│   │   ├── parties.tsx
│   │   ├── items.tsx
│   │   ├── payments.tsx
│   │   ├── expenses.tsx
│   │   ├── cash-and-bank.tsx
│   │   ├── gst.tsx
│   │   ├── settings.tsx
│   │   └── auth/         # Login, magic link, complete profile
│   ├── components/       # Shared UI components, feature-specific panels
│   ├── lib/
│   │   ├── trpc.ts       # tRPC React client + QueryClient setup
│   │   └── utils.ts      # INR formatting, date helpers, cn() for Tailwind
│   └── styles/
│       └── globals.css   # CSS custom properties for light/dark theming
├── vite.config.ts        # Dev proxy (/api -> :3000), path aliases (@/)
└── tailwind.config.js    # DM Sans + JetBrains Mono, brand palette
```

---

## Key patterns

### tRPC client

The web app imports the `AppRouter` type from `@hisaabo/api` (a devDependency — only types are used, no runtime import) and uses `createTRPCReact` to get fully typed query and mutation hooks:

```typescript
import { trpc } from "@/lib/trpc";

// Fully typed — input, output, and errors
const { data } = trpc.invoice.list.useQuery({ documentType: "invoice" });
const create = trpc.invoice.create.useMutation();
```

No codegen. Change a procedure's input schema in `packages/shared` and TypeScript immediately flags every call site that breaks.

### Business ID header

Every business-scoped tRPC call sends an `x-business-id` header. The client-side store manages the active business:

```typescript
import { setBusinessId } from "@/lib/trpc";
setBusinessId(selectedBusiness.id);  // All subsequent calls include this header
```

### File-based routing

TanStack Router reads `src/routes/` and generates `src/routeTree.gen.ts` automatically during `pnpm dev`. Do not edit `routeTree.gen.ts` by hand. Add a new top-level route by creating a new `.tsx` file in `src/routes/`.

### INR formatting

Use the `formatINR` helper from `@/lib/utils` for all currency display:

```typescript
import { formatINR } from "@/lib/utils";
formatINR("12500.00")   // "₹12,500.00"
formatINR("100000.00")  // "₹1,00,000.00"  (Indian lakh formatting)
```

### CSS theming

All colors are CSS custom properties defined in `globals.css`. Tailwind uses these properties via the brand palette in `tailwind.config.js`. To change a color system-wide, update the CSS variable — not individual Tailwind classes.

Dark mode is toggled by setting `data-theme="dark"` on the `<html>` element.

---

## Type checking

```bash
pnpm --filter @hisaabo/web typecheck
```

The `tsconfig.json` extends the monorepo base config and enables strict mode. `routeTree.gen.ts` is excluded from the typecheck to avoid transient errors during development.
