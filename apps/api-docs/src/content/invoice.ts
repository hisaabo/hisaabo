import type { EndpointGroup } from "./types";

export const invoiceEndpoints: EndpointGroup = {
  id: "invoices",
  title: "Invoices",
  description: "Create and manage sale and purchase invoices. Invoices are scoped to a business via the `x-business-id` header. Invoice numbers are atomically generated using a PostgreSQL row-level lock — no duplicate numbers even under concurrent requests.",
  endpoints: [
    {
      id: "invoice-list",
      method: "query",
      path: "invoice.list",
      title: "List Invoices",
      description: "Paginated list of invoices for the active business. Supports filtering by type, status, party, date range, and full-text search on invoice number and party name.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "documentType", type: "enum", required: false, description: "Document type to list", default: "invoice", enumValues: ["invoice", "quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return"] },
        { name: "type", type: "enum", required: false, description: "Filter by invoice direction", enumValues: ["sale", "purchase"] },
        { name: "status", type: "enum", required: false, description: "Filter by current status", enumValues: ["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"] },
        { name: "partyId", type: "string (UUID)", required: false, description: "Filter invoices for a specific party" },
        { name: "fromDate", type: "string (ISO 8601)", required: false, description: "Start of date range (inclusive)" },
        { name: "toDate", type: "string (ISO 8601)", required: false, description: "End of date range (inclusive)" },
        { name: "itemId", type: "string (UUID)", required: false, description: "Filter invoices containing a specific item" },
        { name: "search", type: "string", required: false, description: "Search by invoice number or party name (case-insensitive)" },
        { name: "sortBy", type: "enum", required: false, description: "Sort column", enumValues: ["date", "amount", "number"] },
        { name: "sortDir", type: "enum", required: false, description: "Sort direction", enumValues: ["asc", "desc"] },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated invoice list with party name denormalized.",
        example: {
          data: [
            {
              id: "inv-uuid",
              invoiceNumber: "BB-14821",
              type: "sale",
              status: "sent",
              documentType: "invoice",
              invoiceDate: "2026-03-26T00:00:00.000Z",
              dueDate: "2026-04-10T00:00:00.000Z",
              totalAmount: "26250.00",
              amountPaid: "0.00",
              balanceDue: "26250.00",
              partyName: "Gupta Enterprises",
              partyId: "party-uuid",
              createdByName: "Rahul Sharma",
            },
          ],
          total: 156,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/invoice.list?input=%7B%22json%22%3A%7B%22page%22%3A1%2C%22limit%22%3A20%2C%22type%22%3A%22sale%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.invoice.list.query({
  type: "sale",
  status: "sent",
  page: 1,
  limit: 20,
});

console.log(\`Showing \${data.length} of \${total} invoices\`);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"page": 1, "limit": 20, "type": "sale"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/invoice.list?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Monetary values (`totalAmount`, `amountPaid`) are returned as strings to preserve decimal precision — never parse them with `parseFloat`.",
        "Requires the `x-business-id` header. Without it, the request returns BAD_REQUEST (400).",
        "Soft-deleted invoices (with `deletedAt` set) are excluded from results.",
      ],
    },
    {
      id: "invoice-get-by-id",
      method: "query",
      path: "invoice.getById",
      title: "Get Invoice",
      description: "Fetch a single invoice by ID, including all line items and the associated party. Returns `null` if the invoice does not exist or belongs to a different business.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Invoice ID" },
      ],
      output: {
        description: "Full invoice object with line items and party.",
        example: {
          id: "inv-uuid",
          invoiceNumber: "BB-14821",
          type: "sale",
          status: "sent",
          documentType: "invoice",
          invoiceDate: "2026-03-26T00:00:00.000Z",
          dueDate: "2026-04-10T00:00:00.000Z",
          subtotal: "25000.00",
          taxAmount: "1250.00",
          discountAmount: "0.00",
          additionalCharges: "0.00",
          roundOff: "0.00",
          totalAmount: "26250.00",
          amountPaid: "0.00",
          balanceDue: "26250.00",
          notes: "Delivery to warehouse on 28th. NEFT payment preferred.",
          termsAndConditions: null,
          lineItems: [
            {
              id: "li-uuid",
              description: "Basmati Rice 25kg",
              quantity: "20.000",
              unitPrice: "1250.00",
              taxPercent: "5.00",
              taxAmount: "1250.00",
              discountPercent: "0.00",
              totalAmount: "26250.00",
              sortOrder: 0,
              itemId: "item-uuid",
              variantId: null,
              selectedUnit: "bag",
              conversionFactor: "1",
            },
          ],
          party: { id: "party-uuid", name: "Gupta Enterprises", gstin: "07AABCG5432M1Z3", phone: "9876543210" },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/invoice.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22inv-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const invoice = await trpc.invoice.getById.query({ id: "inv-uuid" });

if (!invoice) {
  console.log("Invoice not found");
  return;
}

const balance = Number(invoice.totalAmount) - Number(invoice.amountPaid);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "inv-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/invoice.getById?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
    },
    {
      id: "invoice-create",
      method: "mutation",
      path: "invoice.create",
      title: "Create Invoice",
      description: "Create a new invoice or document (quotation, credit note, delivery challan, etc.). Invoice number is atomically generated using a PostgreSQL SELECT...FOR UPDATE lock on the business row. Stock quantities are updated in the same transaction for sale/purchase invoices.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "Customer or supplier ID" },
        { name: "type", type: "enum", required: true, description: "Invoice direction", enumValues: ["sale", "purchase"] },
        { name: "documentType", type: "enum", required: false, description: "Document subtype", default: "invoice", enumValues: ["invoice", "quotation", "credit_note", "debit_note", "delivery_challan", "proforma", "sales_return", "purchase_return"] },
        { name: "invoiceDate", type: "string (ISO 8601)", required: false, description: "Invoice date. Defaults to current date." },
        { name: "dueDate", type: "string (ISO 8601)", required: false, description: "Payment due date" },
        { name: "lineItems", type: "array", required: true, description: "At least one line item required. See line item schema below." },
        { name: "lineItems[].description", type: "string", required: true, description: "Line item description (1–500 chars)" },
        { name: "lineItems[].quantity", type: "string (decimal)", required: true, description: "Quantity as decimal string, e.g. `\"10.000\"`" },
        { name: "lineItems[].unitPrice", type: "string (decimal)", required: true, description: "Unit price as decimal string, e.g. `\"1500.00\"`" },
        { name: "lineItems[].taxPercent", type: "string (decimal)", required: false, description: "Tax rate percentage (0–56), e.g. `\"18.00\"`", default: "0" },
        { name: "lineItems[].discountPercent", type: "string (decimal)", required: false, description: "Line-level discount percentage (0–100), e.g. `\"5.00\"`", default: "0" },
        { name: "lineItems[].itemId", type: "string (UUID)", required: false, description: "Linked item catalog entry (updates stock)" },
        { name: "lineItems[].variantId", type: "string (UUID)", required: false, description: "Specific item variant (updates variant stock)" },
        { name: "lineItems[].selectedUnit", type: "string", required: false, description: "Display unit for alt_unit items" },
        { name: "lineItems[].conversionFactor", type: "string", required: false, description: "Unit conversion factor for alt_unit items", default: "1" },
        { name: "charges", type: "array", required: false, description: "Additional charges (e.g. shipping). Each item: `{label: string, amount: decimal string}`." },
        { name: "invoiceDiscount", type: "string (decimal)", required: false, description: "Invoice-level discount amount or percentage", default: "0" },
        { name: "invoiceDiscountType", type: "enum", required: false, description: "How to apply invoice-level discount", default: "amount", enumValues: ["amount", "percent"] },
        { name: "roundOff", type: "string (decimal)", required: false, description: "Round-off adjustment (can be negative), e.g. `\"0.50\"`", default: "0" },
        { name: "notes", type: "string", required: false, description: "Internal or customer-facing notes (max 2000 chars)" },
        { name: "termsAndConditions", type: "string", required: false, description: "T&C text printed on the invoice (max 2000 chars)" },
        { name: "deliveryMethod", type: "enum", required: false, description: "How the goods are delivered. Defaults to `\"self_pickup\"` if omitted. Self-pickup invoices do not auto-create a shipment record. Use `invoice.lastDeliveryMethod` to pre-populate this from the party's previous invoice.", default: "self_pickup", enumValues: ["self_pickup", "hand_delivery", "courier", "bus", "transport", "post"] },
        { name: "referenceDocumentId", type: "string (UUID)", required: false, description: "ID of the source document (e.g. quotation being converted to invoice)" },
      ],
      output: {
        description: "Created invoice with generated invoice number and calculated totals.",
        example: {
          id: "inv-uuid",
          invoiceNumber: "INV-00043",
          businessId: "biz-uuid",
          partyId: "party-uuid",
          type: "sale",
          documentType: "invoice",
          status: "draft",
          invoiceDate: "2024-03-16T00:00:00.000Z",
          dueDate: null,
          subtotal: "13347.46",
          taxAmount: "2402.54",
          discountAmount: "0.00",
          additionalCharges: "0.00",
          roundOff: "0.00",
          totalAmount: "15750.00",
          amountPaid: "0.00",
          notes: null,
          createdByName: "Rahul Sharma",
          createdAt: "2024-03-16T10:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/invoice.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "partyId": "gupta-enterprises-party-uuid",
      "type": "sale",
      "invoiceDate": "2026-03-26T00:00:00.000Z",
      "dueDate": "2026-04-10T00:00:00.000Z",
      "lineItems": [
        {
          "description": "Basmati Rice 25kg",
          "quantity": "20.000",
          "unitPrice": "1250.00",
          "taxPercent": "5.00",
          "discountPercent": "0.00",
          "itemId": "basmati-rice-item-uuid"
        }
      ],
      "notes": "Delivery to warehouse on 28th. NEFT payment preferred."
    }
  }'`,
        javascript: `const invoice = await trpc.invoice.create.mutate({
  partyId: "gupta-enterprises-party-uuid",
  type: "sale",
  invoiceDate: "2026-03-26T00:00:00.000Z",
  dueDate: "2026-04-10T00:00:00.000Z",
  lineItems: [
    {
      description: "Basmati Rice 25kg",
      quantity: "20.000",    // 20 bags
      unitPrice: "1250.00",  // ₹1,250 per bag
      taxPercent: "5.00",    // GST 5% — HSN 1006
      discountPercent: "0.00",
      itemId: "basmati-rice-item-uuid",
    },
  ],
  notes: "Delivery to warehouse on 28th. NEFT payment preferred.",
});

console.log("Created:", invoice.invoiceNumber); // "BB-14822"
console.log("Total:  ", invoice.totalAmount);   // "26250.00" (₹25,000 + ₹1,250 GST)`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/invoice.create",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "partyId": "gupta-enterprises-party-uuid",
        "type": "sale",
        "invoiceDate": "2026-03-26T00:00:00.000Z",
        "dueDate": "2026-04-10T00:00:00.000Z",
        "lineItems": [
            {
                "description": "Basmati Rice 25kg",
                "quantity": "20.000",
                "unitPrice": "1250.00",
                "taxPercent": "5.00",   # GST 5% — HSN 1006
                "discountPercent": "0.00",
            },
        ],
        "notes": "Delivery to warehouse on 28th. NEFT payment preferred.",
    }},
)
invoice = resp.json()["result"]["data"]["json"]
print("Created:", invoice["invoiceNumber"])  # "BB-14822"
print("Total:  ", invoice["totalAmount"])    # "26250.00"`,
      },
      gotchas: [
        "All monetary values (`quantity`, `unitPrice`, `taxPercent`, etc.) must be passed as strings, not numbers. The API enforces `NUMERIC(15,2)` precision.",
        "Invoice number is auto-generated — you cannot set it manually. Use `business.updateSequenceNumber` to adjust the counter.",
        "Stock is updated atomically in the same transaction as invoice creation. If stock update fails, the invoice is not created.",
        "`status` is always `draft` on creation. Use `invoice.updateStatus` to advance the lifecycle.",
        "Tax percent is validated to be ≤ 56% (the maximum GST rate including cess).",
      ],
      relatedEndpoints: ["invoice-update-status", "party-list", "item-list"],
    },
    {
      id: "invoice-update-status",
      method: "mutation",
      path: "invoice.updateStatus",
      title: "Update Invoice Status",
      description: "Change the lifecycle status of an invoice. Status transitions are not enforced by the API — any status can be set, but the UI follows the logical flow: draft → unfulfilled → sent → paid.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Invoice ID" },
        { name: "status", type: "enum", required: true, description: "New status", enumValues: ["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"] },
      ],
      output: {
        description: "Updated invoice object.",
        example: {
          id: "inv-uuid",
          invoiceNumber: "INV-00042",
          status: "sent",
          updatedAt: "2024-03-16T11:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/invoice.updateStatus \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"inv-uuid","status":"sent"}}'`,
        javascript: `await trpc.invoice.updateStatus.mutate({
  id: "inv-uuid",
  status: "sent",
});`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/invoice.updateStatus",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "inv-uuid", "status": "sent"}},
)`,
      },
      gotchas: [
        "Setting status to `paid` manually does NOT record a payment transaction. Use `payment.create` to record actual payments, which automatically updates `amountPaid` and advances status.",
      ],
    },
    {
      id: "invoice-delete",
      method: "mutation",
      path: "invoice.delete",
      title: "Delete Invoice",
      description: "Soft-delete an invoice. The record is not physically removed — `deletedAt` is set and `status` is changed to `cancelled`. Requires `admin` role. Users with `seller_manager` role can only delete unpaid invoices created within the last 2 hours.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Invoice ID to delete" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/invoice.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"inv-uuid"}}'`,
        javascript: `await trpc.invoice.delete.mutate({ id: "inv-uuid" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/invoice.delete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "inv-uuid"}},
)`,
      },
      gotchas: [
        "This is a soft delete — the invoice remains in the database with `deletedAt` set. It will not appear in `invoice.list` results.",
        "Paid invoices cannot be deleted by `seller_manager` role. An `admin` or `owner` can delete any invoice.",
        "Deleting an invoice does NOT reverse stock adjustments. Reverse them manually via `item.adjustStock` if needed.",
        "An audit log entry is created for every deletion.",
      ],
    },
    {
      id: "invoice-last-delivery-method",
      method: "query",
      path: "invoice.lastDeliveryMethod",
      title: "Get Last Delivery Method",
      description: "Returns the `deliveryMethod` from the most recent sale invoice for a given party. Used by the invoice form to auto-select the delivery method when creating a repeat invoice, reducing re-entry friction. Returns `null` if the party has no prior sale invoices.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "The party whose last sale invoice delivery method should be returned." },
      ],
      output: {
        description: "The delivery method string from the party's most recent sale invoice, or `null`.",
        example: { deliveryMethod: "courier" },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/invoice.lastDeliveryMethod?input=%7B%22json%22%3A%7B%22partyId%22%3A%22party-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { deliveryMethod } = await trpc.invoice.lastDeliveryMethod.query({
  partyId: "party-uuid",
});
// Use as the default value in the invoice form
// deliveryMethod is null if no prior invoices exist for this party`,
        python: `import httpx, urllib.parse, json

params = urllib.parse.urlencode({
    "input": json.dumps({"json": {"partyId": "party-uuid"}})
})
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/invoice.lastDeliveryMethod?{params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
result = resp.json()["result"]["data"]["json"]
delivery_method = result.get("deliveryMethod")  # None if no prior invoices`,
      },
      gotchas: [
        "Only sale invoices are considered — purchase invoices are excluded.",
        "Returns `null` (not an error) when no prior invoices exist. Always handle the null case before using the result as a default.",
        "The returned value matches the `deliveryMethods` enum exported from `@hisaabo/shared`: `self_pickup`, `hand_delivery`, `courier`, `bus`, `transport`, `post`.",
      ],
      relatedEndpoints: ["invoice-create"],
    },
  ],
};
