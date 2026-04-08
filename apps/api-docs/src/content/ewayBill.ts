import type { EndpointGroup } from "./types";

export const ewayBillEndpoints: EndpointGroup = {
  id: "eway-bill",
  title: "E-Way Bills",
  description: "Generate and manage e-way bills for goods movement above Rs. 50,000. Auto-generate from invoice data, update vehicle details for transhipment, extend validity, and monitor expiring bills.",
  endpoints: [
    {
      id: "eway-generate",
      method: "mutation",
      path: "ewayBill.generate",
      title: "Generate E-Way Bill",
      description: "Generate a new E-Way Bill for a goods invoice. Validates that the invoice belongs to the business, contains at least one goods item (not service-only), has a total above Rs. 50,000, and does not already have an active EWB. Submits to the NIC E-Way Bill API and stores the EWB number, validity period, and transport details.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "invoiceId", type: "string", required: true, description: "UUID of the goods invoice" },
        { name: "transporterId", type: "string", required: false, description: "Transporter GSTIN (max 15 chars)" },
        { name: "transporterName", type: "string", required: false, description: "Transporter name (max 200 chars)" },
        { name: "vehicleNumber", type: "string", required: true, description: "Vehicle registration number (max 20 chars, e.g. 'MH02AB1234')" },
        { name: "vehicleType", type: "string", required: false, description: "Vehicle type", default: "regular", enumValues: ["regular", "over_dimensional"] },
        { name: "transportMode", type: "string", required: false, description: "Mode of transport", default: "road", enumValues: ["road", "rail", "air", "ship"] },
        { name: "distance", type: "number", required: true, description: "Distance in km (1–4000)" },
        { name: "fromAddress", type: "string", required: false, description: "Dispatch address (max 500 chars)" },
        { name: "fromPincode", type: "string", required: false, description: "Dispatch pincode (exactly 6 digits)" },
        { name: "toAddress", type: "string", required: false, description: "Delivery address (max 500 chars)" },
        { name: "toPincode", type: "string", required: false, description: "Delivery pincode (exactly 6 digits)" },
      ],
      output: {
        description: "The created E-Way Bill record with EWB number and validity.",
        example: {
          id: "ewb-uuid",
          businessId: "biz-uuid",
          invoiceId: "inv-uuid",
          ewbNumber: "331001234567",
          ewbDate: "2026-01-15T10:30:00.000Z",
          validUpto: "2026-01-16T23:59:59.000Z",
          status: "generated",
          transporterId: "29AABCT1332L1ZL",
          transporterName: "Sharma Transport Co.",
          vehicleNumber: "MH02AB1234",
          vehicleType: "regular",
          transportMode: "road",
          distance: 350,
          fromAddress: "123 MG Road, Andheri East",
          fromPincode: "400069",
          toAddress: "456 Brigade Road",
          toPincode: "560025",
          fromState: "27",
          toState: "29",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/ewayBill.generate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"invoiceId":"inv-uuid","vehicleNumber":"MH02AB1234","transportMode":"road","distance":350,"transporterName":"Sharma Transport Co.","fromPincode":"400069","toPincode":"560025"}}'`,
        javascript: `const ewb = await trpc.ewayBill.generate.mutate({
  invoiceId: "inv-uuid",
  vehicleNumber: "MH02AB1234",
  transportMode: "road",
  distance: 350,
  transporterName: "Sharma Transport Co.",
  fromPincode: "400069",
  toPincode: "560025",
});
console.log("EWB Number:", ewb.ewbNumber);
console.log("Valid until:", ewb.validUpto);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/ewayBill.generate",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "invoiceId": "inv-uuid",
        "vehicleNumber": "MH02AB1234",
        "transportMode": "road",
        "distance": 350,
        "transporterName": "Sharma Transport Co.",
        "fromPincode": "400069",
        "toPincode": "560025",
    }},
)
ewb = resp.json()["result"]["data"]["json"]
print("EWB:", ewb["ewbNumber"], "Valid:", ewb["validUpto"])`,
      },
      gotchas: [
        "Requires `EWayBill:manage` permission. Admin role only.",
        "NIC E-Way Bill API credentials must be configured via environment variables (NIC_EWB_CLIENT_ID, NIC_EWB_CLIENT_SECRET, NIC_EWB_USERNAME, NIC_EWB_PASSWORD). Returns PRECONDITION_FAILED if not set.",
        "Minimum invoice total is Rs. 50,000 — returns BAD_REQUEST for lower amounts.",
        "Service-only invoices cannot have E-Way Bills — at least one line item must be a 'product' type.",
        "Returns CONFLICT if an active/generated EWB already exists for this invoice.",
        "Validity is computed based on distance: 100 km/day for regular vehicles, 75 km/day for over-dimensional cargo. Minimum 1 day validity.",
        "State codes (fromState, toState) are auto-populated from the business and party records.",
      ],
      relatedEndpoints: ["eway-cancel", "eway-update-vehicle", "eway-extend", "eway-get-by-invoice"],
    },
    {
      id: "eway-cancel",
      method: "mutation",
      path: "ewayBill.cancel",
      title: "Cancel E-Way Bill",
      description: "Cancel an E-Way Bill within 24 hours of generation. After 24 hours, cancellation through the API is not allowed. The cancellation is submitted to the NIC E-Way Bill portal.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "ewayBillId", type: "string", required: true, description: "UUID of the E-Way Bill record (not the EWB number)" },
        { name: "cancelReason", type: "string", required: true, description: "Reason for cancellation (max 250 chars)" },
      ],
      output: {
        description: "The updated E-Way Bill record with cancelled status.",
        example: {
          id: "ewb-uuid",
          ewbNumber: "331001234567",
          status: "cancelled",
          cancelReason: "Goods not dispatched — order deferred by buyer",
          updatedAt: "2026-01-15T14:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/ewayBill.cancel \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"ewayBillId":"ewb-uuid","cancelReason":"Goods not dispatched — order deferred by buyer"}}'`,
        javascript: `const result = await trpc.ewayBill.cancel.mutate({
  ewayBillId: "ewb-uuid",
  cancelReason: "Goods not dispatched — order deferred by buyer",
});
console.log("EWB cancelled:", result.status);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/ewayBill.cancel",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "ewayBillId": "ewb-uuid",
        "cancelReason": "Goods not dispatched",
    }},
)
result = resp.json()["result"]["data"]["json"]
print("Status:", result["status"])`,
      },
      gotchas: [
        "Requires `EWayBill:manage` permission. Admin role only.",
        "CRITICAL: Cancellation is only allowed within 24 hours of EWB generation. After 24 hours, returns BAD_REQUEST.",
        "Returns BAD_REQUEST if the EWB is already cancelled.",
        "The `ewayBillId` is the internal UUID, not the 12-digit EWB number.",
        "Once cancelled, you can generate a new EWB for the same invoice if needed.",
      ],
      relatedEndpoints: ["eway-generate", "eway-get-by-invoice"],
    },
    {
      id: "eway-update-vehicle",
      method: "mutation",
      path: "ewayBill.updateVehicle",
      title: "Update Vehicle (Part-B)",
      description: "Update the vehicle number on an active E-Way Bill. This is the Part-B update used during transhipment (goods transferred to a different vehicle), breakdown, or when entering vehicle details for the first time. Maintains a complete vehicle update history.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "ewayBillId", type: "string", required: true, description: "UUID of the E-Way Bill record" },
        { name: "vehicleNumber", type: "string", required: true, description: "New vehicle registration number (max 20 chars)" },
        { name: "fromPlace", type: "string", required: false, description: "Place where vehicle was changed (max 200 chars)" },
        { name: "reason", type: "string", required: false, description: "Reason for vehicle update", default: "others", enumValues: ["breakdown", "transshipment", "first_time", "others"] },
      ],
      output: {
        description: "The updated E-Way Bill with new vehicle number and potentially extended validity.",
        example: {
          id: "ewb-uuid",
          ewbNumber: "331001234567",
          vehicleNumber: "KA01CD5678",
          validUpto: "2026-01-17T23:59:59.000Z",
          status: "generated",
          updatedAt: "2026-01-16T08:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/ewayBill.updateVehicle \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"ewayBillId":"ewb-uuid","vehicleNumber":"KA01CD5678","fromPlace":"Pune","reason":"transshipment"}}'`,
        javascript: `const updated = await trpc.ewayBill.updateVehicle.mutate({
  ewayBillId: "ewb-uuid",
  vehicleNumber: "KA01CD5678",
  fromPlace: "Pune",
  reason: "transshipment",
});
console.log("New vehicle:", updated.vehicleNumber);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/ewayBill.updateVehicle",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "ewayBillId": "ewb-uuid",
        "vehicleNumber": "KA01CD5678",
        "fromPlace": "Pune",
        "reason": "transshipment",
    }},
)
updated = resp.json()["result"]["data"]["json"]
print("Updated vehicle:", updated["vehicleNumber"])`,
      },
      gotchas: [
        "Requires `EWayBill:manage` permission. Admin role only.",
        "Cannot update vehicle for cancelled or expired E-Way Bills.",
        "Each vehicle update is recorded in `ewayBillVehicleUpdates` — use `ewayBill.getByInvoice` to see the full history.",
        "The NIC API may extend the validity on vehicle update — the new `validUpto` is reflected in the response.",
        "Vehicle number format follows Indian registration: XX00XX0000 (state code + RTO + series + number).",
      ],
      relatedEndpoints: ["eway-generate", "eway-get-by-invoice", "eway-extend"],
    },
    {
      id: "eway-extend",
      method: "mutation",
      path: "ewayBill.extend",
      title: "Extend E-Way Bill Validity",
      description: "Extend the validity of an E-Way Bill that is about to expire or recently expired. Can only be called within 8 hours before or after the expiry time. Useful when goods are delayed due to natural calamity, law and order situation, vehicle breakdown, or other genuine reasons.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "ewayBillId", type: "string", required: true, description: "UUID of the E-Way Bill record" },
        { name: "vehicleNumber", type: "string", required: true, description: "Current vehicle registration number (max 20 chars)" },
        { name: "fromPlace", type: "string", required: true, description: "Current location of goods (max 200 chars)" },
        { name: "fromPincode", type: "number", required: true, description: "Pincode of current location" },
        { name: "remainingDistance", type: "number", required: true, description: "Remaining distance in km (min 1)" },
      ],
      output: {
        description: "The updated E-Way Bill with extended validity.",
        example: {
          id: "ewb-uuid",
          ewbNumber: "331001234567",
          validUpto: "2026-01-18T23:59:59.000Z",
          status: "active",
          updatedAt: "2026-01-17T06:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/ewayBill.extend \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"ewayBillId":"ewb-uuid","vehicleNumber":"MH02AB1234","fromPlace":"Kolhapur","fromPincode":416001,"remainingDistance":200}}'`,
        javascript: `const extended = await trpc.ewayBill.extend.mutate({
  ewayBillId: "ewb-uuid",
  vehicleNumber: "MH02AB1234",
  fromPlace: "Kolhapur",
  fromPincode: 416001,
  remainingDistance: 200,
});
console.log("Extended validity:", extended.validUpto);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/ewayBill.extend",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "ewayBillId": "ewb-uuid",
        "vehicleNumber": "MH02AB1234",
        "fromPlace": "Kolhapur",
        "fromPincode": 416001,
        "remainingDistance": 200,
    }},
)
extended = resp.json()["result"]["data"]["json"]
print("New expiry:", extended["validUpto"])`,
      },
      gotchas: [
        "Requires `EWayBill:manage` permission. Admin role only.",
        "CRITICAL: Can only be called within an 8-hour window around the EWB expiry — 8 hours before or 8 hours after. Outside this window, returns BAD_REQUEST.",
        "The new validity is computed based on `remainingDistance` using the same formula as initial generation (100 km/day for regular vehicles).",
        "After extension, the EWB status changes to 'active'.",
        "The `fromPincode` is a number (not a string) in this endpoint — unlike the generate endpoint where it is a string.",
      ],
      relatedEndpoints: ["eway-generate", "eway-expiring-list"],
    },
    {
      id: "eway-get-by-invoice",
      method: "query",
      path: "ewayBill.getByInvoice",
      title: "Get E-Way Bill by Invoice",
      description: "Fetch the E-Way Bill details for a specific invoice, including the complete vehicle update history. Returns the most recent EWB for the invoice (ordered by creation date).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "invoiceId", type: "string", required: true, description: "UUID of the invoice" },
      ],
      output: {
        description: "E-Way Bill details with vehicle update history, or null if no EWB exists for this invoice.",
        example: {
          id: "ewb-uuid",
          ewbNumber: "331001234567",
          ewbDate: "2026-01-15T10:30:00.000Z",
          validUpto: "2026-01-17T23:59:59.000Z",
          status: "generated",
          vehicleNumber: "KA01CD5678",
          transportMode: "road",
          distance: 350,
          invoiceId: "inv-uuid",
          vehicleHistory: [
            {
              id: "update-uuid",
              ewayBillId: "ewb-uuid",
              vehicleNumber: "KA01CD5678",
              fromPlace: "Pune",
              reason: "transshipment",
              updatedAt: "2026-01-16T08:00:00.000Z",
            },
          ],
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/ewayBill.getByInvoice?input=%7B%22json%22%3A%7B%22invoiceId%22%3A%22inv-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const ewb = await trpc.ewayBill.getByInvoice.query({
  invoiceId: "inv-uuid",
});
if (ewb) {
  console.log("EWB:", ewb.ewbNumber, "Status:", ewb.status);
  console.log("Vehicle updates:", ewb.vehicleHistory.length);
} else {
  console.log("No E-Way Bill for this invoice");
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/ewayBill.getByInvoice",
    params={"input": '{"json":{"invoiceId":"inv-uuid"}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
ewb = resp.json()["result"]["data"]["json"]
if ewb:
    print(f"EWB {ewb['ewbNumber']}: {ewb['status']}")
    for update in ewb["vehicleHistory"]:
        print(f"  Vehicle changed to {update['vehicleNumber']} at {update['fromPlace']}")`,
      },
      gotchas: [
        "Requires `EWayBill:read` permission. Viewer role and above can access.",
        "Returns null (not an error) if no EWB has been generated for this invoice.",
        "If multiple EWBs exist for the same invoice (e.g. one was cancelled and a new one generated), returns the most recent one.",
        "The `vehicleHistory` array is ordered by update time (most recent first).",
      ],
      relatedEndpoints: ["eway-generate", "eway-update-vehicle", "eway-dashboard"],
    },
    {
      id: "eway-dashboard",
      method: "query",
      path: "ewayBill.dashboard",
      title: "E-Way Bill Dashboard",
      description: "Paginated list of E-Way Bills with optional status filter. Includes invoice number, party name, transport details, and a summary of counts by status (generated, active, cancelled, expired).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "status", type: "string", required: false, description: "Filter by EWB status", enumValues: ["generated", "active", "cancelled", "expired"] },
        { name: "page", type: "number", required: false, description: "Page number (min 1)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Results per page (1–100)", default: "20" },
      ],
      output: {
        description: "Paginated E-Way Bill list with status summary.",
        example: {
          data: [
            {
              id: "ewb-uuid",
              ewbNumber: "331001234567",
              ewbDate: "2026-01-15T10:30:00.000Z",
              validUpto: "2026-01-17T23:59:59.000Z",
              status: "generated",
              transportMode: "road",
              vehicleNumber: "MH02AB1234",
              distance: 350,
              fromState: "27",
              toState: "29",
              cancelReason: null,
              createdAt: "2026-01-15T10:30:00.000Z",
              invoiceId: "inv-uuid",
              invoiceNumber: "INV-2026-0042",
              invoiceDate: "2026-01-15T00:00:00.000Z",
              partyName: "Gupta Enterprises",
            },
          ],
          total: 28,
          page: 1,
          limit: 20,
          summary: { generated: 15, active: 8, cancelled: 3, expired: 2 },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/ewayBill.dashboard?input=%7B%22json%22%3A%7B%22status%22%3A%22active%22%2C%22page%22%3A1%2C%22limit%22%3A10%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const dashboard = await trpc.ewayBill.dashboard.query({
  status: "active",
  page: 1,
  limit: 10,
});
console.log("Active EWBs:", dashboard.summary.active);
for (const ewb of dashboard.data) {
  console.log(\`\${ewb.ewbNumber} - \${ewb.partyName} via \${ewb.vehicleNumber}\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/ewayBill.dashboard",
    params={"input": '{"json":{"status":"active","page":1,"limit":10}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
print("Summary:", data["summary"])
for ewb in data["data"]:
    print(f"{ewb['ewbNumber']} -> {ewb['partyName']}, {ewb['distance']} km")`,
      },
      gotchas: [
        "Requires `EWayBill:read` permission. Viewer role and above can access.",
        "The `summary` counts are always across ALL statuses regardless of the status filter.",
        "Invoice and party details come from LEFT JOINs — they may be null if the related records were deleted.",
        "Results are ordered by creation date (most recent first).",
      ],
      relatedEndpoints: ["eway-expiring-list", "eway-get-by-invoice"],
    },
    {
      id: "eway-expiring-list",
      method: "query",
      path: "ewayBill.expiringList",
      title: "Expiring E-Way Bills",
      description: "List E-Way Bills that expire within the next 24 hours. Only includes active/generated EWBs — cancelled and expired bills are excluded. Use this to proactively extend validity or ensure deliveries are completed before expiry.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Array of E-Way Bills expiring within 24 hours, ordered by expiry time (soonest first).",
        example: [
          {
            id: "ewb-uuid",
            ewbNumber: "331001234567",
            ewbDate: "2026-01-15T10:30:00.000Z",
            validUpto: "2026-01-16T23:59:59.000Z",
            status: "generated",
            vehicleNumber: "MH02AB1234",
            transportMode: "road",
            distance: 350,
            invoiceId: "inv-uuid",
            invoiceNumber: "INV-2026-0042",
            partyName: "Gupta Enterprises",
          },
          {
            id: "ewb-uuid-2",
            ewbNumber: "331001234890",
            ewbDate: "2026-01-15T14:00:00.000Z",
            validUpto: "2026-01-17T02:00:00.000Z",
            status: "active",
            vehicleNumber: "KA01EF9012",
            transportMode: "road",
            distance: 180,
            invoiceId: "inv-uuid-2",
            invoiceNumber: "INV-2026-0045",
            partyName: "Sharma Traders",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/ewayBill.expiringList" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const expiring = await trpc.ewayBill.expiringList.query();
if (expiring.length > 0) {
  console.log(\`WARNING: \${expiring.length} E-Way Bills expiring within 24 hours\`);
  for (const ewb of expiring) {
    const hoursLeft = ((new Date(ewb.validUpto).getTime() - Date.now()) / 3600000).toFixed(1);
    console.log(\`  \${ewb.ewbNumber} for \${ewb.partyName} — \${hoursLeft} hours left\`);
  }
}`,
        python: `import httpx
from datetime import datetime, timezone

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/ewayBill.expiringList",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
expiring = resp.json()["result"]["data"]["json"]
for ewb in expiring:
    expiry = datetime.fromisoformat(ewb["validUpto"].replace("Z", "+00:00"))
    hours_left = (expiry - datetime.now(timezone.utc)).total_seconds() / 3600
    print(f"{ewb['ewbNumber']} for {ewb['partyName']}: {hours_left:.1f} hours left")`,
      },
      gotchas: [
        "Requires `EWayBill:read` permission. Viewer role and above can access.",
        "Takes no input — returns ALL expiring EWBs for the business.",
        "Only shows bills with `validUpto` between now and now+24 hours. Bills that have already expired are NOT included (use the dashboard with status='expired' for those).",
        "If an EWB is about to expire, use `ewayBill.extend` within the 8-hour window to extend validity.",
        "Poll this endpoint periodically (e.g. every hour) to build expiry alerts in your application.",
      ],
      relatedEndpoints: ["eway-extend", "eway-dashboard"],
    },
  ],
};
