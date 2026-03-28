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
  ],
};
