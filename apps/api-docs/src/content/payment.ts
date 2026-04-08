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
    {
      id: "payment-unpaid-invoices",
      method: "query",
      path: "payment.unpaidInvoices",
      title: "Unpaid Invoices",
      description: "Returns all unpaid or partially-paid invoices for a given party. Useful for populating the invoice selection dropdown when recording a payment.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "Party ID" },
      ],
      output: {
        description: "Array of unpaid invoices with calculated balance.",
        example: [
          { id: "inv-uuid", invoiceNumber: "INV-0042", invoiceDate: "2026-03-01T00:00:00.000Z", totalAmount: "15750.00", amountPaid: "5000.00", status: "partial", type: "sale", balance: "10750.00" },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/payment.unpaidInvoices?input=%7B%22json%22%3A%7B%22partyId%22%3A%22party-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const invoices = await trpc.payment.unpaidInvoices.query({ partyId: "party-uuid" });
invoices.forEach(inv => {
  console.log(inv.invoiceNumber, "balance:", inv.balance);
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"partyId": "party-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/payment.unpaidInvoices?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Excludes paid, cancelled, and draft invoices.",
        "Only `documentType: 'invoice'` documents are returned (not quotations or challans).",
        "`balance` = `totalAmount - amountPaid`.",
      ],
      relatedEndpoints: ["payment-create"],
    },
    {
      id: "payment-default-account",
      method: "query",
      path: "payment.defaultAccount",
      title: "Default Account",
      description: "Returns the most appropriate bank account to pre-select when recording a payment. Priority: (1) most recent account used for this party, (2) most common recent account business-wide, (3) the account marked `isDefault`.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "partyId", type: "string (UUID)", required: false, description: "Optional party ID to check party-specific payment history" },
      ],
      output: {
        description: "Bank account object or null if no accounts exist.",
        example: { id: "account-uuid", accountName: "HDFC Current", accountType: "current", currentBalance: "245000.00", isDefault: true },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/payment.defaultAccount?input=%7B%22json%22%3A%7B%22partyId%22%3A%22party-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const account = await trpc.payment.defaultAccount.query({ partyId: "party-uuid" });
if (account) {
  console.log("Default:", account.accountName);
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"partyId": "party-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/payment.defaultAccount?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Returns `null` if no bank accounts exist for the business.",
        "The party-specific lookup checks the 3 most recent payments for that party.",
        "The business-wide lookup checks the 5 most recent payments and picks the most frequent account.",
      ],
    },
    {
      id: "payment-get-by-id",
      method: "query",
      path: "payment.getById",
      title: "Get Payment",
      description: "Fetch a payment by ID with all linked invoices. For multi-allocation payments, returns the full allocation breakdown. For legacy single-invoice payments, falls back to the `invoiceId` field.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Payment ID" },
      ],
      output: {
        description: "Payment with linked invoices array, or null if not found.",
        example: {
          id: "pay-uuid",
          paymentNumber: "PAY-00018",
          amount: "30000.00",
          mode: "bank",
          partyId: "party-uuid",
          partyName: "Acme Corp",
          linkedInvoices: [
            { invoiceId: "inv-uuid-1", invoiceNumber: "INV-0040", invoiceDate: "2026-03-01T00:00:00.000Z", totalAmount: "15750.00", amountPaid: "15750.00", status: "paid", amount: "15750.00" },
            { invoiceId: "inv-uuid-2", invoiceNumber: "INV-0041", invoiceDate: "2026-03-10T00:00:00.000Z", totalAmount: "20000.00", amountPaid: "14250.00", status: "partial", amount: "14250.00" },
          ],
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/payment.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22pay-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const payment = await trpc.payment.getById.query({ id: "pay-uuid" });
if (payment) {
  console.log("Allocated to", payment.linkedInvoices.length, "invoices");
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "pay-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/payment.getById?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Returns `null` if the payment is not found in the active business.",
        "`linkedInvoices` comes from the `paymentAllocations` junction table. Legacy payments without allocations fall back to the `invoiceId` column.",
      ],
      relatedEndpoints: ["payment-list", "payment-create"],
    },
    {
      id: "payment-update",
      method: "mutation",
      path: "payment.update",
      title: "Update Payment",
      description: "Update an existing payment. The update is transactional: old invoice allocations and bank transactions are reversed, then new ones are applied. Supports changing amount, mode, bank account, and allocations.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Payment ID" },
        { name: "amount", type: "string (decimal)", required: false, description: "Updated amount" },
        { name: "mode", type: "enum", required: false, description: "Updated payment mode", enumValues: ["cash", "bank", "upi", "cheque", "other"] },
        { name: "referenceNumber", type: "string", required: false, description: "Updated reference number (pass null to clear)" },
        { name: "notes", type: "string", required: false, description: "Updated notes (pass null to clear)" },
        { name: "bankAccountId", type: "string (UUID)", required: false, description: "Updated bank account (pass null to clear)" },
        { name: "paymentDate", type: "string (ISO 8601)", required: false, description: "Updated payment date" },
        { name: "discount", type: "string (decimal)", required: false, description: "Updated discount" },
        { name: "allocations", type: "array", required: false, description: "Updated multi-invoice allocations. Each: `{invoiceId, amount}`" },
      ],
      output: {
        description: "Updated payment object.",
        example: { id: "pay-uuid", paymentNumber: "PAY-00018", amount: "32000.00", mode: "upi" },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/payment.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"pay-uuid","amount":"32000.00","mode":"upi"}}'`,
        javascript: `const updated = await trpc.payment.update.mutate({
  id: "pay-uuid",
  amount: "32000.00",
  mode: "upi",
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/payment.update",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "pay-uuid", "amount": "32000.00", "mode": "upi"}},
)`,
      },
      gotchas: [
        "The entire old state is reversed (invoice allocations + bank transactions) before applying the new state.",
        "Overpayment guard still applies \u2014 allocations cannot exceed invoice balances.",
        "Gateway charge and settlement operations are also reversed and re-processed if the bank account is a payment gateway.",
      ],
      relatedEndpoints: ["payment-get-by-id"],
    },
    {
      id: "payment-delete",
      method: "mutation",
      path: "payment.delete",
      title: "Delete Payment",
      description: "Soft-delete a payment. Reverses all invoice allocations and bank transactions. The payment record remains with a `deletedAt` timestamp. Requires `admin` role.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Payment ID" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/payment.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"pay-uuid"}}'`,
        javascript: `await trpc.payment.delete.mutate({ id: "pay-uuid" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/payment.delete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "pay-uuid"}},
)`,
      },
      gotchas: [
        "Soft-delete only \u2014 sets `deletedAt` timestamp. The record is excluded from `payment.list`.",
        "Invoice `amountPaid` and `status` are reversed atomically.",
        "Bank account balance is restored if a bank transaction existed.",
        "Idempotent: deleting an already-deleted payment returns `{success: true}`.",
        "Gateway operations (charge + settlement) are also reversed.",
      ],
    },
    {
      id: "payment-untracked-payments",
      method: "query",
      path: "payment.untrackedPayments",
      title: "Untracked Payments",
      description: "Paginated list of payments that have no bank account assigned (`bankAccountId IS NULL`). Use this to find payments that need to be reconciled with a bank account.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "search", type: "string", required: false, description: "Search by payment number or party name" },
        { name: "mode", type: "enum", required: false, description: "Filter by payment mode", enumValues: ["cash", "bank", "upi", "cheque", "other"] },
        { name: "fromDate", type: "string (ISO 8601)", required: false, description: "Start of date range" },
        { name: "toDate", type: "string (ISO 8601)", required: false, description: "End of date range" },
        { name: "page", type: "number", required: false, description: "Page number", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page", default: "20" },
      ],
      output: {
        description: "Paginated untracked payments.",
        example: {
          data: [{ id: "pay-uuid", paymentNumber: "PAY-00005", amount: "8500.00", mode: "cash", paymentDate: "2026-03-15T00:00:00.000Z", referenceNumber: null, partyName: "Sharma Electronics", partyId: "party-uuid" }],
          total: 15, page: 1, limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/payment.untrackedPayments?input=%7B%22json%22%3A%7B%22mode%22%3A%22cash%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.payment.untrackedPayments.query({
  mode: "cash",
  page: 1,
});
console.log("Untracked cash payments:", total);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"mode": "cash"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/payment.untrackedPayments?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      relatedEndpoints: ["payment-assign-account"],
    },
    {
      id: "payment-assign-account",
      method: "mutation",
      path: "payment.assignAccount",
      title: "Assign Account",
      description: "Assign a bank account to untracked payments. Can target specific payment IDs or bulk-assign all matching untracked payments. Creates bank transactions and updates account balances.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "bankAccountId", type: "string (UUID)", required: true, description: "Bank account to assign" },
        { name: "paymentIds", type: "array of UUIDs", required: false, description: "Specific payment IDs to assign" },
        { name: "allMatching", type: "boolean", required: false, description: "If true, assign ALL untracked payments matching the filters" },
        { name: "search", type: "string", required: false, description: "Filter for bulk assignment (used with `allMatching`)" },
        { name: "mode", type: "enum", required: false, description: "Filter for bulk assignment", enumValues: ["cash", "bank", "upi", "cheque", "other"] },
      ],
      output: {
        description: "Count of assigned payments and total amount.",
        example: { assignedCount: 15, totalAmount: "127500.00" },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/payment.assignAccount \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"bankAccountId":"account-uuid","allMatching":true,"mode":"cash"}}'`,
        javascript: `// Assign all untracked cash payments to the Cash account
const result = await trpc.payment.assignAccount.mutate({
  bankAccountId: "cash-account-uuid",
  allMatching: true,
  mode: "cash",
});
console.log("Assigned:", result.assignedCount, "Total:", result.totalAmount);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/payment.assignAccount",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"bankAccountId": "cash-account-uuid", "allMatching": True, "mode": "cash"}},
)`,
      },
      gotchas: [
        "The bank account balance is updated for all assigned payments in a single transaction.",
        "Each payment gets a bank transaction record created.",
        "Returns NOT_FOUND if the bank account does not belong to the active business.",
        "Either `paymentIds` or `allMatching: true` must be provided.",
      ],
      relatedEndpoints: ["payment-untracked-payments"],
    },
  ],
};
