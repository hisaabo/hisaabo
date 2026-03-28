# @hisaabo/docs

The user documentation site for Hisaabo. Built with [Starlight](https://starlight.astro.build/) on top of Astro 5, it covers everything a business owner or self-hoster needs to know: getting started, invoicing workflows, GST compliance, team setup, and deployment.

[![Astro](https://img.shields.io/badge/Astro-5-FF5D01?logo=astro&logoColor=white)](https://astro.build/)
[![Starlight](https://img.shields.io/badge/Starlight-0.34-7C3AED?logo=astro&logoColor=white)](https://starlight.astro.build/)

Published at [docs.hisaabo.in](https://docs.hisaabo.in).

---

## Running locally

```bash
# From monorepo root
pnpm --filter @hisaabo/docs dev

# Or from this directory
pnpm dev
```

The site starts at `http://localhost:4321` by default.

---

## Building

```bash
pnpm --filter @hisaabo/docs build
# Output: apps/docs/dist/
```

Preview the production build:

```bash
pnpm --filter @hisaabo/docs preview
```

---

## Content structure

All documentation content lives in `src/content/docs/`. Starlight uses MDX files organized by directory, which maps directly to the sidebar sections configured in `astro.config.mjs`:

```
src/content/docs/
├── index.mdx                     # Homepage
├── getting-started/              # What is Hisaabo, self-hosting setup, first business, data import
├── invoicing/                    # Creating invoices, quotations, challans, credit notes, PDFs
├── parties/                      # Adding customers and suppliers, ledger, GSTIN
├── items/                        # Products, services, inventory, variants, units
├── payments/                     # Recording payments, multi-invoice allocation
├── expenses/                     # Expense tracking and categories
├── gst/                          # GSTR-1, GSTR-3B, HSN codes, state codes
├── online-store/                 # Enabling the store, products, orders
├── banking/                      # Bank accounts, UPI, cash, reconciliation
├── reports/                      # Dashboard, P&L, aging, ledger exports
├── team/                         # Roles, invitations, permissions
├── settings/                     # Business settings, invoice numbering, financial year
├── self-hosting/                 # Docker, nginx, TLS, backups, environment variables
└── reference/                    # Keyboard shortcuts, data formats, import specs
```

---

## Adding documentation

1. Create an `.mdx` file in the appropriate directory under `src/content/docs/`.
2. Add frontmatter with at least a `title`:
   ```mdx
   ---
   title: "Recording a Payment"
   description: "How to record payments against invoices in Hisaabo"
   ---
   ```
3. If the file should appear in the sidebar, it is auto-generated from the directory. No manual sidebar update required — Starlight picks it up automatically from the `autogenerate` config in `astro.config.mjs`.

For a new top-level section, add an `autogenerate` entry to `astro.config.mjs`:
```javascript
{ label: "My New Section", autogenerate: { directory: "my-new-section" } }
```

---

## Deployment

Deploy `apps/docs/dist/` as a static site. The site is configured for `https://docs.hisaabo.in` in `astro.config.mjs`. Cloudflare Pages is the recommended host:

| Setting | Value |
|---|---|
| Build command | `pnpm --filter @hisaabo/docs build` |
| Output directory | `apps/docs/dist` |
| Node.js version | 20 |

---

## Type checking

```bash
pnpm --filter @hisaabo/docs typecheck
# Runs: astro check
```
