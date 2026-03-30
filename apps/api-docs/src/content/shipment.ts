import type { EndpointGroup } from "./types";

export const shipmentEndpoints: EndpointGroup = {
  id: "shipment",
  title: "Shipments",
  description: "Track outbound deliveries attached to sale invoices. A shipment row is automatically created when a sale invoice includes a shipping/freight charge (label matching `/shipping|delivery|freight|transport/i`). Self-pickup invoices and invoices with no shipping charge do not produce a shipment record. The `mode` field is freeform text — it accepts built-in values (`hand_delivery`, `courier`, `bus`, `transport`, `post`) as well as custom method IDs defined on the business. Recognised carriers (Delhivery, BlueDart, DTDC, Ecom Express, India Post, Shadowfax, Xpressbees) have tracking URLs auto-generated from the AWB number. All endpoints require an active business context via the `x-business-id` header.",
  endpoints: [
    {
      id: "shipment-list",
      method: "query",
      path: "shipment.list",
      title: "List Shipments",
      description: "Paginated list of shipments for the active business. Supports filtering by status, invoice, or party. Results are ordered newest-first and joined with invoice number and party name for display.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "status", type: "string", required: false, description: 'Filter by delivery status. One of: `"pending"`, `"shipped"`, `"in_transit"`, `"delivered"`, `"returned"`. Omit to return all statuses.', enumValues: ["pending", "shipped", "in_transit", "delivered", "returned"] },
        { name: "invoiceId", type: "string (UUID)", required: false, description: "Filter to shipments linked to a specific invoice." },
        { name: "partyId", type: "string (UUID)", required: false, description: "Filter to shipments linked to a specific party (customer)." },
        { name: "page", type: "integer", required: false, default: "1", description: "Page number (1-based)." },
        { name: "limit", type: "integer", required: false, default: "20", description: "Items per page (1–100)." },
      ],
      output: {
        description: "Paginated result with shipment rows joined to invoice number and party name.",
        example: {
          data: [
            {
              id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
              invoiceId: "inv-uuid",
              partyId: "party-uuid",
              carrier: "delhivery",
              mode: "hand_delivery",
              trackingNumber: "DEL1234567890IN",
              trackingUrl: "https://www.delhivery.com/track/package/DEL1234567890IN",
              cost: "150.00",
              weight: "2.500",
              status: "shipped",
              shipmentDate: "2026-03-20T10:00:00.000Z",
              estimatedDelivery: "2026-03-23T18:00:00.000Z",
              actualDelivery: null,
              notes: "Fragile — handle with care",
              createdAt: "2026-03-20T09:45:00.000Z",
              invoiceNumber: "INV-2026-0042",
              partyName: "Sharma Traders",
            },
          ],
          total: 38,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/shipment.list?input=%7B%22json%22%3A%7B%22status%22%3A%22shipped%22%2C%22page%22%3A1%2C%22limit%22%3A20%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const result = await trpc.shipment.list.query({
  status: "shipped",
  page: 1,
  limit: 20,
});
// result.data — array of shipments with invoiceNumber + partyName joined
// result.total — total matching rows for pagination`,
        python: `import httpx, urllib.parse, json

params = urllib.parse.urlencode({
    "input": json.dumps({"json": {"status": "shipped", "page": 1, "limit": 20}})
})
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/shipment.list?{params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "This is a `query` (GET) — use `.query()` not `.mutate()`.",
        "The `invoiceNumber` and `partyName` fields come from a LEFT JOIN — they will be `null` if the shipment was created without linking an invoice or party.",
        "Auto-created shipments appear here immediately after invoice creation. They start with `status: 'pending'`. They are only created when the invoice includes a shipping/freight charge — self-pickup invoices and invoices with no shipping charge produce no shipment row.",
      ],
    },
    {
      id: "shipment-get-by-id",
      method: "query",
      path: "shipment.getById",
      title: "Get Shipment",
      description: "Fetch a single shipment by ID. Returns the full row including address fields (`shippingAddress`, `shippingCity`, `shippingPincode`) that are omitted from the list endpoint for performance.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "The shipment ID." },
      ],
      output: {
        description: "Full shipment row with address fields, joined to invoice number and party name. Returns `null` if not found or belongs to a different business.",
        example: {
          id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          businessId: "biz-uuid",
          invoiceId: "inv-uuid",
          partyId: "party-uuid",
          carrier: "delhivery",
          mode: "hand_delivery",
          trackingNumber: "DEL1234567890IN",
          trackingUrl: "https://www.delhivery.com/track/package/DEL1234567890IN",
          cost: "150.00",
          weight: "2.500",
          shippingAddress: "12, MG Road",
          shippingCity: "Bengaluru",
          shippingPincode: "560001",
          status: "shipped",
          shipmentDate: "2026-03-20T10:00:00.000Z",
          estimatedDelivery: "2026-03-23T18:00:00.000Z",
          actualDelivery: null,
          notes: "Fragile — handle with care",
          createdAt: "2026-03-20T09:45:00.000Z",
          updatedAt: "2026-03-20T11:30:00.000Z",
          invoiceNumber: "INV-2026-0042",
          partyName: "Sharma Traders",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/shipment.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22a1b2c3d4-e5f6-7890-abcd-ef1234567890%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const shipment = await trpc.shipment.getById.query({
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
});
if (!shipment) {
  // Not found or belongs to another business
}`,
        python: `import httpx, urllib.parse, json

params = urllib.parse.urlencode({
    "input": json.dumps({"json": {"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}})
})
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/shipment.getById?{params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
shipment = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns `null` (not an error) when the ID doesn't exist or belongs to a different business. Always check for null before using the result.",
        "The `shippingAddress`, `shippingCity`, and `shippingPincode` fields are only available via `getById` — they are excluded from the `list` query.",
      ],
      relatedEndpoints: ["shipment-list"],
    },
    {
      id: "shipment-create",
      method: "mutation",
      path: "shipment.create",
      title: "Create Shipment",
      description: "Manually create a shipment record. Most shipments are auto-created when a sale invoice is saved, but this endpoint is used for standalone shipments (e.g. samples, returns logistics, or shipments created before an invoice exists). If `carrier` is a recognised carrier key and `trackingNumber` is provided, `trackingUrl` is auto-generated — an explicit `trackingUrl` overrides the auto-generated one.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "invoiceId", type: "string (UUID)", required: false, description: "Link this shipment to an existing invoice." },
        { name: "partyId", type: "string (UUID)", required: false, description: "Link this shipment to a party (customer)." },
        { name: "carrier", type: "string", required: false, description: 'Carrier name or key. Recognised values for auto-URL: `"delhivery"`, `"bluedart"`, `"dtdc"`, `"ecom_express"` (or `"Ecom Express"`), `"india_post"` (or `"India Post"`), `"shadowfax"`, `"xpressbees"`. Max 100 chars.' },
        { name: "mode", type: "string", required: false, description: 'Delivery mode. Accepts built-in values (`"hand_delivery"`, `"courier"`, `"bus"`, `"transport"`, `"post"`) or any custom method ID defined in `business.customShippingMethods`. Max 50 chars. `"bus"` does not require a tracking number.' },
        { name: "trackingNumber", type: "string", required: false, description: "AWB or consignment number. Max 200 chars. Triggers auto-URL generation if carrier is recognised." },
        { name: "trackingUrl", type: "string", required: false, description: "Manual tracking URL. Overrides the auto-generated URL if provided. Max 500 chars." },
        { name: "cost", type: "string (NUMERIC)", required: false, default: "0", description: 'Shipping cost as a decimal string, e.g. `"150.00"`. Must match `/^\\d+(\\.\\d{1,2})?$/`.' },
        { name: "weight", type: "string (NUMERIC)", required: false, description: 'Package weight in kg, e.g. `"2.500"`. Up to 3 decimal places. Must match `/^\\d+(\\.\\d{1,3})?$/`.' },
        { name: "shippingAddress", type: "string", required: false, description: "Street address for delivery." },
        { name: "shippingCity", type: "string", required: false, description: "Destination city." },
        { name: "shippingPincode", type: "string", required: false, description: "Destination PIN code." },
        { name: "status", type: "string", required: false, default: "pending", description: 'Initial shipment status. One of: `"pending"`, `"shipped"`, `"in_transit"`, `"delivered"`, `"returned"`.', enumValues: ["pending", "shipped", "in_transit", "delivered", "returned"] },
        { name: "shipmentDate", type: "string (ISO 8601)", required: false, description: "Date and time goods were dispatched." },
        { name: "estimatedDelivery", type: "string (ISO 8601)", required: false, description: "Expected delivery date and time." },
        { name: "notes", type: "string", required: false, description: "Internal notes visible on the shipment detail page." },
      ],
      output: {
        description: "The newly created shipment row.",
        example: {
          id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          businessId: "biz-uuid",
          invoiceId: "inv-uuid",
          partyId: "party-uuid",
          carrier: "delhivery",
          mode: "courier",
          trackingNumber: "DEL1234567890IN",
          trackingUrl: "https://www.delhivery.com/track/package/DEL1234567890IN",
          cost: "150.00",
          weight: "2.500",
          shippingAddress: "12, MG Road",
          shippingCity: "Bengaluru",
          shippingPincode: "560001",
          status: "pending",
          shipmentDate: null,
          estimatedDelivery: null,
          actualDelivery: null,
          notes: null,
          createdAt: "2026-03-29T10:00:00.000Z",
          updatedAt: "2026-03-29T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/shipment.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"invoiceId":"inv-uuid","partyId":"party-uuid","carrier":"delhivery","mode":"courier","trackingNumber":"DEL1234567890IN","cost":"150.00","weight":"2.500","status":"pending"}}'`,
        javascript: `const shipment = await trpc.shipment.create.mutate({
  invoiceId: "inv-uuid",
  partyId: "party-uuid",
  carrier: "delhivery",   // auto-generates trackingUrl
  mode: "courier",
  trackingNumber: "DEL1234567890IN",
  cost: "150.00",
  weight: "2.500",
  status: "pending",
});
// shipment.trackingUrl is auto-generated from carrier + trackingNumber`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/shipment.create",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "invoiceId": "inv-uuid",
        "carrier": "delhivery",
        "trackingNumber": "DEL1234567890IN",
        "cost": "150.00",
        "status": "pending",
    }},
)
shipment = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Cost must be a valid decimal string like `\"150.00\"` — NOT a JavaScript number. Passing `150.00` (number) will fail Zod validation.",
        "Weight supports up to 3 decimal places (`\"2.500\"`) but cost only supports 2 (`\"150.00\"`). Mixing them up causes a 400 validation error.",
        "If both `trackingUrl` and a recognised `carrier` + `trackingNumber` are provided, the explicit `trackingUrl` wins.",
        "For recognised carriers, the carrier key is derived by lowercasing and replacing spaces/hyphens with underscores. 'Ecom Express' → 'ecom_express', 'Blue-Dart' → 'blue_dart' (no match — use 'bluedart' instead).",
      ],
      relatedEndpoints: ["shipment-update"],
    },
    {
      id: "shipment-update",
      method: "mutation",
      path: "shipment.update",
      title: "Update Shipment",
      description: "Update any field on an existing shipment. Only provided fields are changed — all other fields retain their current values. Setting status to `'delivered'` automatically records `actualDelivery` as the current timestamp unless an explicit `actualDelivery` is also provided. If both `carrier` and `trackingNumber` are updated together, the tracking URL is regenerated automatically.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "The shipment ID to update." },
        { name: "carrier", type: "string", required: false, description: "New carrier name. Max 100 chars. Pass empty string to clear." },
        { name: "mode", type: "string", required: false, description: 'Delivery mode update. Accepts any built-in or custom method ID (see `shipment.create` for valid values). Max 50 chars. Pass empty string to clear.' },
        { name: "trackingNumber", type: "string", required: false, description: "New tracking/AWB number. Max 200 chars. If `carrier` is also provided and recognised, auto-regenerates `trackingUrl`." },
        { name: "trackingUrl", type: "string", required: false, description: "Manual tracking URL override. Max 500 chars. Pass empty string to clear." },
        { name: "cost", type: "string (NUMERIC)", required: false, description: 'Updated cost as decimal string, e.g. `"200.00"`. Must match `/^\\d+(\\.\\d{1,2})?$/`.' },
        { name: "weight", type: "string (NUMERIC)", required: false, description: 'Updated weight in kg. Up to 3 decimal places. Must match `/^\\d+(\\.\\d{1,3})?$/`.' },
        { name: "status", type: "string", required: false, description: 'New status. One of: `"pending"`, `"shipped"`, `"in_transit"`, `"delivered"`, `"returned"`. Setting `"delivered"` auto-sets `actualDelivery` if not provided.', enumValues: ["pending", "shipped", "in_transit", "delivered", "returned"] },
        { name: "shipmentDate", type: "string (ISO 8601)", required: false, description: "Dispatch date and time." },
        { name: "estimatedDelivery", type: "string (ISO 8601)", required: false, description: "Expected delivery date and time." },
        { name: "actualDelivery", type: "string (ISO 8601)", required: false, description: "Confirmed delivery date and time. Auto-set when status is changed to 'delivered'." },
        { name: "notes", type: "string", required: false, description: "Internal notes. Pass empty string to clear." },
      ],
      output: {
        description: "The updated shipment row with all fields.",
        example: {
          id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          businessId: "biz-uuid",
          invoiceId: "inv-uuid",
          partyId: "party-uuid",
          carrier: "delhivery",
          mode: "courier",
          trackingNumber: "DEL1234567890IN",
          trackingUrl: "https://www.delhivery.com/track/package/DEL1234567890IN",
          cost: "150.00",
          weight: "2.500",
          shippingAddress: "12, MG Road",
          shippingCity: "Bengaluru",
          shippingPincode: "560001",
          status: "delivered",
          shipmentDate: "2026-03-20T10:00:00.000Z",
          estimatedDelivery: "2026-03-23T18:00:00.000Z",
          actualDelivery: "2026-03-22T14:30:00.000Z",
          notes: null,
          createdAt: "2026-03-20T09:45:00.000Z",
          updatedAt: "2026-03-22T14:30:05.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/shipment.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890","status":"delivered"}}'`,
        javascript: `// Mark as delivered — actualDelivery is auto-set to now
const updated = await trpc.shipment.update.mutate({
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  status: "delivered",
});

// Or update tracking after booking with a courier
const tracked = await trpc.shipment.update.mutate({
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  carrier: "delhivery",
  trackingNumber: "DEL9876543210IN",
  // trackingUrl is auto-regenerated because carrier + trackingNumber both provided
});`,
        python: `import httpx

# Advance status to in_transit
resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/shipment.update",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "status": "in_transit",
    }},
)
shipment = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Tracking URL is only auto-regenerated when BOTH `carrier` and `trackingNumber` are supplied in the same update call. Sending only `trackingNumber` (without `carrier`) will not update the URL.",
        "Setting `status: 'delivered'` auto-stamps `actualDelivery`. If you want to record a past delivery time, include `actualDelivery` explicitly in the same call — your value takes precedence.",
        "Passing an empty string for `carrier`, `mode`, `trackingNumber`, `trackingUrl`, or `notes` clears the field (stores `null`). Omitting the field entirely leaves the current value unchanged.",
        "The update is scoped to the active business — attempting to update a shipment that belongs to a different business silently returns `undefined` (no row matched the WHERE clause).",
      ],
      relatedEndpoints: ["shipment-create", "shipment-get-by-id"],
    },
    {
      id: "shipment-delete",
      method: "mutation",
      path: "shipment.delete",
      title: "Delete Shipment",
      description: "Permanently delete a shipment record. This action is irreversible. Requires admin role. The linked invoice and party are not affected — only the shipment row is deleted. Auto-created shipments (one per sale invoice) can be deleted here if needed.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "The shipment ID to delete." },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/shipment.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"a1b2c3d4-e5f6-7890-abcd-ef1234567890"}}'`,
        javascript: `await trpc.shipment.delete.mutate({
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
});`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/shipment.delete",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"}},
)`,
      },
      gotchas: [
        "Admin role required — members and viewers will receive a FORBIDDEN error.",
        "Deletion is permanent and cannot be undone. The linked invoice is not affected.",
        "Deleting the auto-created shipment for an invoice does not prevent a new shipment from being manually created for the same invoice via `shipment.create`.",
      ],
      relatedEndpoints: ["shipment-get-by-id"],
    },
  ],
};
