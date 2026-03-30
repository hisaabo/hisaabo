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
  ],
};
