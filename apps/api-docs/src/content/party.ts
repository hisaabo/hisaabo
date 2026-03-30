import type { EndpointGroup } from "./types";

export const partyEndpoints: EndpointGroup = {
  id: "parties",
  title: "Parties",
  description: "Manage customers and suppliers (collectively called 'parties'). Each party belongs to a business and can have an opening balance, credit limit, GSTIN, and bank details. The party ledger balance is calculated dynamically from invoice and payment records.",
  endpoints: [
    {
      id: "party-list",
      method: "query",
      path: "party.list",
      title: "List Parties",
      description: "Paginated list of parties for the active business. Supports filtering by type (customer/supplier), balance status (outstanding/overdue), search by name, and category.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "filter", type: "enum", required: false, description: "Filter parties by type or balance status", enumValues: ["all", "customer", "supplier", "outstanding", "overdue"] },
        { name: "search", type: "string", required: false, description: "Search by party name (case-insensitive)" },
        { name: "category", type: "string", required: false, description: "Filter by category label" },
        { name: "sortBy", type: "enum", required: false, description: "Sort column", enumValues: ["name", "balance"] },
        { name: "sortDir", type: "enum", required: false, description: "Sort direction", enumValues: ["asc", "desc"] },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated party list.",
        example: {
          data: [
            {
              id: "party-uuid",
              name: "Gupta Enterprises",
              type: "customer",
              phone: "9876543210",
              email: "accounts@guptaenterprises.in",
              gstin: "07AABCG5432M1Z3",
              balance: "34200.00",
              city: "Delhi",
              state: "Delhi",
              category: "wholesale",
              creditPeriodDays: 30,
              creditLimit: "200000.00",
            },
          ],
          total: 48,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/party.list?input=%7B%22json%22%3A%7B%22filter%22%3A%22customer%22%2C%22page%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.party.list.query({
  filter: "customer",
  search: "acme",
  page: 1,
  limit: 20,
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"filter": "customer", "page": 1}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/party.list?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
      gotchas: [
        "The `outstanding` filter uses a sub-query: parties where `openingBalance + sum(unpaid invoice amounts) > 0`.",
        "The `overdue` filter uses a sub-query: parties with at least one invoice in `overdue` status.",
        "The legacy `type` parameter still works but `filter` is preferred for new integrations.",
      ],
    },
    {
      id: "party-get-by-id",
      method: "query",
      path: "party.getById",
      title: "Get Party",
      description: "Fetch a party by ID with their calculated ledger balance. The balance is computed as: `openingBalance + totalInvoiced - totalPaid`.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Party ID" },
      ],
      output: {
        description: "Party object with calculated balance.",
        example: {
          id: "party-uuid",
          name: "Acme Corp",
          type: "customer",
          phone: "9876543210",
          gstin: "27AADCB2230M1ZP",
          openingBalance: "5000.00",
          billingAddress: "101 Business Park, Andheri East",
          city: "Mumbai",
          state: "Maharashtra",
          stateCode: "27",
          pincode: "400069",
          creditPeriodDays: 30,
          creditLimit: "100000.00",
          balance: "20750.00",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/party.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22party-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const party = await trpc.party.getById.query({ id: "party-uuid" });

if (party) {
  console.log(\`Balance: ₹\${party.balance}\`);
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "party-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/party.getById?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)`,
      },
    },
    {
      id: "party-create",
      method: "mutation",
      path: "party.create",
      title: "Create Party",
      description: "Create a new customer or supplier. GSTIN is validated with the official 15-character format regex. Opening balance represents the amount already owed before using Hisaabo.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "type", type: "enum", required: true, description: "Party type", enumValues: ["customer", "supplier"] },
        { name: "name", type: "string", required: true, description: "Display name (1–200 chars)" },
        { name: "phone", type: "string", required: false, description: "Phone number (max 15 chars)" },
        { name: "email", type: "string", required: false, description: "Email address" },
        { name: "gstin", type: "string", required: false, description: "GST Identification Number (15-char format: `27AADCB2230M1ZP`)" },
        { name: "pan", type: "string", required: false, description: "PAN number (10-char format: `AADCB2230M`)" },
        { name: "billingAddress", type: "string", required: false, description: "Billing address (max 500 chars)" },
        { name: "shippingAddress", type: "string", required: false, description: "Shipping address (max 500 chars)" },
        { name: "city", type: "string", required: false, description: "City (max 100 chars)" },
        { name: "state", type: "string", required: false, description: "State name (max 100 chars)" },
        { name: "stateCode", type: "string", required: false, description: "2-digit GST state code (e.g. `27` for Maharashtra)" },
        { name: "pincode", type: "string", required: false, description: "PIN code (max 10 chars)" },
        { name: "openingBalance", type: "string (decimal)", required: false, description: "Opening balance owed (can be negative for credit)", default: "0" },
        { name: "category", type: "string", required: false, description: "Custom category label (max 100 chars)" },
        { name: "creditPeriodDays", type: "number", required: false, description: "Standard credit period in days (0–365)" },
        { name: "creditLimit", type: "string (decimal)", required: false, description: "Maximum credit limit" },
        { name: "contactPersonName", type: "string", required: false, description: "Contact person name (max 200 chars)" },
        { name: "bankAccountNumber", type: "string", required: false, description: "Bank account number for payments (max 34 chars)" },
        { name: "bankIfsc", type: "string", required: false, description: "Bank IFSC code (max 11 chars)" },
        { name: "bankName", type: "string", required: false, description: "Bank name (max 200 chars)" },
      ],
      output: {
        description: "Created party object.",
        example: {
          id: "party-uuid",
          businessId: "biz-uuid",
          name: "Acme Corp",
          type: "customer",
          phone: "9876543210",
          gstin: "27AADCB2230M1ZP",
          openingBalance: "0.00",
          createdAt: "2024-03-16T10:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/party.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "type": "customer",
      "name": "Acme Corp",
      "phone": "9876543210",
      "gstin": "27AADCB2230M1ZP",
      "state": "Maharashtra",
      "stateCode": "27",
      "creditPeriodDays": 30
    }
  }'`,
        javascript: `const party = await trpc.party.create.mutate({
  type: "customer",
  name: "Acme Corp",
  phone: "9876543210",
  gstin: "27AADCB2230M1ZP",
  state: "Maharashtra",
  stateCode: "27",
  creditPeriodDays: 30,
  openingBalance: "5000.00",
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/party.create",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {
        "type": "customer",
        "name": "Acme Corp",
        "phone": "9876543210",
        "gstin": "27AADCB2230M1ZP",
        "creditPeriodDays": 30,
    }},
)`,
      },
      gotchas: [
        "GSTIN is validated against the regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`. Pass an empty string `\"\"` to clear it.",
        "`openingBalance` represents money already owed before starting to use Hisaabo. Use a negative value if the party has a credit balance.",
        "An audit log entry is created for party creation.",
      ],
    },
  ],
};
