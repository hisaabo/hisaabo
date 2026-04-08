import type { EndpointGroup } from "./types";

export const importEndpoints: EndpointGroup = {
  id: "import",
  title: "Bulk Import",
  description: "Bulk import data from CSV files or other systems. Import parties, items, invoices, payments, and bank transfers in batch. Includes reconciliation for payments that arrive without matching invoices.",
  endpoints: [
    {
      id: "import-parties",
      method: "mutation",
      path: "import.importParties",
      title: "Import Parties",
      description: "Bulk import customers and suppliers from an external source. Each row is transformed through a source-specific adapter (e.g. MyBillBook, Hisaabo) to normalize field names and formats. Validates all rows against the canonical party schema before importing. Deduplicates by name — existing parties are updated, new ones are created.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "source", type: "string", required: false, description: "Import source adapter to use for field transformation", default: "mybillbook" },
        { name: "parties", type: "array", required: true, description: "Array of party objects to import. Each object has: name (required), type, phone, email, gstin, pan, openingBalance, billingAddress, shippingAddress, city, state, pincode." },
      ],
      output: {
        description: "Import results with counts of created, updated, and skipped records.",
        example: {
          created: 45,
          updated: 12,
          skipped: 3,
          errors: [],
          total: 60,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/import.importParties \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{
    "source": "mybillbook",
    "parties": [
      {"name": "Gupta Enterprises", "type": "customer", "phone": "9876543210", "gstin": "07AAACG1234A1Z5", "city": "Delhi", "state": "Delhi"},
      {"name": "Sharma Suppliers", "type": "supplier", "phone": "9123456789", "openingBalance": "15000.00", "city": "Jaipur", "state": "Rajasthan"}
    ]
  }}'`,
        javascript: `const result = await trpc.import.importParties.mutate({
  source: "mybillbook",
  parties: [
    {
      name: "Gupta Enterprises",
      type: "customer",
      phone: "9876543210",
      gstin: "07AAACG1234A1Z5",
      city: "Delhi",
      state: "Delhi",
    },
    {
      name: "Sharma Suppliers",
      type: "supplier",
      phone: "9123456789",
      openingBalance: "15000.00",
      city: "Jaipur",
      state: "Rajasthan",
    },
  ],
});
console.log(\`Created: \${result.created}, Updated: \${result.updated}\`);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/import.importParties",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "source": "mybillbook",
        "parties": [
            {"name": "Gupta Enterprises", "type": "customer", "phone": "9876543210",
             "gstin": "07AAACG1234A1Z5", "city": "Delhi", "state": "Delhi"},
            {"name": "Sharma Suppliers", "type": "supplier", "phone": "9123456789",
             "openingBalance": "15000.00", "city": "Jaipur", "state": "Rajasthan"},
        ],
    }},
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Requires admin-level permission (`manage` on Import resource).",
        "All rows are validated before any are imported — if any row fails validation, the entire request fails with detailed error messages per row.",
        "Monetary values like `openingBalance` must be strings (e.g. '15000.00', not 15000).",
        "The `source` adapter transforms field names from the source format (e.g. MyBillBook CSV columns) to the canonical schema.",
        "Deduplication is by party name — if a party with the same name already exists, it is updated rather than duplicated.",
      ],
    },
    {
      id: "import-items",
      method: "mutation",
      path: "import.importItems",
      title: "Import Items",
      description: "Bulk import products and services from an external source. Each row is transformed through the source adapter, validated against the canonical item schema, and imported. Handles unit normalization (e.g. 'Pieces' -> 'pcs') and mode detection via the adapter.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "source", type: "string", required: false, description: "Import source adapter", default: "mybillbook" },
        { name: "items", type: "array", required: true, description: "Array of item objects. Each has: name (required), itemType, salePrice, purchasePrice, taxPercent, hsn, unit, stockQuantity, sku, category." },
      ],
      output: {
        description: "Import results with counts.",
        example: {
          created: 120,
          updated: 8,
          skipped: 2,
          errors: [],
          total: 130,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/import.importItems \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{
    "source": "mybillbook",
    "items": [
      {"name": "Kaju Katli (500g)", "itemType": "product", "salePrice": "850.00", "taxPercent": "5", "hsn": "1704", "unit": "box", "stockQuantity": "50", "category": "Sweets"},
      {"name": "Annual Maintenance", "itemType": "service", "salePrice": "25000.00", "taxPercent": "18", "unit": "nos"}
    ]
  }}'`,
        javascript: `const result = await trpc.import.importItems.mutate({
  source: "mybillbook",
  items: [
    {
      name: "Kaju Katli (500g)",
      itemType: "product",
      salePrice: "850.00",
      taxPercent: "5",
      hsn: "1704",
      unit: "box",
      stockQuantity: "50",
      category: "Sweets",
    },
    {
      name: "Annual Maintenance",
      itemType: "service",
      salePrice: "25000.00",
      taxPercent: "18",
      unit: "nos",
    },
  ],
});
console.log(\`Imported \${result.created} items\`);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/import.importItems",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "source": "mybillbook",
        "items": [
            {"name": "Kaju Katli (500g)", "itemType": "product", "salePrice": "850.00",
             "taxPercent": "5", "hsn": "1704", "unit": "box", "stockQuantity": "50", "category": "Sweets"},
            {"name": "Annual Maintenance", "itemType": "service", "salePrice": "25000.00",
             "taxPercent": "18", "unit": "nos"},
        ],
    }},
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Requires admin-level permission (`manage` on Import resource).",
        "All monetary values (salePrice, purchasePrice, taxPercent) must be strings.",
        "The `unit` field is normalized by the adapter — 'Pieces', 'Pcs', 'pcs' all map to 'pcs'.",
        "Items without a `salePrice` will have it set to '0' by default.",
        "Deduplication is by item name within the business.",
      ],
    },
    {
      id: "import-invoices",
      method: "mutation",
      path: "import.importInvoices",
      title: "Import Invoices",
      description: "Bulk import invoices with optional auto-payment creation. Each invoice is matched to an existing party by name. Line items can be included for detailed import. If `autoCreatePayments` is true, paid invoices automatically get payment records created. Uses atomic invoice number generation.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "source", type: "string", required: false, description: "Import source adapter", default: "mybillbook" },
        { name: "autoCreatePayments", type: "boolean", required: false, description: "Automatically create payment records for invoices with amountPaid > 0", default: "false" },
        { name: "defaultPaymentMode", type: "enum", required: false, description: "Default payment mode for auto-created payments", default: "cash", enumValues: ["cash", "bank", "upi", "cheque", "other"] },
        { name: "invoices", type: "array", required: true, description: "Array of invoice objects with line items" },
      ],
      output: {
        description: "Import results with created invoices and optional payment counts.",
        example: {
          created: 85,
          updated: 0,
          skipped: 5,
          errors: ["Invoice INV-001: Party 'Unknown Corp' not found"],
          paymentsCreated: 42,
          total: 90,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/import.importInvoices \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{
    "source": "mybillbook",
    "autoCreatePayments": true,
    "defaultPaymentMode": "bank",
    "invoices": [
      {
        "invoiceNumber": "INV-2026-001",
        "invoiceDate": "2026-03-15",
        "partyName": "Gupta Enterprises",
        "type": "sale",
        "status": "paid",
        "totalAmount": "26250.00",
        "amountPaid": "26250.00",
        "lineItems": [
          {"description": "Kaju Katli (500g)", "quantity": "25", "unitPrice": "850.00", "taxPercent": "5"}
        ]
      }
    ]
  }}'`,
        javascript: `const result = await trpc.import.importInvoices.mutate({
  source: "mybillbook",
  autoCreatePayments: true,
  defaultPaymentMode: "bank",
  invoices: [
    {
      invoiceNumber: "INV-2026-001",
      invoiceDate: "2026-03-15",
      partyName: "Gupta Enterprises",
      type: "sale",
      status: "paid",
      totalAmount: "26250.00",
      amountPaid: "26250.00",
      lineItems: [
        { description: "Kaju Katli (500g)", quantity: "25", unitPrice: "850.00", taxPercent: "5" },
      ],
    },
  ],
});
console.log(\`Created: \${result.created}, Payments: \${result.paymentsCreated}\`);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/import.importInvoices",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "source": "mybillbook",
        "autoCreatePayments": True,
        "defaultPaymentMode": "bank",
        "invoices": [
            {
                "invoiceNumber": "INV-2026-001",
                "invoiceDate": "2026-03-15",
                "partyName": "Gupta Enterprises",
                "type": "sale",
                "status": "paid",
                "totalAmount": "26250.00",
                "amountPaid": "26250.00",
                "lineItems": [
                    {"description": "Kaju Katli (500g)", "quantity": "25",
                     "unitPrice": "850.00", "taxPercent": "5"}
                ],
            }
        ],
    }},
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Requires admin-level permission (`manage` on Import resource).",
        "Parties are matched by `partyName` — import parties FIRST or the invoice import will fail for unrecognized names.",
        "All monetary values (totalAmount, amountPaid, subtotal, taxAmount, unitPrice) must be strings.",
        "Invoice numbers from the source are preserved — they are NOT regenerated atomically.",
        "When `autoCreatePayments` is true, a payment record is created for each invoice where `amountPaid > 0`.",
        "Line items are optional — invoices can be imported as header-only with just the total amount.",
        "The `charges` field supports named additional charges (e.g. delivery, packaging).",
      ],
      relatedEndpoints: ["import-parties", "import-payments"],
    },
    {
      id: "import-payments",
      method: "mutation",
      path: "import.importPayments",
      title: "Import Payments",
      description: "Bulk import payment records and optionally match them to existing invoices. Payments are matched to parties by name. If `paidInvoiceNumbers` are provided, invoices marked as 'Paid' in the source system that still have outstanding balances will get auto-generated payments after the main import. Supports explicit invoice linkage via `invoiceNumbers` on each payment row.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "source", type: "string", required: false, description: "Import source adapter", default: "mybillbook" },
        { name: "paidInvoiceNumbers", type: "string[]", required: false, description: "Invoice numbers that were marked 'Paid' in the source system. After allocation, any still without full payment get auto-payments.", default: "[]" },
        { name: "payments", type: "array", required: true, description: "Array of payment objects. Each has: paymentDate (required), partyName (required), amount (required), mode, paymentNumber, referenceNumber, notes, invoiceNumbers." },
      ],
      output: {
        description: "Import results with payment counts and auto-generated payments.",
        example: {
          created: 38,
          linked: 30,
          autoCreated: 5,
          skipped: 2,
          errors: [],
          total: 40,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/import.importPayments \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{
    "source": "mybillbook",
    "paidInvoiceNumbers": ["INV-2026-001", "INV-2026-003"],
    "payments": [
      {"paymentDate": "2026-03-20", "partyName": "Gupta Enterprises", "amount": "26250.00", "mode": "bank", "referenceNumber": "NEFT-123456", "invoiceNumbers": ["INV-2026-001"]}
    ]
  }}'`,
        javascript: `const result = await trpc.import.importPayments.mutate({
  source: "mybillbook",
  paidInvoiceNumbers: ["INV-2026-001", "INV-2026-003"],
  payments: [
    {
      paymentDate: "2026-03-20",
      partyName: "Gupta Enterprises",
      amount: "26250.00",
      mode: "bank",
      referenceNumber: "NEFT-123456",
      invoiceNumbers: ["INV-2026-001"],
    },
  ],
});
console.log(\`Created: \${result.created}, Auto-created: \${result.autoCreated}\`);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/import.importPayments",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "source": "mybillbook",
        "paidInvoiceNumbers": ["INV-2026-001", "INV-2026-003"],
        "payments": [
            {"paymentDate": "2026-03-20", "partyName": "Gupta Enterprises",
             "amount": "26250.00", "mode": "bank", "referenceNumber": "NEFT-123456",
             "invoiceNumbers": ["INV-2026-001"]},
        ],
    }},
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Requires admin-level permission (`manage` on Import resource).",
        "Parties must exist before importing payments — import parties first.",
        "The `amount` field must be a string (e.g. '26250.00', not 26250).",
        "The `invoiceNumbers` field on each payment allows explicit linkage to specific invoices.",
        "`paidInvoiceNumbers` triggers a second pass: invoices listed here that still have an outstanding balance after the main import get auto-generated catch-up payments.",
        "Payment mode must be one of: cash, bank, upi, cheque, other.",
      ],
      relatedEndpoints: ["import-invoices", "import-reconcile-direct-payments"],
    },
    {
      id: "import-reconcile-direct-payments",
      method: "mutation",
      path: "import.reconcileDirectPayments",
      title: "Reconcile Direct Payments",
      description: "Post-import reconciliation step. Scans all invoices in the business that are marked as fully paid but have no matching payment records, and generates 'direct payment' records for them. This handles the case where source systems (like MyBillBook) mark invoices as paid without creating explicit payment entries. Can exclude specific invoice IDs that should be skipped.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "source", type: "string", required: false, description: "Import source identifier for audit tracking", default: "mybillbook" },
        { name: "excludeInvoiceIds", type: "string[]", required: false, description: "Invoice IDs to skip during reconciliation", default: "[]" },
      ],
      output: {
        description: "Reconciliation results.",
        example: {
          reconciled: 15,
          skipped: 3,
          total: 18,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/import.reconcileDirectPayments \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"source":"mybillbook","excludeInvoiceIds":[]}}'`,
        javascript: `const result = await trpc.import.reconcileDirectPayments.mutate({
  source: "mybillbook",
  excludeInvoiceIds: [],
});
console.log(\`Reconciled \${result.reconciled} invoices with missing payments\`);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/import.reconcileDirectPayments",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {"source": "mybillbook", "excludeInvoiceIds": []}},
)
result = resp.json()["result"]["data"]["json"]
print(f"Reconciled: {result['reconciled']}")`,
      },
      gotchas: [
        "Requires admin-level permission (`manage` on Import resource).",
        "This reads from the database (not from import data) — no adapter transformation is applied.",
        "Run this AFTER importing invoices and payments to catch any gaps.",
        "Use `excludeInvoiceIds` to skip invoices that you know should not have payment records generated.",
        "This is idempotent — running it multiple times will not create duplicate payment records.",
      ],
      relatedEndpoints: ["import-payments", "import-invoices"],
    },
    {
      id: "import-transfers",
      method: "mutation",
      path: "import.importTransfers",
      title: "Import Bank Transfers",
      description: "Bulk import inter-account bank transfers. Each transfer moves money from one payment mode (e.g. cash) to another (e.g. bank). Useful for importing historical cash deposits, bank-to-bank transfers, and UPI settlements from source systems.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "transfers", type: "array", required: true, description: "Array of transfer objects. Each has: date (required), amount (required), fromMode (required), toMode (required), notes, txnNo." },
      ],
      output: {
        description: "Import results with transfer counts.",
        example: {
          created: 22,
          skipped: 1,
          errors: [],
          total: 23,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/import.importTransfers \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{
    "transfers": [
      {"date": "2026-03-25", "amount": "50000.00", "fromMode": "cash", "toMode": "bank", "notes": "Daily cash deposit"},
      {"date": "2026-03-28", "amount": "15000.00", "fromMode": "bank", "toMode": "upi", "txnNo": "NEFT-789012"}
    ]
  }}'`,
        javascript: `const result = await trpc.import.importTransfers.mutate({
  transfers: [
    {
      date: "2026-03-25",
      amount: "50000.00",
      fromMode: "cash",
      toMode: "bank",
      notes: "Daily cash deposit",
    },
    {
      date: "2026-03-28",
      amount: "15000.00",
      fromMode: "bank",
      toMode: "upi",
      txnNo: "NEFT-789012",
    },
  ],
});
console.log(\`Imported \${result.created} transfers\`);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/import.importTransfers",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "transfers": [
            {"date": "2026-03-25", "amount": "50000.00", "fromMode": "cash",
             "toMode": "bank", "notes": "Daily cash deposit"},
            {"date": "2026-03-28", "amount": "15000.00", "fromMode": "bank",
             "toMode": "upi", "txnNo": "NEFT-789012"},
        ],
    }},
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Requires admin-level permission (`manage` on Import resource).",
        "The `amount` must be a string (e.g. '50000.00', not 50000).",
        "The `fromMode` and `toMode` fields are free-form strings — common values: 'cash', 'bank', 'upi', 'cheque'.",
        "The `date` field is a string in any format parseable by JavaScript's Date constructor (ISO 8601 recommended).",
        "Transfers do not have a `source` parameter — the MyBillBook adapter is used by default as the transfer format is universal.",
      ],
    },
  ],
};
