import type { EndpointGroup } from "./types";

export const businessEndpoints: EndpointGroup = {
  id: "businesses",
  title: "Businesses",
  description: "Manage business profiles within an organization (tenant). Each business is a separate entity with its own invoice numbering, GST details, and data isolation. Requires `owner` or `admin` role on the organization to create or modify businesses.",
  endpoints: [
    {
      id: "business-list",
      method: "query",
      path: "business.list",
      title: "List Businesses",
      description: "Return all businesses within the current organization. Requires a valid tenant session (the `x-tenant-id` header, set automatically by the SDK).",
      auth: "protected",
      input: [],
      output: {
        description: "Array of business objects.",
        example: [
          {
            id: "biz-uuid",
            name: "My Shop",
            legalName: "My Shop Pvt Ltd",
            gstin: "27AADCB2230M1ZP",
            pan: "AADCB2230M",
            phone: "9876543210",
            address: "123 MG Road",
            city: "Mumbai",
            state: "Maharashtra",
            invoicePrefix: "INV",
            nextInvoiceNumber: 43,
            currency: "INR",
          },
        ],
      },
      codeExamples: {
        curl: `curl https://api.hisaabo.in/api/trpc/business.list \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const businesses = await trpc.business.list.query();
// Set active business for subsequent calls
trpc.setBusinessId(businesses[0].id);`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/business.list",
    headers={"Authorization": f"Bearer {session_token}"},
)
businesses = resp.json()["result"]["data"]["json"]`,
      },
    },
    {
      id: "business-create",
      method: "mutation",
      path: "business.create",
      title: "Create Business",
      description: "Create a new business within the organization. Automatically creates a default Cash account for the business. Requires `owner` or `admin` role.",
      auth: "protected",
      input: [
        { name: "name", type: "string", required: true, description: "Business trading name (1–200 chars)" },
        { name: "legalName", type: "string", required: false, description: "Legal entity name if different (max 200 chars)" },
        { name: "pan", type: "string", required: true, description: "PAN number (`AADCB2230M` format)" },
        { name: "phone", type: "string", required: true, description: "Contact phone (max 15 chars)" },
        { name: "address", type: "string", required: true, description: "Business address (1–500 chars)" },
        { name: "gstRegistrationType", type: "enum", required: false, description: "GST registration status", default: "unregistered", enumValues: ["regular", "composition", "unregistered"] },
        { name: "gstin", type: "string", required: false, description: "GSTIN if registered (validated 15-char format)" },
        { name: "city", type: "string", required: false, description: "City (max 100 chars)" },
        { name: "state", type: "string", required: false, description: "State name (max 100 chars)" },
        { name: "stateCode", type: "string", required: false, description: "2-digit GST state code" },
        { name: "pincode", type: "string", required: false, description: "PIN code (max 10 chars)" },
        { name: "invoicePrefix", type: "string", required: false, description: "Prefix for invoice numbers (1–10 chars)", default: "INV" },
        { name: "paymentPrefix", type: "string", required: false, description: "Prefix for payment numbers", default: "PAY" },
        { name: "quotationPrefix", type: "string", required: false, description: "Prefix for quotation numbers", default: "QTN" },
        { name: "creditNotePrefix", type: "string", required: false, description: "Prefix for credit note numbers", default: "CN" },
        { name: "currency", type: "string", required: false, description: "3-letter ISO 4217 currency code", default: "INR" },
      ],
      output: {
        description: "Created business object.",
        example: {
          id: "biz-uuid",
          name: "My Shop",
          pan: "AADCB2230M",
          invoicePrefix: "INV",
          nextInvoiceNumber: 1,
          currency: "INR",
          createdAt: "2024-03-16T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/business.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{
    "json": {
      "name": "My Shop",
      "pan": "AADCB2230M",
      "phone": "9876543210",
      "address": "123 MG Road, Mumbai",
      "gstRegistrationType": "regular",
      "gstin": "27AADCB2230M1ZP",
      "state": "Maharashtra",
      "stateCode": "27",
      "invoicePrefix": "INV"
    }
  }'`,
        javascript: `const business = await trpc.business.create.mutate({
  name: "My Shop",
  pan: "AADCB2230M",
  phone: "9876543210",
  address: "123 MG Road, Mumbai",
  gstRegistrationType: "regular",
  gstin: "27AADCB2230M1ZP",
  state: "Maharashtra",
  stateCode: "27",
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/business.create",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {
        "name": "My Shop",
        "pan": "AADCB2230M",
        "phone": "9876543210",
        "address": "123 MG Road, Mumbai",
        "gstRegistrationType": "regular",
        "gstin": "27AADCB2230M1ZP",
    }},
)`,
      },
      gotchas: [
        "Only `owner` or `admin` organization roles can create businesses.",
        "A default Cash bank account is automatically created for each new business.",
        "Invoice numbering starts at 1. Use `business.updateSequenceNumber` to set a custom starting number.",
      ],
    },
    {
      id: "business-can-create",
      method: "query",
      path: "business.canCreate",
      title: "Can Create Business",
      description: "Check whether the current organization (tenant) can create another business based on its plan limits. Returns `true` if the limit has not been reached, `false` otherwise. Use this to conditionally show/hide the 'Create Business' button.",
      auth: "protected",
      input: [],
      output: {
        description: "Boolean indicating whether a new business can be created.",
        example: true,
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/business.canCreate" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const canCreate = await trpc.business.canCreate.query();
if (!canCreate) {
  // Hide or disable the "Create Business" button
  console.log("Plan limit reached");
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/business.canCreate",
    headers={"Authorization": f"Bearer {session_token}"},
)
can_create = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns `true` for paid plans with unlimited businesses.",
        "The check is against the tenant's plan limits, not individual user permissions.",
      ],
      relatedEndpoints: ["business-create"],
    },
    {
      id: "business-get-by-id",
      method: "query",
      path: "business.getById",
      title: "Get Business",
      description: "Fetch a single business by ID within the current tenant. Returns `null` if the business is not found. Carrier credentials are decrypted automatically in the response.",
      auth: "protected",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Business ID" },
      ],
      output: {
        description: "Business object with decrypted carrier credentials, or null if not found.",
        example: {
          id: "biz-uuid",
          name: "My Shop",
          legalName: "My Shop Pvt Ltd",
          gstin: "27AADCB2230M1ZP",
          pan: "AADCB2230M",
          phone: "9876543210",
          address: "123 MG Road",
          city: "Mumbai",
          state: "Maharashtra",
          invoicePrefix: "INV",
          nextInvoiceNumber: 43,
          currency: "INR",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/business.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22biz-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"`,
        javascript: `const business = await trpc.business.getById.query({ id: "biz-uuid" });
if (business) {
  console.log(business.name, business.gstin);
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "biz-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/business.getById?input={params}",
    headers={"Authorization": f"Bearer {session_token}"},
)`,
      },
      relatedEndpoints: ["business-list"],
    },
    {
      id: "business-update",
      method: "mutation",
      path: "business.update",
      title: "Update Business",
      description: "Update an existing business profile. Only the provided fields are changed. Requires `owner` or `admin` role on the organization. Carrier credentials are encrypted before storage.",
      auth: "protected",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Business ID to update" },
        { name: "data.name", type: "string", required: false, description: "Updated trading name" },
        { name: "data.legalName", type: "string", required: false, description: "Updated legal entity name" },
        { name: "data.phone", type: "string", required: false, description: "Updated phone number" },
        { name: "data.address", type: "string", required: false, description: "Updated address" },
        { name: "data.gstin", type: "string", required: false, description: "Updated GSTIN" },
        { name: "data.state", type: "string", required: false, description: "Updated state" },
        { name: "data.stateCode", type: "string", required: false, description: "Updated 2-digit state code" },
        { name: "data.invoicePrefix", type: "string", required: false, description: "Updated invoice prefix" },
        { name: "data.carrierCredentials", type: "object", required: false, description: "Carrier API credentials (encrypted at rest)" },
      ],
      output: {
        description: "Updated business object.",
        example: {
          id: "biz-uuid",
          name: "My Shop Updated",
          updatedAt: "2026-04-08T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/business.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -d '{"json":{"id":"biz-uuid","data":{"name":"My Shop Updated","phone":"9876543211"}}}'`,
        javascript: `const updated = await trpc.business.update.mutate({
  id: "biz-uuid",
  data: {
    name: "My Shop Updated",
    phone: "9876543211",
    state: "Maharashtra",
    stateCode: "27",
  },
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/business.update",
    headers={"Authorization": f"Bearer {session_token}"},
    json={"json": {
        "id": "biz-uuid",
        "data": {"name": "My Shop Updated", "phone": "9876543211"},
    }},
)`,
      },
      gotchas: [
        "Only `owner` or `admin` organization roles can update businesses.",
        "Carrier credentials are encrypted before storage using field-level encryption.",
        "An audit log entry is created for each update.",
      ],
      relatedEndpoints: ["business-get-by-id"],
    },
    {
      id: "business-update-sequence-number",
      method: "mutation",
      path: "business.updateSequenceNumber",
      title: "Update Sequence Number",
      description: "Set the next auto-generated document number for a specific document type (invoice, payment, quotation, credit note, delivery challan, proforma). The new number must be greater than or equal to the current value \u2014 you cannot go backwards.",
      auth: "protected",
      input: [
        { name: "documentType", type: "enum", required: true, description: "Document type to update", enumValues: ["invoice", "payment", "quotation", "credit_note", "delivery_challan", "proforma"] },
        { name: "newNumber", type: "number", required: true, description: "New starting number (must be >= current value)" },
      ],
      output: {
        description: "Success with previous and new number.",
        example: { success: true, previousNumber: 43, newNumber: 100 },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/business.updateSequenceNumber \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"documentType":"invoice","newNumber":100}}'`,
        javascript: `const result = await trpc.business.updateSequenceNumber.mutate({
  documentType: "invoice",
  newNumber: 100,
});
console.log("Previous:", result.previousNumber, "New:", result.newNumber);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/business.updateSequenceNumber",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {
        "documentType": "invoice",
        "newNumber": 100,
    }},
)`,
      },
      gotchas: [
        "Returns BAD_REQUEST if the new number is less than the current number \u2014 you cannot go backwards.",
        "Only `owner` or `admin` organization roles can update sequence numbers.",
        "Valid document types: `invoice`, `payment`, `quotation`, `credit_note`, `delivery_challan`, `proforma`.",
      ],
      relatedEndpoints: ["business-create"],
    },
    {
      id: "business-audit-trail",
      method: "query",
      path: "business.auditTrail",
      title: "Audit Trail",
      description: "Paginated audit log for the active business. Returns all recorded actions (create, update, delete) with the user who performed them, timestamps, and metadata. User names are resolved from the control database.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1\u2013100)", default: "50" },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Filter entries from this date" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "Filter entries up to this date" },
      ],
      output: {
        description: "Paginated audit log entries with resolved user names.",
        example: {
          data: [
            {
              id: "audit-uuid",
              businessId: "biz-uuid",
              userId: "user-uuid",
              action: "invoice.create",
              entityType: "invoice",
              entityId: "inv-uuid",
              metadata: { invoiceNumber: "INV-00042" },
              createdAt: "2026-04-08T09:00:00.000Z",
              ipAddress: "103.21.244.15",
              userName: "Rahul Sharma",
            },
          ],
          total: 245,
          page: 1,
          limit: 50,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/business.auditTrail?input=%7B%22json%22%3A%7B%22page%22%3A1%2C%22limit%22%3A50%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const trail = await trpc.business.auditTrail.query({
  page: 1,
  limit: 50,
  fromDate: "2026-04-01T00:00:00.000Z",
});
trail.data.forEach(entry => {
  console.log(entry.userName, entry.action, entry.entityType);
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"page": 1, "limit": 50}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/business.auditTrail?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "Requires `Report:read` permission (viewer role or above).",
        "User names are resolved from the control database \u2014 if a user has been deleted, the name shows as 'Unknown user'.",
        "The audit trail only records actions performed through the API \u2014 direct database changes are not tracked.",
      ],
    },
    {
      id: "business-export-data",
      method: "mutation",
      path: "business.exportData",
      title: "Export Data",
      description: "Export all business data as CSV strings. Returns separate CSV files for parties, items, invoices, line items, payments, and expenses. Requires `admin` role and is subject to plan-level data export limits.",
      auth: "business",
      requiredRole: "admin",
      input: [],
      output: {
        description: "Object with CSV strings for each data type.",
        example: {
          parties: "name,type,phone,...\\nAcme Corp,customer,9876543210,...",
          items: "name,itemType,unit,...\\nWidget A,product,pcs,...",
          invoices: "invoiceNumber,type,documentType,...\\nINV-0001,sale,invoice,...",
          lineItems: "invoiceId,description,quantity,...",
          payments: "paymentNumber,paymentDate,amount,...",
          expenses: "category,description,amount,...",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/business.exportData \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{}'`,
        javascript: `const data = await trpc.business.exportData.mutate();

// Download each CSV
const blob = new Blob([data.invoices], { type: "text/csv" });
const url = URL.createObjectURL(blob);
// trigger download...`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/business.exportData",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={},
)
data = resp.json()["result"]["data"]["json"]
with open("invoices.csv", "w") as f:
    f.write(data["invoices"])`,
      },
      gotchas: [
        "Requires `admin` role and `Business:manage` permission.",
        "Subject to plan-level data export limits \u2014 may return FORBIDDEN on the free plan.",
        "Large businesses may produce significant response sizes. Consider streaming for production use.",
      ],
      relatedEndpoints: ["business-audit-trail"],
    },
  ],
};
