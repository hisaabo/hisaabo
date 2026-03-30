import type { EndpointGroup } from "./types";

export const paymentEndpoints: EndpointGroup = {
  id: "payments",
  title: "Payments",
  description: "Record and manage payment transactions. A payment can be linked to a single invoice or allocated across multiple invoices (multi-allocation). Recording a payment atomically updates the invoice's `amountPaid` and advances its status to `partial` or `paid`.",
  endpoints: [
    {
      id: "payment-list",
      method: "query",
      path: "payment.list",
      title: "List Payments",
      description: "Paginated list of payments with optional filtering by party, invoice, and date range.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "partyId", type: "string (UUID)", required: false, description: "Filter payments for a specific party" },
        { name: "invoiceId", type: "string (UUID)", required: false, description: "Filter payments linked to a specific invoice" },
        { name: "fromDate", type: "string (ISO 8601)", required: false, description: "Start of payment date range" },
        { name: "toDate", type: "string (ISO 8601)", required: false, description: "End of payment date range" },
        { name: "search", type: "string", required: false, description: "Search by payment number or party name" },
        { name: "page", type: "number", required: false, description: "Page number", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated payments with denormalized party name.",
        example: {
          data: [
            {
              id: "pay-uuid",
              paymentNumber: "PAY-00018",
              amount: "15750.00",
              discount: "0.00",
              mode: "bank",
              paymentDate: "2024-03-20T00:00:00.000Z",
              referenceNumber: "NEFT2024031800042",
              notes: null,
              partyName: "Acme Corp",
              partyId: "party-uuid",
              invoiceId: "inv-uuid",
              bankAccountId: "account-uuid",
            },
          ],
          total: 89,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/payment.list?input=%7B%22json%22%3A%7B%22partyId%22%3A%22party-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.payment.list.query({
  partyId: "party-uuid",
  page: 1,
  limit: 20,
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"partyId": "party-uuid", "page": 1}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/payment.list?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
    },
    {
      id: "payment-create",
      method: "mutation",
      path: "payment.create",
      title: "Record Payment",
      description: "Record a payment from a customer or to a supplier. Automatically updates the invoice's `amountPaid` and advances its status. Supports multi-invoice allocation — split one payment across multiple invoices using the `allocations` array. An overpayment guard prevents allocating more than the invoice balance.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "Party making or receiving the payment" },
        { name: "amount", type: "string (decimal)", required: true, description: "Total payment amount" },
        { name: "mode", type: "enum", required: true, description: "Payment method", enumValues: ["cash", "bank", "upi", "cheque", "other"] },
        { name: "invoiceId", type: "string (UUID)", required: false, description: "Invoice to apply this payment to (for single-invoice payments)" },
        { name: "discount", type: "string (decimal)", required: false, description: "Settlement discount given (reduces invoice balance without a refund)", default: "0" },
        { name: "referenceNumber", type: "string", required: false, description: "Transaction/cheque/UTR reference (max 100 chars)" },
        { name: "paymentDate", type: "string (ISO 8601)", required: false, description: "Date of payment. Defaults to current date." },
        { name: "notes", type: "string", required: false, description: "Internal notes (max 500 chars)" },
        { name: "bankAccountId", type: "string (UUID)", required: false, description: "Bank account to credit/debit" },
        { name: "allocations", type: "array", required: false, description: "Multi-invoice allocation. Overrides `invoiceId` if provided. Each: `{invoiceId: UUID, amount: decimal string}`" },
      ],
      output: {
        description: "Created payment with auto-generated payment number.",
        example: {
          id: "pay-uuid",
          paymentNumber: "PAY-00019",
          businessId: "biz-uuid",
          partyId: "party-uuid",
          invoiceId: "inv-uuid",
          amount: "15750.00",
          discount: "0.00",
          mode: "bank",
          referenceNumber: "NEFT2024031800042",
          paymentDate: "2024-03-20T00:00:00.000Z",
          notes: null,
          bankAccountId: "account-uuid",
          createdAt: "2024-03-20T14:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `# Single invoice payment
curl -X POST https://api.hisaabo.in/api/trpc/payment.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "partyId": "party-uuid",
      "invoiceId": "inv-uuid",
      "amount": "15750.00",
      "mode": "bank",
      "referenceNumber": "NEFT2024031800042"
    }
  }'`,
        javascript: `// Single invoice payment
const payment = await trpc.payment.create.mutate({
  partyId: "party-uuid",
  invoiceId: "inv-uuid",
  amount: "15750.00",
  mode: "bank",
  referenceNumber: "NEFT2024031800042",
  bankAccountId: "account-uuid",
});

// Multi-invoice allocation: split ₹30,000 across two invoices
const bulkPayment = await trpc.payment.create.mutate({
  partyId: "party-uuid",
  amount: "30000.00",
  mode: "bank",
  allocations: [
    { invoiceId: "inv-uuid-1", amount: "15750.00" },
    { invoiceId: "inv-uuid-2", amount: "14250.00" },
  ],
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/payment.create",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {
        "partyId": "party-uuid",
        "invoiceId": "inv-uuid",
        "amount": "15750.00",
        "mode": "bank",
        "referenceNumber": "NEFT2024031800042",
    }},
)`,
      },
      gotchas: [
        "Overpayment guard: allocating more than the invoice balance returns BAD_REQUEST. Check `invoice.getById` for the current balance first.",
        "When `allocations` is provided, `invoiceId` is ignored. The first allocation's invoiceId is stored as the primary reference for list views.",
        "The `discount` field represents a settlement discount (early payment discount). It reduces the invoice balance without creating a refund.",
        "Payment number is auto-generated (e.g. `PAY-00019`). Use `business.updateSequenceNumber` to adjust the counter.",
        "Bank account balance is updated automatically when `bankAccountId` is provided.",
      ],
      relatedEndpoints: ["invoice-list", "payment-list"],
    },
  ],
};
