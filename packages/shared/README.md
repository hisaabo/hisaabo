# @hisaabo/shared

Shared utilities used by the API, web app, and mobile app. Zod input validators, TypeScript types, fixed-point money arithmetic, and invoice calculation logic — the single source of truth for business rules that must be consistent across all platforms.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Zod](https://img.shields.io/badge/Zod-3.24-3E67B1)](https://zod.dev/)

---

## What this package contains

| File | Purpose |
|---|---|
| `src/validators.ts` | Zod schemas for every API input (auth, business, party, item, invoice, payment, expense, dashboard, import) |
| `src/calc.ts` | Line item and invoice total calculations (tax, discount, inclusive pricing) |
| `src/money.ts` | Fixed-point decimal arithmetic for INR values |
| `src/index.ts` | Re-exports everything |

This package has no runtime dependencies other than Zod. It is imported by:
- `packages/api` — validates tRPC procedure inputs and uses `calc` for invoice totals
- `apps/web` — validates forms client-side and uses `calc` for live invoice total preview
- `apps/mobile` — same as web

---

## Key exports

### Zod validators

Every entity has a create schema and (where applicable) an update schema. Input schemas for tRPC procedures are defined here — not in the API package — so the web and mobile clients can reuse them for form validation without duplicating business rules.

```typescript
import {
  loginSchema,
  registerSchema,
  createInvoiceSchema,
  createPartySchema,
  createItemSchema,
  createPaymentSchema,
  // ... and many more
} from "@hisaabo/shared";

// Use in a form (web/mobile)
const result = createPartySchema.safeParse(formData);

// Use in a tRPC procedure (API)
.input(createInvoiceSchema)
.mutation(async ({ input }) => { ... })
```

When you change a validator — adding a required field, tightening a constraint — TypeScript immediately flags every callsite across the API, web, and mobile that no longer satisfies the schema.

### Invoice calculation (`src/calc.ts`)

`calcLineItem` and `calcInvoiceTotals` implement the GST tax calculation logic shared by the API (when saving) and the web/mobile apps (for live preview before saving).

```typescript
import { calcLineItem, calcInvoiceTotals } from "@hisaabo/shared";

const lineItem = calcLineItem({
  unitPrice: "100.00",
  quantity: 5,
  taxRate: "18",         // GST rate in percent
  discountPercent: "10", // Discount in percent
  taxInclusive: false,   // Price is tax-exclusive
});
// lineItem.subtotal     = "450.00"  (100 * 5, after 10% discount)
// lineItem.taxAmount    = "81.00"   (18% of 450)
// lineItem.total        = "531.00"

const totals = calcInvoiceTotals(lineItems, charges);
// totals.subtotal, totals.totalTax, totals.grandTotal
```

CGST/SGST vs IGST split is determined by comparing the business's state code with the party's state code. This logic lives in the API (which has access to both) — the `calc` functions compute tax amounts from a given rate, not the split.

### Money module (`src/money.ts`)

Fixed-point decimal arithmetic that stores values internally as integer paise (1 INR = 100 paise) to avoid floating-point precision errors:

```typescript
import { money } from "@hisaabo/shared";

money.add("100.00", "0.05")      // "100.05"
money.sub("500.00", "37.50")     // "462.50"
money.mul("299.00", 3)           // "897.00"
money.percent("1000.00", 18)     // "180.00"  (18% of ₹1,000)
money.sum(["100.00", "250.50"])   // "350.50"
money.compare("100.00", "99.99") // 1 (greater than)
money.isZero("0.00")             // true
money.toNumber("1234.56")        // 1234.56  (for display only)
```

All functions accept either `string` or `number` input and return `string` output. Always use this module for monetary arithmetic. Never use JavaScript's `+`, `-`, or `*` operators directly on monetary values.

---

## Adding a new validator

1. Open `src/validators.ts`.
2. Define the Zod schema. Follow the existing naming pattern: `create<Entity>Schema`, `update<Entity>Schema`.
3. Export it from `src/index.ts` if it is not already re-exported.
4. Import it in `packages/api/src/routers/<entity>.ts` for the tRPC input.
5. Import it in the relevant form components in `apps/web` and `apps/mobile` for client-side validation.

Keep validators strict. If a field has a known maximum length, set `.max()`. If an enum is closed, use `z.enum([...])` rather than `z.string()`. The schema is the contract — vague schemas make debugging harder.
