# @hisaabo/api-docs

The Hisaabo API reference site. A Stripe-style interactive documentation site that documents every tRPC procedure and REST endpoint available in the Hisaabo API, with request/response examples, authentication guides, and error code references.

[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS-v4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

Published at [api.hisaabo.in](https://api.hisaabo.in).

---

## Running locally

```bash
# From monorepo root
pnpm --filter @hisaabo/api-docs dev

# Or from this directory
pnpm dev
```

The site starts at `http://localhost:5175` (or the next available port).

---

## Building

```bash
pnpm --filter @hisaabo/api-docs build
# Output: apps/api-docs/dist/
```

---

## Content structure

API documentation content is defined as TypeScript files in `src/content/`, organized by resource. Each file exports an array of endpoint descriptors that the React app renders into the reference UI:

```
src/content/
├── index.ts         # Re-exports all sections and sidebar config
├── auth.ts          # Authentication endpoints (login, register, magic link, logout)
├── business.ts      # Business management
├── party.ts         # Customers and suppliers
├── item.ts          # Products, services, inventory
├── invoice.ts       # Invoices, quotations, challans, credit notes
├── payment.ts       # Payment recording and allocation
└── types.ts         # TypeScript types for endpoint descriptors
```

Each entry in a content file describes one tRPC procedure or REST endpoint: its name, description, procedure level (public / protected / business-scoped), input schema, example request, and example response.

---

## Deployment

Deploy `apps/api-docs/dist/` as a static site:

| Setting | Value |
|---|---|
| Build command | `pnpm --filter @hisaabo/api-docs build` |
| Output directory | `apps/api-docs/dist` |
| Node.js version | 20 |

---

## Relationship to the API

This site imports `@hisaabo/api` as a devDependency to access TypeScript types and router structure. It does not call the live API — all content is statically defined in `src/content/`. When you add or change a procedure in `packages/api`, update the corresponding content file here in the same PR.

The `App.tsx` component renders the sidebar navigation (from `src/content/index.ts`), the endpoint detail panel, and syntax-highlighted code examples via Prism.js.
