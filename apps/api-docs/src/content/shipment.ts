import type { EndpointGroup } from "./types";

export const shipmentEndpoints: EndpointGroup = {
  id: "shipment",
  title: "Shipments",
  description: `Track outbound deliveries attached to sale invoices.

## How shipments are created

A shipment row is **automatically created** when a sale invoice is saved that includes a shipping, delivery, or freight charge — specifically any additional charge whose label matches the pattern \`/shipping|delivery|freight|transport/i\`. Self-pickup invoices (where \`deliveryMethod\` is \`"self_pickup"\` or omitted) and invoices with no matching charge produce no shipment row. You can also **manually create** shipments via \`shipment.create\` for standalone use cases such as samples, returns logistics, or shipments booked before the invoice exists.

## The \`deliveryMethod\` field on invoices

The \`deliveryMethod\` field on \`invoice.create\` determines the delivery mode and controls auto-creation:

| \`deliveryMethod\` value | Shipment auto-created? | Maps to shipment \`mode\` |
|---|---|---|
| \`"self_pickup"\` (default) | No | — |
| \`"hand_delivery"\` | Yes (if shipping charge present) | \`"hand_delivery"\` |
| \`"courier"\` | Yes (if shipping charge present) | \`"courier"\` |
| \`"bus"\` | Yes (if shipping charge present) | \`"bus"\` |
| \`"transport"\` | Yes (if shipping charge present) | \`"transport"\` |
| \`"post"\` | Yes (if shipping charge present) | \`"post"\` |

Custom shipping method IDs (defined via \`business.update\` with \`customShippingMethods\`) are also accepted as \`deliveryMethod\` values and follow the same rules.

## Status lifecycle

Shipments follow this status progression (transitions are not enforced — any status can be set directly):

\`\`\`
pending → shipped → in_transit → delivered
                               ↘ returned
\`\`\`

Setting status to \`"delivered"\` automatically records \`actualDelivery\` as the current timestamp unless you provide an explicit value.

## Carrier tracking URL auto-generation

The 7 supported carriers generate tracking URLs automatically when \`carrier\` + \`trackingNumber\` are both set. The carrier key is normalised by lowercasing and replacing spaces/hyphens with underscores:

| Carrier name / key | Auto-generated URL pattern |
|---|---|
| \`delhivery\` | \`https://www.delhivery.com/track/package/{awb}\` |
| \`bluedart\` | \`https://www.bluedart.com/tracking/{awb}\` |
| \`dtdc\` | \`https://www.dtdc.in/tracking/shipment-tracking.asp?strCnno={awb}\` |
| \`ecom_express\` / \`"Ecom Express"\` | \`https://ecomexpress.in/tracking/?awb_field={awb}\` |
| \`india_post\` / \`"India Post"\` | \`https://www.indiapost.gov.in/...?ConsignmentNumber={awb}\` |
| \`shadowfax\` | \`https://tracker.shadowfax.in/#/track/{awb}\` |
| \`xpressbees\` | \`https://www.xpressbees.com/shipment/tracking?awbNo={awb}\` |

Passing an explicit \`trackingUrl\` always overrides the auto-generated URL.

## Setting up shipping for your integration

**Step 1 — Configure custom shipping methods** (optional, for methods beyond the 5 built-in modes):

\`\`\`javascript
await trpc.business.update.mutate({
  id: "biz-uuid",
  customShippingMethods: [
    { id: "shiprocket", label: "Shiprocket", hasTracking: true },
    { id: "local_van", label: "Local Van", hasTracking: false },
  ],
});
// Custom IDs can now be used as deliveryMethod on invoices and mode on shipments
\`\`\`

**Step 2 — Store carrier API credentials** (for future carrier API integration):

\`\`\`javascript
await trpc.business.update.mutate({
  id: "biz-uuid",
  carrierCredentials: {
    delhivery: { apiKey: "dl_live_xxx", accountId: "ACC123", enabled: true },
    bluedart: { apiKey: "bd_live_yyy", enabled: false },
  },
});
// Credentials are stored encrypted at rest. Disabled carriers are ignored.
\`\`\`

**Step 3 — Register the webhook URL with your carrier**:

The webhook URL format is:
\`\`\`
POST https://api.hisaabo.in/webhooks/shipping/{businessId}
\`\`\`
where \`{businessId}\` is the UUID of the business (available from \`business.list\`). Register this URL in your carrier's dashboard as the tracking/status webhook endpoint. No authentication header is required on the carrier side — the business ID in the path is the routing key.

**Step 4 — Query shipment events in your dashboard**:

\`\`\`javascript
const shipment = await trpc.shipment.getById.query({ id: "shipment-uuid" });
// shipment.status — current normalised status
// Use the REST endpoint below to fetch the full event timeline
\`\`\`

## The \`shipmentEvents\` timeline

Every webhook call appends a row to the \`shipmentEvents\` table. Each event stores:
- \`status\` — normalised status string from the webhook payload
- \`statusDetail\` — human-readable detail (e.g. \`"Package arrived at Mumbai hub"\`)
- \`location\` — scan location from carrier
- \`source\` — always \`"webhook"\` for carrier pushes; \`"manual"\` for updates via \`shipment.update\`
- \`carrierStatus\` — the raw status code from the carrier before mapping
- \`eventTime\` — carrier-reported timestamp, or server receipt time if not provided

All endpoints require an active business context via the \`x-business-id\` header.`,

  endpoints: [
    {
      id: "shipment-list",
      method: "query",
      path: "shipment.list",
      title: "List Shipments",
      description:
        "Paginated list of shipments for the active business. Supports filtering by status, invoice, or party. Results are ordered newest-first and joined with invoice number and party name for display.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        {
          name: "status",
          type: "string",
          required: false,
          description:
            'Filter by delivery status. One of: `"pending"`, `"shipped"`, `"in_transit"`, `"delivered"`, `"returned"`. Omit to return all statuses.',
          enumValues: ["pending", "shipped", "in_transit", "delivered", "returned"],
        },
        {
          name: "invoiceId",
          type: "string (UUID)",
          required: false,
          description: "Filter to shipments linked to a specific invoice.",
        },
        {
          name: "partyId",
          type: "string (UUID)",
          required: false,
          description: "Filter to shipments linked to a specific party (customer).",
        },
        {
          name: "page",
          type: "integer",
          required: false,
          default: "1",
          description: "Page number (1-based).",
        },
        {
          name: "limit",
          type: "integer",
          required: false,
          default: "20",
          description: "Items per page (1–100).",
        },
      ],
      output: {
        description:
          "Paginated result with shipment rows joined to invoice number and party name.",
        example: {
          data: [
            {
              id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
              invoiceId: "inv-uuid",
              partyId: "party-uuid",
              carrier: "delhivery",
              mode: "courier",
              trackingNumber: "DEL1234567890IN",
              trackingUrl:
                "https://www.delhivery.com/track/package/DEL1234567890IN",
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
// result.total — total matching rows for pagination

// Build a simple tracking dashboard
for (const s of result.data) {
  console.log(\`\${s.invoiceNumber} → \${s.partyName}: \${s.status}\`);
  if (s.trackingUrl) console.log("  Track:", s.trackingUrl);
}`,
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
data = resp.json()["result"]["data"]["json"]
for s in data["data"]:
    print(f"{s['invoiceNumber']} → {s['partyName']}: {s['status']}")`,
      },
      gotchas: [
        "This is a `query` (GET) — use `.query()` not `.mutate()`.",
        "The `invoiceNumber` and `partyName` fields come from a LEFT JOIN — they will be `null` if the shipment was created without linking an invoice or party.",
        "Auto-created shipments appear here immediately after invoice creation. They start with `status: 'pending'`. They are only created when the invoice includes a shipping/freight charge — self-pickup invoices and invoices with no matching charge produce no shipment row.",
        "The list response does not include address fields (`shippingAddress`, `shippingCity`, `shippingPincode`) for performance. Use `shipment.getById` to get the full record including address.",
      ],
    },
    {
      id: "shipment-get-by-id",
      method: "query",
      path: "shipment.getById",
      title: "Get Shipment",
      description:
        "Fetch a single shipment by ID. Returns the full row including address fields (`shippingAddress`, `shippingCity`, `shippingPincode`) that are omitted from the list endpoint for performance.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "The shipment ID." },
      ],
      output: {
        description:
          "Full shipment row with address fields, joined to invoice number and party name. Returns `null` if not found or belongs to a different business.",
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
          status: "in_transit",
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
  return;
}
console.log("Status:", shipment.status);
console.log("Track at:", shipment.trackingUrl);
// shipment.shippingAddress / shippingCity / shippingPincode are included here
// but NOT in the list response`,
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
shipment = resp.json()["result"]["data"]["json"]
# shipment is None if not found`,
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
      description:
        "Manually create a shipment record. Most shipments are auto-created when a sale invoice is saved (see group description for the auto-creation rules), but this endpoint is used for standalone shipments — for example, samples, returns logistics, or shipments created before an invoice exists. If `carrier` is a recognised carrier key and `trackingNumber` is provided, `trackingUrl` is auto-generated. An explicit `trackingUrl` overrides the auto-generated one.",
      auth: "business",
      requiredRole: "member",
      input: [
        {
          name: "invoiceId",
          type: "string (UUID)",
          required: false,
          description: "Link this shipment to an existing invoice.",
        },
        {
          name: "partyId",
          type: "string (UUID)",
          required: false,
          description: "Link this shipment to a party (customer).",
        },
        {
          name: "carrier",
          type: "string",
          required: false,
          description:
            'Carrier name or key. Recognised values for auto-URL generation: `"delhivery"`, `"bluedart"`, `"dtdc"`, `"ecom_express"` (or `"Ecom Express"`), `"india_post"` (or `"India Post"`), `"shadowfax"`, `"xpressbees"`. Max 100 chars.',
        },
        {
          name: "mode",
          type: "string",
          required: false,
          description:
            'Delivery mode. Accepts built-in values (`"hand_delivery"`, `"courier"`, `"bus"`, `"transport"`, `"post"`) or any custom method ID defined in `business.customShippingMethods`. Max 50 chars.',
        },
        {
          name: "trackingNumber",
          type: "string",
          required: false,
          description:
            "AWB or consignment number. Max 200 chars. Triggers auto-URL generation if carrier is recognised. This is the value the webhook endpoint uses to match incoming carrier push events.",
        },
        {
          name: "trackingUrl",
          type: "string",
          required: false,
          description:
            "Manual tracking URL. Overrides the auto-generated URL if provided. Max 500 chars.",
        },
        {
          name: "cost",
          type: "string (NUMERIC)",
          required: false,
          default: "0",
          description:
            'Shipping cost as a decimal string, e.g. `"150.00"`. Must match `/^\\d+(\\.\\d{1,2})?$/`.',
        },
        {
          name: "weight",
          type: "string (NUMERIC)",
          required: false,
          description:
            'Package weight in kg, e.g. `"2.500"`. Up to 3 decimal places. Must match `/^\\d+(\\.\\d{1,3})?$/`.',
        },
        {
          name: "shippingAddress",
          type: "string",
          required: false,
          description: "Street address for delivery.",
        },
        {
          name: "shippingCity",
          type: "string",
          required: false,
          description: "Destination city.",
        },
        {
          name: "shippingPincode",
          type: "string",
          required: false,
          description: "Destination PIN code.",
        },
        {
          name: "status",
          type: "string",
          required: false,
          default: "pending",
          description:
            'Initial shipment status. One of: `"pending"`, `"shipped"`, `"in_transit"`, `"delivered"`, `"returned"`.',
          enumValues: ["pending", "shipped", "in_transit", "delivered", "returned"],
        },
        {
          name: "shipmentDate",
          type: "string (ISO 8601)",
          required: false,
          description: "Date and time goods were dispatched.",
        },
        {
          name: "estimatedDelivery",
          type: "string (ISO 8601)",
          required: false,
          description: "Expected delivery date and time.",
        },
        {
          name: "notes",
          type: "string",
          required: false,
          description: "Internal notes visible on the shipment detail page.",
        },
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
  carrier: "delhivery",   // recognised carrier — trackingUrl auto-generated
  mode: "courier",
  trackingNumber: "DEL1234567890IN",
  cost: "150.00",
  weight: "2.500",
  status: "pending",
  // Once the trackingNumber is stored, the webhook endpoint will match
  // incoming Delhivery push events to this shipment automatically.
});
console.log(shipment.trackingUrl);
// "https://www.delhivery.com/track/package/DEL1234567890IN"`,
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
shipment = resp.json()["result"]["data"]["json"]
print(shipment["trackingUrl"])`,
      },
      gotchas: [
        "Cost must be a valid decimal string like `\"150.00\"` — NOT a JavaScript number. Passing `150.00` (number) will fail Zod validation.",
        "Weight supports up to 3 decimal places (`\"2.500\"`) but cost only supports 2 (`\"150.00\"`). Mixing them up causes a 400 validation error.",
        "If both `trackingUrl` and a recognised `carrier` + `trackingNumber` are provided, the explicit `trackingUrl` wins.",
        "The carrier key normalisation is: lowercase + replace spaces and hyphens with underscores. `'Ecom Express'` → `'ecom_express'`. `'Blue-Dart'` will NOT match — use `'bluedart'` instead.",
        "The `trackingNumber` you store here is the exact value the webhook endpoint uses to match incoming events. Make sure it matches the AWB/tracking ID the carrier will send in the webhook payload.",
      ],
      relatedEndpoints: ["shipment-update", "shipment-webhook"],
    },
    {
      id: "shipment-update",
      method: "mutation",
      path: "shipment.update",
      title: "Update Shipment",
      description:
        "Update any field on an existing shipment. Only provided fields are changed — all other fields retain their current values. Setting status to `'delivered'` automatically records `actualDelivery` as the current timestamp unless an explicit `actualDelivery` is also provided. If both `carrier` and `trackingNumber` are updated together, the tracking URL is regenerated automatically.",
      auth: "business",
      requiredRole: "member",
      input: [
        {
          name: "id",
          type: "string (UUID)",
          required: true,
          description: "The shipment ID to update.",
        },
        {
          name: "carrier",
          type: "string",
          required: false,
          description:
            "New carrier name. Max 100 chars. Pass empty string to clear.",
        },
        {
          name: "mode",
          type: "string",
          required: false,
          description:
            "Delivery mode update. Accepts any built-in or custom method ID (see `shipment.create` for valid values). Max 50 chars. Pass empty string to clear.",
        },
        {
          name: "trackingNumber",
          type: "string",
          required: false,
          description:
            "New tracking/AWB number. Max 200 chars. If `carrier` is also provided and recognised, auto-regenerates `trackingUrl`.",
        },
        {
          name: "trackingUrl",
          type: "string",
          required: false,
          description:
            "Manual tracking URL override. Max 500 chars. Pass empty string to clear.",
        },
        {
          name: "cost",
          type: "string (NUMERIC)",
          required: false,
          description:
            'Updated cost as decimal string, e.g. `"200.00"`. Must match `/^\\d+(\\.\\d{1,2})?$/`.',
        },
        {
          name: "weight",
          type: "string (NUMERIC)",
          required: false,
          description:
            "Updated weight in kg. Up to 3 decimal places. Must match `/^\\d+(\\.\\d{1,3})?$/`.",
        },
        {
          name: "status",
          type: "string",
          required: false,
          description:
            'New status. One of: `"pending"`, `"shipped"`, `"in_transit"`, `"delivered"`, `"returned"`. Setting `"delivered"` auto-sets `actualDelivery` if not provided.',
          enumValues: ["pending", "shipped", "in_transit", "delivered", "returned"],
        },
        {
          name: "shipmentDate",
          type: "string (ISO 8601)",
          required: false,
          description: "Dispatch date and time.",
        },
        {
          name: "estimatedDelivery",
          type: "string (ISO 8601)",
          required: false,
          description: "Expected delivery date and time.",
        },
        {
          name: "actualDelivery",
          type: "string (ISO 8601)",
          required: false,
          description:
            "Confirmed delivery date and time. Auto-set when status is changed to 'delivered'.",
        },
        {
          name: "notes",
          type: "string",
          required: false,
          description: "Internal notes. Pass empty string to clear.",
        },
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
// updated.actualDelivery — auto-stamped to current time

// Or supply a past delivery time explicitly
const updatedWithTime = await trpc.shipment.update.mutate({
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  status: "delivered",
  actualDelivery: "2026-03-22T14:30:00.000Z", // your value takes precedence
});

// Or update tracking after booking with a courier
const tracked = await trpc.shipment.update.mutate({
  id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  carrier: "delhivery",
  trackingNumber: "DEL9876543210IN",
  // trackingUrl is auto-regenerated because both carrier + trackingNumber provided
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
      description:
        "Permanently delete a shipment record. This action is irreversible. Requires admin role. The linked invoice and party are not affected — only the shipment row is deleted. All `shipmentEvents` rows for this shipment are cascade-deleted along with it. Auto-created shipments (one per sale invoice) can be deleted here if needed.",
      auth: "business",
      requiredRole: "admin",
      input: [
        {
          name: "id",
          type: "string (UUID)",
          required: true,
          description: "The shipment ID to delete.",
        },
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
        "Deletion is permanent and cannot be undone. All `shipmentEvents` rows for this shipment are cascade-deleted.",
        "The linked invoice is not affected by deletion.",
        "Deleting the auto-created shipment for an invoice does not prevent a new shipment from being manually created for the same invoice via `shipment.create`.",
      ],
      relatedEndpoints: ["shipment-get-by-id"],
    },
    {
      id: "shipment-webhook",
      method: "mutation",
      path: "POST /webhooks/shipping/:businessId",
      title: "Carrier Status Webhook",
      description: `Raw HTTP endpoint (not tRPC) that receives status push events from shipping carriers. Register the URL \`https://api.hisaabo.in/webhooks/shipping/{businessId}\` in your carrier's dashboard as the tracking webhook destination. The business ID in the URL is the routing key — no additional authentication header is needed on the carrier side.

When the webhook fires, the handler:
1. Extracts the tracking number from the payload (tries \`awb\`, \`tracking_id\`, \`waybill\`, \`trackingNumber\` in that order).
2. Looks up the matching shipment by \`trackingNumber\` + \`businessId\`.
3. Appends a new row to the \`shipmentEvents\` timeline.
4. Returns \`{"ok": true, "shipmentId": "..."}\`.

The handler does **not** automatically advance \`shipment.status\` — status updates are intentional writes via \`shipment.update\`. The event timeline is the source of truth for carrier scan history.

**Payload field mapping:**

| Your field | Normalised to |
|---|---|
| \`awb\` / \`tracking_id\` / \`waybill\` / \`trackingNumber\` | \`trackingNumber\` (lookup key) |
| \`status\` / \`current_status\` | \`shipmentEvent.status\` |
| \`status_description\` / \`remarks\` / \`message\` | \`shipmentEvent.statusDetail\` |
| \`location\` / \`scan_location\` / \`city\` | \`shipmentEvent.location\` |
| \`status_code\` / \`status\` | \`shipmentEvent.carrierStatus\` (raw) |
| \`timestamp\` | \`shipmentEvent.eventTime\` (falls back to server time) |`,
      auth: "public",
      input: [
        {
          name: ":businessId",
          type: "string (UUID)",
          required: true,
          description:
            "Business ID in the URL path. This routes the webhook to the correct business. Obtain it from `business.list`.",
        },
        {
          name: "awb / tracking_id / waybill / trackingNumber",
          type: "string",
          required: true,
          description:
            "Tracking/AWB number. The handler tries these four field names in order and uses the first non-null value. Must match the `trackingNumber` stored on the shipment.",
        },
        {
          name: "status / current_status",
          type: "string",
          required: true,
          description:
            "Carrier status string. Stored verbatim as `shipmentEvent.status`. Common values: `\"in_transit\"`, `\"delivered\"`, `\"out_for_delivery\"`, `\"pickup_complete\"`, etc. Carrier-specific values are preserved in `carrierStatus`.",
        },
        {
          name: "status_description / remarks / message",
          type: "string",
          required: false,
          description:
            "Human-readable status detail. Stored as `shipmentEvent.statusDetail`. Example: `\"Package arrived at Mumbai hub\"`.",
        },
        {
          name: "location / scan_location / city",
          type: "string",
          required: false,
          description:
            "Scan location from the carrier. Stored as `shipmentEvent.location`. Example: `\"Mumbai - Kurla Hub\"`.",
        },
        {
          name: "status_code",
          type: "string",
          required: false,
          description:
            "Raw carrier status code before mapping, e.g. `\"PKT\"`, `\"OFD\"`. Stored as `shipmentEvent.carrierStatus`.",
        },
        {
          name: "timestamp",
          type: "string (ISO 8601 or parseable date)",
          required: false,
          description:
            "Carrier-reported event time. Stored as `shipmentEvent.eventTime`. Falls back to server receipt time if omitted.",
        },
      ],
      output: {
        description:
          "Success response with the matched shipment ID. Returns 400 if no tracking number is found in the payload, 404 if no shipment matches the tracking number + business ID combination.",
        example: {
          ok: true,
          shipmentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        },
      },
      codeExamples: {
        curl: `# Minimal generic payload
curl -X POST https://api.hisaabo.in/webhooks/shipping/YOUR_BUSINESS_ID \\
  -H "Content-Type: application/json" \\
  -d '{
    "awb": "DEL1234567890IN",
    "status": "in_transit",
    "status_description": "Package arrived at Mumbai hub",
    "location": "Mumbai - Kurla Hub",
    "timestamp": "2026-03-21T08:30:00.000Z"
  }'

# Delhivery webhook format (as sent by the carrier)
curl -X POST https://api.hisaabo.in/webhooks/shipping/YOUR_BUSINESS_ID \\
  -H "Content-Type: application/json" \\
  -d '{
    "waybill": "DEL1234567890IN",
    "status": "In Transit",
    "status_code": "IT",
    "remarks": "Shipment arrived at destination hub",
    "location": "Delhi - Okhla Hub",
    "timestamp": "2026-03-22T06:15:00.000Z"
  }'

# BlueDart webhook format
curl -X POST https://api.hisaabo.in/webhooks/shipping/YOUR_BUSINESS_ID \\
  -H "Content-Type: application/json" \\
  -d '{
    "tracking_id": "BLU987654321",
    "current_status": "Out for Delivery",
    "scan_location": "Bangalore City Hub",
    "message": "Shipment is out for delivery",
    "timestamp": "2026-03-23T09:45:00.000Z"
  }'`,
        javascript: `// Simulating a carrier webhook push from your integration tests
const businessId = "YOUR_BUSINESS_ID";

const resp = await fetch(
  \`https://api.hisaabo.in/webhooks/shipping/\${businessId}\`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      awb: "DEL1234567890IN",
      status: "delivered",
      status_description: "Delivered to customer",
      location: "Bengaluru",
      timestamp: new Date().toISOString(),
    }),
  }
);
const result = await resp.json();
// { ok: true, shipmentId: "a1b2c3d4-..." }

// After the webhook fires, fetch updated events from the shipment:
const shipment = await trpc.shipment.getById.query({ id: result.shipmentId });
// shipment.status is still the last explicitly set status via shipment.update
// The new event is in the shipmentEvents table (query via your DB or reports endpoint)

// To advance the main shipment status to match the webhook event:
await trpc.shipment.update.mutate({
  id: result.shipmentId,
  status: "delivered",
});`,
        python: `import httpx

business_id = "YOUR_BUSINESS_ID"

# Send a test carrier status update
resp = httpx.post(
    f"https://api.hisaabo.in/webhooks/shipping/{business_id}",
    json={
        "awb": "DEL1234567890IN",
        "status": "in_transit",
        "status_description": "Package in transit to destination",
        "location": "Chennai Hub",
        "timestamp": "2026-03-21T14:00:00+05:30",
    },
)
result = resp.json()
# {"ok": True, "shipmentId": "a1b2c3d4-..."}

# Error cases:
# 400 — no tracking number field found in payload
# 404 — trackingNumber exists in payload but no shipment matches in this business`,
      },
      gotchas: [
        "This is a plain HTTP endpoint, not tRPC. Call it with a raw `fetch`/`httpx.post` — not via the tRPC client.",
        "The webhook does NOT update `shipment.status` automatically. It only appends a `shipmentEvent` row. Use `shipment.update` to advance the top-level status based on the event.",
        "The tracking number in the payload must exactly match the `trackingNumber` stored on the shipment record (case-sensitive). A mismatch returns 404.",
        "If the carrier sends the tracking number under a different field name than the four the handler checks (`awb`, `tracking_id`, `waybill`, `trackingNumber`), the request returns 400. File a support request to add your carrier's field name.",
        "The `timestamp` field is parsed with `new Date(body.timestamp)`. ISO 8601 strings with timezone offsets (e.g. `+05:30`) are handled correctly. UNIX epoch integers are not — convert to ISO 8601 before sending.",
        "There is no webhook signature verification yet. Restrict webhook access by keeping the business ID private or add an IP allowlist at your reverse proxy for carrier IP ranges.",
        "All `shipmentEvents` rows are cascade-deleted when a shipment is deleted via `shipment.delete`.",
      ],
      relatedEndpoints: ["shipment-create", "shipment-update", "shipment-get-by-id"],
    },
  ],
};
