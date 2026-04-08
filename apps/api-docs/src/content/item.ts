import type { EndpointGroup } from "./types";

export const itemEndpoints: EndpointGroup = {
  id: "items",
  title: "Items",
  description: "Manage the product and service catalog. Items support three modes: `simple` (single price/unit), `alt_units` (same item sold in multiple units with conversion factors), and `variants` (distinct SKUs per attribute combination, e.g. size+color). Stock tracking is per-item for simple/alt_units and per-variant for variants mode.",
  endpoints: [
    {
      id: "item-list",
      method: "query",
      path: "item.list",
      title: "List Items",
      description: "Paginated catalog with optional low-stock filter. Variant items include an aggregated `variantCount` and `variantTotalStock`.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "search", type: "string", required: false, description: "Search by item name (case-insensitive)" },
        { name: "lowStock", type: "boolean", required: false, description: "If true, return only items at or below their `lowStockAlert` threshold" },
        { name: "itemType", type: "enum", required: false, description: "Filter by item type", enumValues: ["product", "service"] },
        { name: "itemMode", type: "enum", required: false, description: "Filter by item mode", enumValues: ["simple", "alt_units", "variants"] },
        { name: "category", type: "string", required: false, description: "Filter by category label" },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated item list with variant metadata for variant-mode items.",
        example: {
          data: [
            {
              id: "item-uuid",
              name: "Premium Widget A",
              itemType: "product",
              itemMode: "simple",
              unit: "pcs",
              salePrice: "1334.75",
              purchasePrice: "950.00",
              taxPercent: "18.00",
              stockQuantity: "245.000",
              lowStockAlert: "50",
              hsn: "84159000",
              sku: "WGT-A-001",
              category: "electronics",
              taxInclusive: false,
              variantCount: null,
              variantTotalStock: null,
            },
          ],
          total: 312,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/item.list?input=%7B%22json%22%3A%7B%22lowStock%22%3Atrue%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `// Get all items below their low-stock threshold
const { data } = await trpc.item.list.query({ lowStock: true });

data.forEach(item => {
  console.log(\`\${item.name}: \${item.stockQuantity} remaining (alert at \${item.lowStockAlert})\`);
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"lowStock": True, "page": 1}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/item.list?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Variant items show aggregate stock in `variantTotalStock`. Individual variant stock is returned by `item.getById`.",
        "Stock quantities are strings (`\"245.000\"`) — three decimal places for precision with weights and partial units.",
      ],
    },
    {
      id: "item-get-by-id",
      method: "query",
      path: "item.getById",
      title: "Get Item",
      description: "Fetch a single item with all variants (for `variants` mode items). Returns `null` if not found in the active business.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Item ID" },
      ],
      output: {
        description: "Item object with variants array (empty for simple/alt_units mode).",
        example: {
          id: "item-uuid",
          name: "T-Shirt",
          itemType: "product",
          itemMode: "variants",
          unit: "pcs",
          taxPercent: "5.00",
          variantAttributes: ["size", "color"],
          variants: [
            { id: "v-uuid-1", attributeValues: { size: "M", color: "Blue" }, sku: "TS-M-BLU", salePrice: "599.00", stockQuantity: "45.000" },
            { id: "v-uuid-2", attributeValues: { size: "L", color: "Blue" }, sku: "TS-L-BLU", salePrice: "599.00", stockQuantity: "32.000" },
          ],
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/item.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22item-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const item = await trpc.item.getById.query({ id: "item-uuid" });

if (item?.itemMode === "variants") {
  item.variants.forEach(v => {
    console.log(v.attributeValues, "stock:", v.stockQuantity);
  });
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "item-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/item.getById?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
    },
    {
      id: "item-create",
      method: "mutation",
      path: "item.create",
      title: "Create Item",
      description: "Create a new catalog item. For `variants` mode, supply `variantAttributes` (attribute names like `[\"size\", \"color\"]`) and an optional `variants` array with initial stock. For `alt_units` mode, supply `unitVariants` for secondary units with conversion factors.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "name", type: "string", required: true, description: "Item name (1–200 chars)" },
        { name: "itemType", type: "enum", required: false, description: "Product or service (services skip stock tracking)", default: "product", enumValues: ["product", "service"] },
        { name: "itemMode", type: "enum", required: false, description: "Pricing/stock mode", default: "simple", enumValues: ["simple", "alt_units", "variants"] },
        { name: "unit", type: "enum", required: false, description: "Base unit of measurement", default: "pcs", enumValues: ["pcs", "kg", "g", "l", "ml", "m", "cm", "ft", "in", "box", "dozen", "pair", "set", "pkt", "bun", "pouch", "jar", "btl", "bag", "ton", "pack", "pet", "person", "other"] },
        { name: "salePrice", type: "string (decimal)", required: false, description: "Default sale price (used on invoices)" },
        { name: "purchasePrice", type: "string (decimal)", required: false, description: "Default purchase price" },
        { name: "taxPercent", type: "string (decimal)", required: false, description: "Default GST rate applied to line items", default: "0" },
        { name: "taxInclusive", type: "boolean", required: false, description: "Whether `salePrice` already includes tax", default: "false" },
        { name: "stockQuantity", type: "string (decimal)", required: false, description: "Opening stock quantity (3 decimal places)", default: "0" },
        { name: "lowStockAlert", type: "string (decimal)", required: false, description: "Alert threshold — triggers low-stock filter when stock ≤ this value" },
        { name: "hsn", type: "string", required: false, description: "HSN/SAC code for GST filing (max 20 chars)" },
        { name: "sku", type: "string", required: false, description: "Internal SKU/barcode (max 50 chars)" },
        { name: "description", type: "string", required: false, description: "Item description (max 1000 chars)" },
        { name: "category", type: "string", required: false, description: "Category label (max 100 chars)" },
        { name: "variantAttributes", type: "array of strings", required: false, description: "Attribute names for `variants` mode, e.g. `[\"size\", \"color\"]` (max 5)" },
        { name: "variants", type: "array", required: false, description: "Initial variants for `variants` mode. Each: `{attributeValues, sku?, salePrice?, purchasePrice?, stockQuantity?}`" },
        { name: "unitVariants", type: "array", required: false, description: "Alt units for `alt_units` mode. Each: `{unit, conversionFactor, salePrice, purchasePrice?}`" },
      ],
      output: {
        description: "Created item object.",
        example: {
          id: "item-uuid",
          businessId: "biz-uuid",
          name: "Premium Widget A",
          itemType: "product",
          itemMode: "simple",
          unit: "pcs",
          salePrice: "1334.75",
          taxPercent: "18.00",
          stockQuantity: "100.000",
          hsn: "84159000",
          createdAt: "2024-03-16T10:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/item.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "name": "Premium Widget A",
      "itemType": "product",
      "unit": "pcs",
      "salePrice": "1334.75",
      "purchasePrice": "950.00",
      "taxPercent": "18.00",
      "stockQuantity": "100.000",
      "hsn": "84159000"
    }
  }'`,
        javascript: `// Simple item
const item = await trpc.item.create.mutate({
  name: "Premium Widget A",
  itemType: "product",
  unit: "pcs",
  salePrice: "1334.75",
  purchasePrice: "950.00",
  taxPercent: "18.00",
  stockQuantity: "100.000",
  hsn: "84159000",
});

// Variant item (T-shirt with size + color)
const shirt = await trpc.item.create.mutate({
  name: "Classic T-Shirt",
  itemMode: "variants",
  unit: "pcs",
  taxPercent: "5.00",
  variantAttributes: ["size", "color"],
  variants: [
    { attributeValues: { size: "M", color: "Blue" }, salePrice: "599.00", stockQuantity: "50.000" },
    { attributeValues: { size: "L", color: "Blue" }, salePrice: "599.00", stockQuantity: "40.000" },
  ],
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/item.create",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {
        "name": "Premium Widget A",
        "itemType": "product",
        "unit": "pcs",
        "salePrice": "1334.75",
        "taxPercent": "18.00",
        "stockQuantity": "100.000",
    }},
)`,
      },
      gotchas: [
        "An item cannot have both `unitVariants` (`alt_units` mode) and `variantAttributes`/`variants` (`variants` mode) — these are mutually exclusive.",
        "Service items (`itemType: \"service\"`) still accept `stockQuantity` but it is not tracked by invoices.",
        "Variant stock lives on the variant row, not the parent item. The parent item's `stockQuantity` is unused for `variants` mode items.",
      ],
    },
    {
      id: "item-switch-base-unit",
      method: "mutation",
      path: "item.switchBaseUnit",
      title: "Switch Base Unit",
      description: "Change the base unit of an item. Converts stock quantity and prices using the conversion factor. The old base unit is moved to alt unit variants. Invoice line items are updated with the inverse conversion factor. Cannot be used on variant-mode items.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Item ID" },
        { name: "newUnit", type: "string", required: true, description: "New base unit name" },
        { name: "conversionFactor", type: "number", required: true, description: "How many NEW units = 1 OLD unit (must be positive)" },
      ],
      output: {
        description: "Updated item object with new unit, converted prices, and stock.",
        example: {
          id: "item-uuid",
          name: "Sugar",
          unit: "g",
          salePrice: "0.06",
          stockQuantity: "50000.000",
          unitVariants: [{ unit: "kg", conversionFactor: 0.001, salePrice: "60.00" }],
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/item.switchBaseUnit \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"item-uuid","newUnit":"g","conversionFactor":1000}}'`,
        javascript: `// Switch sugar from kg to grams (1 kg = 1000 g)
const updated = await trpc.item.switchBaseUnit.mutate({
  id: "item-uuid",
  newUnit: "g",
  conversionFactor: 1000,
});
// Stock 50 kg -> 50000 g, price Rs 60/kg -> Rs 0.06/g`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/item.switchBaseUnit",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "item-uuid", "newUnit": "g", "conversionFactor": 1000}},
)`,
      },
      gotchas: [
        "Cannot be used on variant-mode items \u2014 variants have independent stock.",
        "Historical invoice line items are updated with the inverse conversion factor.",
        "The old base unit is automatically added to `unitVariants` with `conversionFactor: 1/factor`.",
      ],
    },
    {
      id: "item-update",
      method: "mutation",
      path: "item.update",
      title: "Update Item",
      description: "Partially update an existing item. Only provided fields are changed. Requires `member` role or above.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Item ID" },
        { name: "data.name", type: "string", required: false, description: "Updated name" },
        { name: "data.salePrice", type: "string (decimal)", required: false, description: "Updated sale price" },
        { name: "data.purchasePrice", type: "string (decimal)", required: false, description: "Updated purchase price" },
        { name: "data.taxPercent", type: "string (decimal)", required: false, description: "Updated tax rate" },
        { name: "data.hsn", type: "string", required: false, description: "Updated HSN code" },
        { name: "data.sku", type: "string", required: false, description: "Updated SKU" },
        { name: "data.lowStockAlert", type: "string (decimal)", required: false, description: "Updated low stock threshold" },
        { name: "data.category", type: "string", required: false, description: "Updated category" },
      ],
      output: {
        description: "Updated item object.",
        example: { id: "item-uuid", name: "Premium Widget B", salePrice: "1499.00" },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/item.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"item-uuid","data":{"salePrice":"1499.00","lowStockAlert":"25"}}}'`,
        javascript: `const updated = await trpc.item.update.mutate({
  id: "item-uuid",
  data: { salePrice: "1499.00", lowStockAlert: "25" },
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/item.update",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "item-uuid", "data": {"salePrice": "1499.00"}}},
)`,
      },
      relatedEndpoints: ["item-get-by-id"],
    },
    {
      id: "item-rename-unit",
      method: "mutation",
      path: "item.renameUnit",
      title: "Rename Unit",
      description: "Rename a base unit or alt unit on an item. Cascades the rename to all invoice line items that use the old unit name. Requires `admin` role.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Item ID" },
        { name: "oldUnit", type: "string", required: true, description: "Current unit name" },
        { name: "newUnit", type: "string", required: true, description: "New unit name" },
      ],
      output: {
        description: "Success with old and new unit names.",
        example: { success: true, renamedFrom: "pieces", renamedTo: "pcs" },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/item.renameUnit \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"item-uuid","oldUnit":"pieces","newUnit":"pcs"}}'`,
        javascript: `const result = await trpc.item.renameUnit.mutate({
  id: "item-uuid",
  oldUnit: "pieces",
  newUnit: "pcs",
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/item.renameUnit",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "item-uuid", "oldUnit": "pieces", "newUnit": "pcs"}},
)`,
      },
      gotchas: [
        "Cascades to all invoice line items that use the old `selectedUnit`.",
        "If renaming the base unit, updates `items.unit`. If renaming an alt unit, updates the `unitVariants` array.",
      ],
    },
    {
      id: "item-delete",
      method: "mutation",
      path: "item.delete",
      title: "Delete Item",
      description: "Permanently delete an item and all its variants. Requires `admin` role.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Item ID" },
      ],
      output: { description: "Success confirmation.", example: { success: true } },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/item.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"item-uuid"}}'`,
        javascript: `await trpc.item.delete.mutate({ id: "item-uuid" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/item.delete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "item-uuid"}},
)`,
      },
      gotchas: [
        "Returns NOT_FOUND if the item does not exist in the active business.",
        "Linked invoice line items are NOT cascade-deleted \u2014 they retain their data with a dangling `itemId`.",
      ],
    },
    {
      id: "item-sales-stats",
      method: "query",
      path: "item.salesStats",
      title: "Sales Stats",
      description: "Aggregate sales and purchase statistics for an item. Returns total amounts, quantities, average gross and net prices, and sale invoice count. Computed server-side across all invoices (not limited by priceHistory's 50-row cap).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Item ID" },
      ],
      output: {
        description: "Aggregate sales and purchase stats.",
        example: {
          totalSaleAmount: "159900.00",
          totalSaleQty: "120.000",
          avgGrossPrice: "1334.75",
          avgNetPrice: "1131.14",
          totalPurchaseAmount: "95000.00",
          totalPurchaseQty: "100.000",
          saleInvoiceCount: 18,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/item.salesStats?input=%7B%22json%22%3A%7B%22id%22%3A%22item-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const stats = await trpc.item.salesStats.query({ id: "item-uuid" });
console.log("Avg selling price:", stats.avgNetPrice);
console.log("Total sold:", stats.totalSaleQty);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "item-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/item.salesStats?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Only finalized invoices are counted \u2014 draft and cancelled invoices are excluded.",
        "`avgGrossPrice` is the list price per base unit (before discount). `avgNetPrice` is the realized price (after discount, before tax).",
        "Quantities are converted to base units using `conversionFactor`.",
      ],
      relatedEndpoints: ["item-price-history"],
    },
    {
      id: "item-price-history",
      method: "query",
      path: "item.priceHistory",
      title: "Price History",
      description: "Returns the last 50 invoice line items for this item, showing the price at which it was sold or purchased, along with party name, date, and unit information.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Item ID" },
      ],
      output: {
        description: "Array of recent price points (max 50).",
        example: [
          { invoiceDate: "2026-03-20T00:00:00.000Z", invoiceNumber: "INV-0042", invoiceType: "sale", unitPrice: "1334.75", quantity: "10.000", taxPercent: "18.00", totalAmount: "15750.05", partyName: "Sharma Electronics", selectedUnit: "pcs", conversionFactor: "1" },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/item.priceHistory?input=%7B%22json%22%3A%7B%22id%22%3A%22item-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const history = await trpc.item.priceHistory.query({ id: "item-uuid" });
history.forEach(h => {
  console.log(h.invoiceDate, h.partyName, "@ Rs", h.unitPrice);
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "item-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/item.priceHistory?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Limited to the 50 most recent entries ordered by invoice date descending.",
        "Includes both sale and purchase invoice line items.",
      ],
      relatedEndpoints: ["item-sales-stats"],
    },
    {
      id: "item-stock-movements",
      method: "query",
      path: "item.stockMovements",
      title: "Stock Movements",
      description: "Every invoice that changed this item's stock (quantity sold or purchased). Each row is annotated with `direction: 'in'` or `'out'` based on invoice type.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Item ID" },
      ],
      output: {
        description: "Array of stock movement entries (max 50).",
        example: [
          { invoiceDate: "2026-03-20T00:00:00.000Z", invoiceNumber: "INV-0042", invoiceType: "sale", documentType: "invoice", quantity: "10.000", partyName: "Sharma Electronics", invoiceId: "inv-uuid", direction: "out" },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/item.stockMovements?input=%7B%22json%22%3A%7B%22id%22%3A%22item-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const movements = await trpc.item.stockMovements.query({ id: "item-uuid" });
const totalOut = movements.filter(m => m.direction === "out");
console.log("Outgoing movements:", totalOut.length);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "item-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/item.stockMovements?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Draft and cancelled invoices are excluded.",
        "`direction: 'out'` for sales and delivery challans; `'in'` for purchases.",
        "Limited to the 50 most recent movements.",
      ],
    },
    {
      id: "item-related-invoices",
      method: "query",
      path: "item.relatedInvoices",
      title: "Related Invoices",
      description: "Paginated list of all invoices containing this item. Returns distinct invoices with party name.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Item ID" },
        { name: "page", type: "number", required: false, description: "Page number", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page", default: "20" },
      ],
      output: {
        description: "Paginated invoice list.",
        example: {
          data: [{ id: "inv-uuid", invoiceNumber: "INV-0042", invoiceDate: "2026-03-20T00:00:00.000Z", type: "sale", documentType: "invoice", status: "paid", totalAmount: "15750.00", partyName: "Sharma Electronics" }],
          total: 18, page: 1, limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/item.relatedInvoices?input=%7B%22json%22%3A%7B%22id%22%3A%22item-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.item.relatedInvoices.query({ id: "item-uuid" });`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "item-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/item.relatedInvoices?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
    },
    {
      id: "item-top-buyers",
      method: "query",
      path: "item.topBuyers",
      title: "Top Buyers",
      description: "Returns the top 5 buyers/suppliers for this item, ranked by total purchase amount.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Item ID" },
      ],
      output: {
        description: "Array of top 5 parties.",
        example: [
          { partyId: "party-uuid", partyName: "Sharma Electronics", partyType: "customer", totalQuantity: "80.000", totalAmount: "106600.00", invoiceCount: 12 },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/item.topBuyers?input=%7B%22json%22%3A%7B%22id%22%3A%22item-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const buyers = await trpc.item.topBuyers.query({ id: "item-uuid" });
buyers.forEach(b => console.log(b.partyName, "bought", b.totalQuantity));`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "item-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/item.topBuyers?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Cancelled invoices are excluded.",
        "Only `documentType: 'invoice'` documents are counted.",
      ],
    },
    {
      id: "item-list-variants",
      method: "query",
      path: "item.listVariants",
      title: "List Variants",
      description: "List all variants for a variant-mode item. Returns the full variant rows ordered by creation date.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "Parent item ID" },
      ],
      output: {
        description: "Array of variant objects.",
        example: [
          { id: "v-uuid", itemId: "item-uuid", attributeValues: { size: "M", color: "Blue" }, sku: "TS-M-BLU", salePrice: "599.00", stockQuantity: "45.000" },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/item.listVariants?input=%7B%22json%22%3A%7B%22itemId%22%3A%22item-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const variants = await trpc.item.listVariants.query({ itemId: "item-uuid" });`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"itemId": "item-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/item.listVariants?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: ["Returns NOT_FOUND if the item does not belong to the active business."],
    },
    {
      id: "item-create-variant",
      method: "mutation",
      path: "item.createVariant",
      title: "Create Variant",
      description: "Add a new variant to a variant-mode item. The parent item must be in `variants` mode.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "Parent item ID" },
        { name: "variant.attributeValues", type: "object", required: true, description: "Key-value pairs, e.g. `{size: 'XL', color: 'Red'}`" },
        { name: "variant.sku", type: "string", required: false, description: "Variant SKU" },
        { name: "variant.salePrice", type: "string (decimal)", required: false, description: "Variant sale price" },
        { name: "variant.purchasePrice", type: "string (decimal)", required: false, description: "Variant purchase price" },
        { name: "variant.stockQuantity", type: "string (decimal)", required: false, description: "Initial stock", default: "0" },
        { name: "variant.lowStockAlert", type: "string (decimal)", required: false, description: "Low stock threshold" },
      ],
      output: {
        description: "Created variant object.",
        example: { id: "v-uuid", itemId: "item-uuid", attributeValues: { size: "XL", color: "Red" }, sku: "TS-XL-RED", salePrice: "699.00", stockQuantity: "0.000" },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/item.createVariant \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"itemId":"item-uuid","variant":{"attributeValues":{"size":"XL","color":"Red"},"sku":"TS-XL-RED","salePrice":"699.00"}}}'`,
        javascript: `const variant = await trpc.item.createVariant.mutate({
  itemId: "item-uuid",
  variant: { attributeValues: { size: "XL", color: "Red" }, sku: "TS-XL-RED", salePrice: "699.00" },
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/item.createVariant",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"itemId": "item-uuid", "variant": {"attributeValues": {"size": "XL", "color": "Red"}, "salePrice": "699.00"}}},
)`,
      },
      gotchas: ["Returns BAD_REQUEST if the parent item is not in `variants` mode."],
    },
    {
      id: "item-update-variant",
      method: "mutation",
      path: "item.updateVariant",
      title: "Update Variant",
      description: "Update fields on an existing variant. Only provided fields are changed.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "variantId", type: "string (UUID)", required: true, description: "Variant ID" },
        { name: "data.attributeValues", type: "object", required: false, description: "Updated attribute values" },
        { name: "data.sku", type: "string", required: false, description: "Updated SKU" },
        { name: "data.salePrice", type: "string (decimal)", required: false, description: "Updated sale price" },
        { name: "data.stockQuantity", type: "string (decimal)", required: false, description: "Updated stock" },
      ],
      output: {
        description: "Updated variant object.",
        example: { id: "v-uuid", salePrice: "749.00", stockQuantity: "30.000" },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/item.updateVariant \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"variantId":"v-uuid","data":{"salePrice":"749.00"}}}'`,
        javascript: `const updated = await trpc.item.updateVariant.mutate({
  variantId: "v-uuid",
  data: { salePrice: "749.00" },
});`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/item.updateVariant",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"variantId": "v-uuid", "data": {"salePrice": "749.00"}}},
)`,
      },
      gotchas: ["Returns NOT_FOUND if the variant does not belong to an item in the active business."],
    },
    {
      id: "item-delete-variant",
      method: "mutation",
      path: "item.deleteVariant",
      title: "Delete Variant",
      description: "Delete a specific variant. Requires `admin` role.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "variantId", type: "string (UUID)", required: true, description: "Variant ID to delete" },
      ],
      output: { description: "Success confirmation.", example: { success: true } },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/item.deleteVariant \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"variantId":"v-uuid"}}'`,
        javascript: `await trpc.item.deleteVariant.mutate({ variantId: "v-uuid" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/item.deleteVariant",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"variantId": "v-uuid"}},
)`,
      },
    },
    {
      id: "item-bulk-create-variants",
      method: "mutation",
      path: "item.bulkCreateVariants",
      title: "Bulk Create Variants",
      description: "Create multiple variants at once for a variant-mode item (1\u2013100 variants per call).",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "Parent item ID" },
        { name: "variants", type: "array", required: true, description: "Array of variant objects (1\u2013100). Each: `{attributeValues, sku?, salePrice?, purchasePrice?, stockQuantity?}`" },
      ],
      output: {
        description: "Array of created variant objects.",
        example: [
          { id: "v-uuid-1", attributeValues: { size: "S", color: "Red" }, stockQuantity: "0.000" },
          { id: "v-uuid-2", attributeValues: { size: "M", color: "Red" }, stockQuantity: "0.000" },
        ],
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/item.bulkCreateVariants \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"itemId":"item-uuid","variants":[{"attributeValues":{"size":"S","color":"Red"}},{"attributeValues":{"size":"M","color":"Red"}}]}}'`,
        javascript: `const variants = await trpc.item.bulkCreateVariants.mutate({
  itemId: "item-uuid",
  variants: [
    { attributeValues: { size: "S", color: "Red" }, salePrice: "499.00" },
    { attributeValues: { size: "M", color: "Red" }, salePrice: "549.00" },
  ],
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/item.bulkCreateVariants",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"itemId": "item-uuid", "variants": [
        {"attributeValues": {"size": "S", "color": "Red"}},
        {"attributeValues": {"size": "M", "color": "Red"}},
    ]}},
)`,
      },
      gotchas: ["Returns BAD_REQUEST if the parent item is not in `variants` mode.", "Maximum 100 variants per call."],
    },
    {
      id: "item-suggest-merges",
      method: "query",
      path: "item.suggestMerges",
      title: "Suggest Merges",
      description: "Analyses items in the business and suggests potential merge candidates based on similar name prefixes. For example, 'Okra', 'Okra 0.25', 'Okra 0.5' would be grouped as a merge suggestion with suggested conversion factors.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Array of merge suggestion groups.",
        example: [
          {
            baseName: "Okra",
            items: [{ id: "i1", name: "Okra", unit: "kg", salePrice: "60.00", stockQuantity: "50.000" }, { id: "i2", name: "Okra 0.25", unit: "kg", salePrice: "15.00", stockQuantity: "20.000" }],
            suggestedConversions: [{ sourceId: "i2", sourceName: "Okra 0.25", targetId: "i1", targetName: "Okra", suggestedFactor: 0.25 }],
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/item.suggestMerges" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const suggestions = await trpc.item.suggestMerges.query();
suggestions.forEach(s => {
  console.log(s.baseName, "has", s.items.length, "potential duplicates");
});`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/item.suggestMerges",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Variant-mode items are excluded from suggestions.",
        "The `suggestedFactor` is extracted from trailing numbers in the name (e.g. 'Okra 0.25' \u2192 0.25). It may be `null` if no number is found.",
      ],
      relatedEndpoints: ["item-merge"],
    },
    {
      id: "item-merge",
      method: "mutation",
      path: "item.merge",
      title: "Merge Items",
      description: "Merge a source item into a target item. All invoice line items from the source are re-linked to the target (with conversion factor applied). Stock is merged. Missing fields are filled from the source. The source item is deleted.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "sourceId", type: "string (UUID)", required: true, description: "Item to merge from (will be deleted)" },
        { name: "targetId", type: "string (UUID)", required: true, description: "Item to merge into (will be kept)" },
        { name: "stockConversionFactor", type: "number", required: false, description: "Conversion factor for stock (source units \u2192 target units)", default: "1" },
      ],
      output: {
        description: "Success with the surviving item ID.",
        example: { success: true, mergedInto: "target-item-uuid" },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/item.merge \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"sourceId":"source-item-uuid","targetId":"target-item-uuid","stockConversionFactor":0.25}}'`,
        javascript: `const result = await trpc.item.merge.mutate({
  sourceId: "source-item-uuid",
  targetId: "target-item-uuid",
  stockConversionFactor: 0.25,
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/item.merge",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"sourceId": "source-item-uuid", "targetId": "target-item-uuid", "stockConversionFactor": 0.25}},
)`,
      },
      gotchas: [
        "Cannot merge variant-mode items \u2014 manage variants individually instead.",
        "Returns BAD_REQUEST if sourceId equals targetId.",
        "The merge is atomic. Invoice line items get their `conversionFactor` multiplied by `stockConversionFactor`.",
        "Unit variants from both items are combined (deduped by unit name).",
      ],
      relatedEndpoints: ["item-suggest-merges"],
    },
    {
      id: "item-adjust-stock",
      method: "mutation",
      path: "item.adjustStock",
      title: "Adjust Stock",
      description: "Manually adjust stock for an item or variant. Positive values increase stock, negative values decrease it. Records the adjustment in the `stockAdjustments` table for audit purposes.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "Item ID" },
        { name: "variantId", type: "string (UUID)", required: false, description: "Variant ID (for variant-mode items)" },
        { name: "quantity", type: "string (decimal)", required: true, description: "Adjustment quantity (positive to add, negative to subtract). Cannot be zero." },
        { name: "reason", type: "string", required: false, description: "Reason for adjustment (max 500 chars)" },
        { name: "adjustmentDate", type: "string (ISO datetime)", required: false, description: "Date of adjustment. Defaults to now." },
      ],
      output: {
        description: "The stock adjustment record.",
        example: {
          id: "adj-uuid",
          businessId: "biz-uuid",
          itemId: "item-uuid",
          variantId: null,
          quantity: "-5.000",
          previousStock: "245.000",
          newStock: "240.000",
          reason: "Damaged goods",
          adjustmentDate: "2026-04-08T10:00:00.000Z",
          createdByUserId: "user-uuid",
          createdByName: "Rahul Sharma",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/item.adjustStock \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"itemId":"item-uuid","quantity":"-5.000","reason":"Damaged goods"}}'`,
        javascript: `const adjustment = await trpc.item.adjustStock.mutate({
  itemId: "item-uuid",
  quantity: "-5.000",
  reason: "Damaged goods",
});
console.log("Stock:", adjustment.previousStock, "->", adjustment.newStock);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/item.adjustStock",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"itemId": "item-uuid", "quantity": "-5.000", "reason": "Damaged goods"}},
)`,
      },
      gotchas: [
        "Quantity cannot be zero \u2014 returns a validation error.",
        "For variant-mode items, provide `variantId` to adjust variant stock. Without it, adjusts the parent item stock.",
        "The item/variant row is locked with `FOR UPDATE` to prevent concurrent adjustments.",
        "Quantity format: string matching `/^-?\\d+(\\.\\d{1,3})?$/` (up to 3 decimal places).",
      ],
    },
    {
      id: "item-stock-adjustment-history",
      method: "query",
      path: "item.stockAdjustmentHistory",
      title: "Stock Adjustment History",
      description: "Paginated history of manual stock adjustments for an item or variant.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "itemId", type: "string (UUID)", required: true, description: "Item ID" },
        { name: "variantId", type: "string (UUID)", required: false, description: "Filter to a specific variant" },
        { name: "page", type: "number", required: false, description: "Page number", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page", default: "20" },
      ],
      output: {
        description: "Paginated adjustment records.",
        example: {
          data: [{ id: "adj-uuid", quantity: "-5.000", previousStock: "245.000", newStock: "240.000", reason: "Damaged goods", adjustmentDate: "2026-04-08T10:00:00.000Z", createdByName: "Rahul Sharma" }],
          total: 12, page: 1, limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/item.stockAdjustmentHistory?input=%7B%22json%22%3A%7B%22itemId%22%3A%22item-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const history = await trpc.item.stockAdjustmentHistory.query({
  itemId: "item-uuid",
  page: 1,
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"itemId": "item-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/item.stockAdjustmentHistory?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      relatedEndpoints: ["item-adjust-stock"],
    },
    {
      id: "item-low-stock-count",
      method: "query",
      path: "item.lowStockCount",
      title: "Low Stock Count",
      description: "Returns the total number of items and variants currently at or below their low-stock alert threshold. Use for badge counts in the navigation.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Integer count of low-stock items + variants.",
        example: 7,
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/item.lowStockCount" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const count = await trpc.item.lowStockCount.query();
if (count > 0) console.warn("Low stock alerts:", count);`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/item.lowStockCount",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Counts both simple items (where `items.stockQuantity <= items.lowStockAlert`) and variant items (where `itemVariants.stockQuantity <= itemVariants.lowStockAlert`).",
        "Items without a `lowStockAlert` threshold set are never counted.",
      ],
    },
  ],
};
