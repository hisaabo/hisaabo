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
              invoiceNumber: "INV-00042",
              type: "sale",
              status: "sent",
              documentType: "invoice",
              invoiceDate: "2024-03-15T00:00:00.000Z",
              dueDate: "2024-04-14T00:00:00.000Z",
              totalAmount: "15750.00",
              amountPaid: "0.00",
              partyName: "Acme Corp",
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
          invoiceNumber: "INV-00042",
          type: "sale",
          status: "sent",
          documentType: "invoice",
          invoiceDate: "2024-03-15T00:00:00.000Z",
          dueDate: "2024-04-14T00:00:00.000Z",
          subtotal: "13347.46",
          taxAmount: "2402.54",
          discountAmount: "0.00",
          additionalCharges: "0.00",
          roundOff: "0.00",
          totalAmount: "15750.00",
          amountPaid: "0.00",
          notes: "Payment due within 30 days.",
          termsAndConditions: null,
          lineItems: [
            {
              id: "li-uuid",
              description: "Premium Widget A",
              quantity: "10.000",
              unitPrice: "1334.75",
              taxPercent: "18.00",
              taxAmount: "2402.55",
              discountPercent: "0.00",
              totalAmount: "15750.00",
              sortOrder: 0,
              itemId: "item-uuid",
              variantId: null,
              selectedUnit: "pcs",
              conversionFactor: "1",
            },
          ],
          party: { id: "party-uuid", name: "Acme Corp", gstin: "27AADCB2230M1ZP", phone: "9876543210" },
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
      "partyId": "party-uuid",
      "type": "sale",
      "lineItems": [
        {
          "description": "Premium Widget A",
          "quantity": "10.000",
          "unitPrice": "1334.75",
          "taxPercent": "18.00",
          "discountPercent": "0.00",
          "itemId": "item-uuid"
        }
      ]
    }
  }'`,
        javascript: `const invoice = await trpc.invoice.create.mutate({
  partyId: "party-uuid",
  type: "sale",
  invoiceDate: new Date().toISOString(),
  lineItems: [
    {
      description: "Premium Widget A",
      quantity: "10.000",
      unitPrice: "1334.75",
      taxPercent: "18.00",
      discountPercent: "0.00",
      itemId: "item-uuid",
    },
  ],
  notes: "Payment due within 30 days.",
});

console.log("Created:", invoice.invoiceNumber); // "INV-00043"`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/invoice.create",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "partyId": "party-uuid",
        "type": "sale",
        "lineItems": [
            {
                "description": "Premium Widget A",
                "quantity": "10.000",
                "unitPrice": "1334.75",
                "taxPercent": "18.00",
                "discountPercent": "0.00",
            },
        ],
    }},
)
invoice = resp.json()["result"]["data"]["json"]
print("Created:", invoice["invoiceNumber"])`,
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
  ],
};
