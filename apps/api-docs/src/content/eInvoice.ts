import type { EndpointGroup } from "./types";

export const eInvoiceEndpoints: EndpointGroup = {
  id: "einvoice",
  title: "E-Invoicing",
  description: "Generate e-invoices via NIC IRP (Invoice Registration Portal). Configure IRP credentials, generate IRN numbers, cancel within 24 hours, and track e-invoice status across all invoices.",
  endpoints: [
    {
      id: "einvoice-configure",
      method: "mutation",
      path: "eInvoice.configure",
      title: "Configure IRP Credentials",
      description: "Save or update NIC IRP (Invoice Registration Portal) credentials for this business. Creates a new config or replaces the existing one. Credentials are encrypted at rest using AES-256. Required before generating any e-invoices.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "gstin", type: "string", required: true, description: "Business GSTIN (exactly 15 characters)" },
        { name: "clientId", type: "string", required: true, description: "NIC IRP API client ID (1–200 chars)" },
        { name: "clientSecret", type: "string", required: true, description: "NIC IRP API client secret (1–500 chars)" },
        { name: "username", type: "string", required: true, description: "NIC IRP portal username (1–100 chars)" },
        { name: "password", type: "string", required: true, description: "NIC IRP portal password (1–200 chars)" },
        { name: "isSandbox", type: "boolean", required: false, description: "Use NIC sandbox environment for testing", default: "true" },
        { name: "isEnabled", type: "boolean", required: false, description: "Enable e-invoicing for this business", default: "false" },
        { name: "thresholdCrore", type: "string", required: false, description: "Annual turnover threshold in crores (e.g. '5' for Rs. 5 crore)", default: "5" },
      ],
      output: {
        description: "The saved e-invoice configuration (with encrypted sensitive fields).",
        example: {
          id: "config-uuid",
          businessId: "biz-uuid",
          gstin: "27AABCS1429B1Z5",
          isSandbox: true,
          isEnabled: true,
          thresholdCrore: "5",
          createdAt: "2026-01-10T09:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/eInvoice.configure \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"gstin":"27AABCS1429B1Z5","clientId":"your-nic-client-id","clientSecret":"your-nic-secret","username":"your-nic-user","password":"your-nic-pass","isSandbox":true,"isEnabled":true,"thresholdCrore":"5"}}'`,
        javascript: `const config = await trpc.eInvoice.configure.mutate({
  gstin: "27AABCS1429B1Z5",
  clientId: "your-nic-client-id",
  clientSecret: "your-nic-secret",
  username: "your-nic-user",
  password: "your-nic-pass",
  isSandbox: true,
  isEnabled: true,
  thresholdCrore: "5",
});
console.log("E-invoicing configured:", config.isEnabled);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/eInvoice.configure",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "gstin": "27AABCS1429B1Z5",
        "clientId": "your-nic-client-id",
        "clientSecret": "your-nic-secret",
        "username": "your-nic-user",
        "password": "your-nic-pass",
        "isSandbox": True,
        "isEnabled": True,
        "thresholdCrore": "5",
    }},
)
config = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Requires `EInvoice:manage` permission. Admin role only.",
        "Credentials are encrypted with AES-256 before storage — they are never stored in plaintext.",
        "When updating credentials, the cached IRP auth token is cleared. The next e-invoice generation will re-authenticate.",
        "Start with `isSandbox: true` to test against the NIC sandbox. Switch to `false` only when ready for production.",
        "NIC IRP credentials are obtained from https://einvoice1.gst.gov.in — you need to register your business there first.",
        "E-invoicing is mandatory for businesses with turnover > Rs. 5 crore (as of 2023). The threshold may change — check the latest GST notification.",
      ],
      relatedEndpoints: ["einvoice-get-config", "einvoice-test-connection", "einvoice-generate"],
    },
    {
      id: "einvoice-get-config",
      method: "query",
      path: "eInvoice.getConfig",
      title: "Get IRP Configuration",
      description: "Retrieve the current IRP configuration for this business. The password is masked and the client secret is partially hidden for security. Returns null if no configuration exists.",
      auth: "business",
      requiredRole: "admin",
      input: [],
      output: {
        description: "E-invoice configuration with masked sensitive fields, or null if not configured.",
        example: {
          id: "config-uuid",
          businessId: "biz-uuid",
          gstin: "27AABCS1429B1Z5",
          clientId: "your-nic-client-id",
          clientSecret: "your********",
          username: "your-nic-user",
          password: "********",
          isSandbox: false,
          isEnabled: true,
          thresholdCrore: "5",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/eInvoice.getConfig" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const config = await trpc.eInvoice.getConfig.query();
if (config) {
  console.log("E-invoicing enabled:", config.isEnabled);
  console.log("Sandbox mode:", config.isSandbox);
} else {
  console.log("E-invoicing not configured");
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/eInvoice.getConfig",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
config = resp.json()["result"]["data"]["json"]
if config:
    print("Enabled:", config["isEnabled"])
else:
    print("Not configured")`,
      },
      gotchas: [
        "Requires `EInvoice:manage` permission. Admin role only.",
        "Password is always returned as '********'. Client secret shows only the first 4 characters.",
        "Returns null (not an error) if e-invoicing has never been configured for this business.",
      ],
      relatedEndpoints: ["einvoice-configure", "einvoice-test-connection"],
    },
    {
      id: "einvoice-test-connection",
      method: "mutation",
      path: "eInvoice.testConnection",
      title: "Test IRP Connection",
      description: "Test the IRP connection by attempting to authenticate with the stored credentials. Use this after configuring credentials to verify they work before generating real e-invoices.",
      auth: "business",
      requiredRole: "admin",
      input: [],
      output: {
        description: "Connection test result with success flag and message.",
        example: { success: true, message: "Successfully connected to IRP" },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/eInvoice.testConnection \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{}'`,
        javascript: `const result = await trpc.eInvoice.testConnection.mutate();
if (result.success) {
  console.log("IRP connection OK");
} else {
  console.error("IRP connection failed:", result.message);
}`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/eInvoice.testConnection",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={},
)
result = resp.json()["result"]["data"]["json"]
print("Connection:", "OK" if result["success"] else result["message"])`,
      },
      gotchas: [
        "Requires `EInvoice:manage` permission. Admin role only.",
        "Returns NOT_FOUND if e-invoice configuration does not exist — configure it first.",
        "This does NOT generate an e-invoice. It only tests the authentication handshake with NIC IRP.",
        "A successful test in sandbox mode does not guarantee production credentials will work. Test both environments separately.",
      ],
      relatedEndpoints: ["einvoice-configure", "einvoice-generate"],
    },
    {
      id: "einvoice-generate",
      method: "mutation",
      path: "eInvoice.generate",
      title: "Generate E-Invoice (IRN)",
      description: "Submit an invoice to the NIC IRP and generate an IRN (Invoice Reference Number). The invoice data is mapped to the IRP JSON schema, submitted to the portal, and on success the invoice is updated with the IRN, acknowledgement number, acknowledgement date, signed QR code, and signed invoice data. Only B2B invoices (customer has GSTIN) can be e-invoiced.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "invoiceId", type: "string", required: true, description: "UUID of the invoice to generate IRN for" },
      ],
      output: {
        description: "The updated invoice with IRN, acknowledgement details, and signed QR code.",
        example: {
          id: "inv-uuid",
          invoiceNumber: "INV-2026-0042",
          irn: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
          irnAckNumber: "132610042012345",
          irnAckDate: "2026-01-15T10:30:45.000Z",
          signedQrCode: "eyJhbGciOiJSUzI1NiIs...",
          eInvoiceStatus: "generated",
          eInvoiceError: null,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/eInvoice.generate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"invoiceId":"inv-uuid"}}'`,
        javascript: `try {
  const result = await trpc.eInvoice.generate.mutate({
    invoiceId: "inv-uuid",
  });
  console.log("IRN generated:", result.irn);
  console.log("Ack number:", result.irnAckNumber);
} catch (err) {
  if (err.data?.code === "BAD_REQUEST") {
    console.error("Validation failed:", err.message);
  }
}`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/eInvoice.generate",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {"invoiceId": "inv-uuid"}},
)
result = resp.json()["result"]["data"]["json"]
print("IRN:", result["irn"])`,
      },
      gotchas: [
        "Requires `EInvoice:manage` permission. Admin role only.",
        "E-invoicing must be enabled (`isEnabled: true`) — returns PRECONDITION_FAILED otherwise.",
        "Only B2B invoices (customer has a GSTIN) can be e-invoiced. B2C invoices return BAD_REQUEST.",
        "Returns BAD_REQUEST if an IRN is already generated ('generated' status) or if the e-invoice was previously cancelled.",
        "The invoice status is set to 'pending' before calling IRP. If IRP fails with a retryable error, status stays 'pending'. Non-retryable errors set status to 'failed'.",
        "The signed QR code can be printed on the invoice PDF — it contains the IRN and is verifiable by the buyer.",
        "Each line item must have a valid HSN code in the item master for IRP submission to succeed.",
      ],
      relatedEndpoints: ["einvoice-cancel", "einvoice-retry-failed", "einvoice-get-status"],
    },
    {
      id: "einvoice-cancel",
      method: "mutation",
      path: "eInvoice.cancel",
      title: "Cancel E-Invoice (IRN)",
      description: "Cancel an IRN within 24 hours of generation. After 24 hours, cancellation is not possible through the API — you must contact GST authorities. The cancellation is submitted to NIC IRP and the invoice e-invoice status is updated to 'cancelled'.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "invoiceId", type: "string", required: true, description: "UUID of the invoice whose IRN to cancel" },
        { name: "cancelReason", type: "string", required: true, description: "Cancellation reason code", enumValues: ["1", "2", "3", "4"] },
        { name: "cancelRemarks", type: "string", required: false, description: "Additional remarks (max 100 chars)" },
      ],
      output: {
        description: "The updated invoice with cancelled e-invoice status.",
        example: {
          id: "inv-uuid",
          invoiceNumber: "INV-2026-0042",
          irn: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
          eInvoiceStatus: "cancelled",
          eInvoiceCancelReason: "2",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/eInvoice.cancel \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"invoiceId":"inv-uuid","cancelReason":"2","cancelRemarks":"Incorrect party details"}}'`,
        javascript: `const result = await trpc.eInvoice.cancel.mutate({
  invoiceId: "inv-uuid",
  cancelReason: "2", // Data entry mistake
  cancelRemarks: "Incorrect party details",
});
console.log("E-invoice cancelled:", result.eInvoiceStatus);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/eInvoice.cancel",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "invoiceId": "inv-uuid",
        "cancelReason": "2",
        "cancelRemarks": "Incorrect party details",
    }},
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Requires `EInvoice:manage` permission. Admin role only.",
        "CRITICAL: IRN cancellation is only allowed within 24 hours of generation. After 24 hours, returns BAD_REQUEST with instructions to contact GST authorities.",
        "Cancel reason codes: '1' = Duplicate, '2' = Data entry mistake, '3' = Order cancelled, '4' = Others.",
        "Returns BAD_REQUEST if the invoice has no IRN or if the IRN is already cancelled.",
        "After cancellation, you can issue a credit note or a corrected invoice with a new IRN.",
      ],
      relatedEndpoints: ["einvoice-generate", "einvoice-get-status"],
    },
    {
      id: "einvoice-retry-failed",
      method: "mutation",
      path: "eInvoice.retryFailed",
      title: "Retry Failed E-Invoice",
      description: "Retry generating an IRN for an invoice that previously failed. Only works for invoices with 'failed' or 'pending' e-invoice status. Re-runs the full generate flow — fetches invoice data, maps to IRP JSON, and submits to NIC.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "invoiceId", type: "string", required: true, description: "UUID of the invoice to retry" },
      ],
      output: {
        description: "The updated invoice with IRN on success, or updated error on failure.",
        example: {
          id: "inv-uuid",
          invoiceNumber: "INV-2026-0042",
          irn: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
          eInvoiceStatus: "generated",
          eInvoiceError: null,
          eInvoiceRetryCount: 2,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/eInvoice.retryFailed \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"invoiceId":"inv-uuid"}}'`,
        javascript: `const result = await trpc.eInvoice.retryFailed.mutate({
  invoiceId: "inv-uuid",
});
if (result.eInvoiceStatus === "generated") {
  console.log("Retry succeeded! IRN:", result.irn);
} else {
  console.log("Still failing:", result.eInvoiceError);
}`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/eInvoice.retryFailed",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {"invoiceId": "inv-uuid"}},
)
result = resp.json()["result"]["data"]["json"]
print("Status:", result["eInvoiceStatus"])`,
      },
      gotchas: [
        "Requires `EInvoice:manage` permission. Admin role only.",
        "Returns BAD_REQUEST if the invoice status is not 'failed' or 'pending'. Cannot retry 'generated' or 'cancelled' invoices.",
        "The retry count is incremented on each attempt (tracked in `eInvoiceRetryCount`).",
        "Fix the underlying issue before retrying — common failures: missing customer GSTIN, invalid HSN codes, IRP server downtime.",
      ],
      relatedEndpoints: ["einvoice-generate", "einvoice-bulk-retry"],
    },
    {
      id: "einvoice-dashboard",
      method: "query",
      path: "eInvoice.dashboard",
      title: "E-Invoice Dashboard",
      description: "Paginated list of invoices with e-invoice status, along with aggregate counts by status (generated, pending, failed, cancelled). Supports filtering by status, date range, and text search (invoice number or party name).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "status", type: "string", required: false, description: "Filter by e-invoice status", enumValues: ["pending", "generated", "failed", "cancelled"] },
        { name: "fromDate", type: "string", required: false, description: "Start date filter (ISO 8601 datetime)" },
        { name: "toDate", type: "string", required: false, description: "End date filter (ISO 8601 datetime)" },
        { name: "search", type: "string", required: false, description: "Search by invoice number or party name (max 200 chars)" },
        { name: "page", type: "number", required: false, description: "Page number (min 1)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Results per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated invoice list with e-invoice details and aggregate status counts.",
        example: {
          data: [
            {
              id: "inv-uuid",
              invoiceNumber: "INV-2026-0042",
              invoiceDate: "2026-01-15T00:00:00.000Z",
              totalAmount: "118000.00",
              eInvoiceStatus: "generated",
              eInvoiceError: null,
              eInvoiceRetryCount: 0,
              irn: "a1b2c3d4e5f6...",
              irnAckDate: "2026-01-15T10:30:45.000Z",
              partyName: "Gupta Enterprises",
              partyId: "party-uuid",
            },
          ],
          total: 45,
          page: 1,
          limit: 20,
          counts: { generated: 40, pending: 2, failed: 3, cancelled: 0 },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/eInvoice.dashboard?input=%7B%22json%22%3A%7B%22status%22%3A%22failed%22%2C%22page%22%3A1%2C%22limit%22%3A10%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const dashboard = await trpc.eInvoice.dashboard.query({
  status: "failed",
  page: 1,
  limit: 10,
});
console.log("Failed e-invoices:", dashboard.counts.failed);
for (const inv of dashboard.data) {
  console.log(\`\${inv.invoiceNumber}: \${inv.eInvoiceError}\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/eInvoice.dashboard",
    params={"input": '{"json":{"status":"failed","page":1,"limit":10}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
print("Failed count:", data["counts"]["failed"])
for inv in data["data"]:
    print(f"{inv['invoiceNumber']}: {inv['eInvoiceError']}")`,
      },
      gotchas: [
        "Requires `EInvoice:read` permission. Viewer role and above can access.",
        "Only invoices that have been submitted for e-invoicing (have a non-null eInvoiceStatus) are shown.",
        "The `counts` field always shows totals across ALL statuses regardless of the status filter — useful for building tab navigation.",
        "Search is case-insensitive and matches against both invoice number and party name (ILIKE).",
      ],
      relatedEndpoints: ["einvoice-get-status", "einvoice-generate"],
    },
    {
      id: "einvoice-get-status",
      method: "query",
      path: "eInvoice.getStatus",
      title: "Get E-Invoice Status",
      description: "Get the e-invoice status for a specific invoice — IRN, acknowledgement number, acknowledgement date, signed QR code, error details, retry count, and cancellation reason.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "invoiceId", type: "string", required: true, description: "UUID of the invoice" },
      ],
      output: {
        description: "E-invoice details for the invoice, or null if the invoice has no e-invoice activity.",
        example: {
          id: "inv-uuid",
          irn: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
          irnAckNumber: "132610042012345",
          irnAckDate: "2026-01-15T10:30:45.000Z",
          signedQrCode: "eyJhbGciOiJSUzI1NiIs...",
          eInvoiceStatus: "generated",
          eInvoiceError: null,
          eInvoiceRetryCount: 0,
          eInvoiceCancelReason: null,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/eInvoice.getStatus?input=%7B%22json%22%3A%7B%22invoiceId%22%3A%22inv-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const status = await trpc.eInvoice.getStatus.query({
  invoiceId: "inv-uuid",
});
if (status?.eInvoiceStatus === "generated") {
  console.log("IRN:", status.irn);
  console.log("QR Code:", status.signedQrCode);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/eInvoice.getStatus",
    params={"input": '{"json":{"invoiceId":"inv-uuid"}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
status = resp.json()["result"]["data"]["json"]
if status and status["eInvoiceStatus"] == "generated":
    print("IRN:", status["irn"])`,
      },
      gotchas: [
        "Requires `EInvoice:read` permission. Viewer role and above can access.",
        "Returns null (not an error) if the invoice exists but has never been submitted for e-invoicing.",
        "The `signedQrCode` contains the digitally signed invoice data — embed this in the PDF for buyer verification.",
      ],
      relatedEndpoints: ["einvoice-dashboard", "einvoice-generate"],
    },
    {
      id: "einvoice-bulk-retry",
      method: "mutation",
      path: "eInvoice.bulkRetry",
      title: "Bulk Retry Failed E-Invoices",
      description: "Retry all failed and pending e-invoices in a single operation. Processes up to 50 invoices at a time, attempting to generate IRN for each. Returns a summary of how many succeeded and failed.",
      auth: "business",
      requiredRole: "admin",
      input: [],
      output: {
        description: "Summary of the bulk retry operation.",
        example: {
          attempted: 5,
          succeeded: 3,
          failed: 2,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/eInvoice.bulkRetry \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{}'`,
        javascript: `const result = await trpc.eInvoice.bulkRetry.mutate();
console.log(\`Retried \${result.attempted}: \${result.succeeded} succeeded, \${result.failed} failed\`);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/eInvoice.bulkRetry",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={},
)
result = resp.json()["result"]["data"]["json"]
print(f"Retried {result['attempted']}: {result['succeeded']} OK, {result['failed']} failed")`,
      },
      gotchas: [
        "Requires `EInvoice:manage` permission. Admin role only.",
        "Processes a maximum of 50 invoices per call. If you have more than 50 failed/pending invoices, call this multiple times.",
        "Returns PRECONDITION_FAILED if e-invoicing is not enabled for the business.",
        "Failed invoices in the batch do not stop processing — all 50 are attempted regardless of individual failures.",
        "This operation can take several seconds as each invoice is submitted to NIC IRP sequentially.",
      ],
      relatedEndpoints: ["einvoice-retry-failed", "einvoice-dashboard"],
    },
  ],
};
