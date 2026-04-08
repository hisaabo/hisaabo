import type { EndpointGroup } from "./types";

export const itcEndpoints: EndpointGroup = {
  id: "itc",
  title: "Input Tax Credit",
  description: "Track Input Tax Credit lifecycle — available, utilized, blocked under Section 17(5), and approaching 180-day reversal deadline under Section 16(4). Generates GSTR-3B Table 4 data.",
  endpoints: [
    {
      id: "itc-dashboard",
      method: "query",
      path: "itc.dashboard",
      title: "ITC Dashboard",
      description: "Get a summary of Input Tax Credit for a return period — available, utilized, reversed, reclaimed, and blocked totals broken down by CGST, SGST, IGST, and Cess. Also returns the utilization record for the period if one exists. Defaults to the current month if no period is specified.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "returnPeriod", type: "string", required: false, description: "Return period in YYYY-MM format (e.g. '2026-01'). Defaults to current month." },
      ],
      output: {
        description: "ITC summary by status (available, utilized, reversed, reclaimed, blocked) and the current utilization record.",
        example: {
          returnPeriod: "2026-01",
          summary: {
            available: { cgst: "45000.00", sgst: "45000.00", igst: "0.00", cess: "0.00", total: "90000.00" },
            utilized: { cgst: "30000.00", sgst: "30000.00", igst: "0.00", cess: "0.00", total: "60000.00" },
            reversed: { cgst: "0.00", sgst: "0.00", igst: "0.00", cess: "0.00", total: "0.00" },
            reclaimed: { cgst: "0.00", sgst: "0.00", igst: "0.00", cess: "0.00", total: "0.00" },
            blocked: { cgst: "2500.00", sgst: "2500.00", igst: "0.00", cess: "0.00", total: "5000.00" },
          },
          utilization: null,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/itc.dashboard?input=%7B%22json%22%3A%7B%22returnPeriod%22%3A%222026-01%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const dashboard = await trpc.itc.dashboard.query({
  returnPeriod: "2026-01",
});
console.log("Available ITC:", dashboard.summary.available.total);
console.log("Blocked ITC:", dashboard.summary.blocked.total);
console.log("Utilization recorded:", dashboard.utilization !== null);`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/itc.dashboard",
    params={"input": '{"json":{"returnPeriod":"2026-01"}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
print("Available ITC:", data["summary"]["available"]["total"])`,
      },
      gotchas: [
        "Requires `ITC:read` permission.",
        "If no `returnPeriod` is provided, defaults to the current calendar month (based on server time in IST).",
        "The `utilization` field is null until `itc.recordUtilization` is called for the period.",
        "All monetary values are strings with 2 decimal places.",
      ],
      relatedEndpoints: ["itc-ledger", "itc-record-utilization", "itc-gstr3b-table4"],
    },
    {
      id: "itc-ledger",
      method: "query",
      path: "itc.ledger",
      title: "ITC Ledger",
      description: "Paginated ledger of ITC entries with invoice and party context. Each entry represents the ITC associated with a purchase invoice — including CGST, SGST, IGST, Cess, reverse charge flag, block reason, and reversal reason. Supports filtering by return period and status.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "returnPeriod", type: "string", required: false, description: "Filter by return period in YYYY-MM format (e.g. '2026-01')" },
        { name: "status", type: "string", required: false, description: "Filter by ITC status", enumValues: ["available", "utilized", "reversed", "reclaimed", "blocked"] },
        { name: "page", type: "number", required: false, description: "Page number (min 1)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Results per page (1–100)", default: "50" },
      ],
      output: {
        description: "Paginated list of ITC ledger entries with linked invoice and party details.",
        example: {
          entries: [
            {
              id: "01957b3c-4d5e-6f78-9012-abcdef345678",
              businessId: "biz-uuid",
              invoiceId: "inv-uuid",
              returnPeriod: "2026-01",
              status: "available",
              cgst: "4500.00",
              sgst: "4500.00",
              igst: "0.00",
              cess: "0.00",
              isReverseCharge: false,
              blockReason: null,
              reversalReason: null,
              notes: null,
              createdAt: "2026-01-15T10:30:00.000Z",
              updatedAt: "2026-01-15T10:30:00.000Z",
              invoiceNumber: "PUR-2026-0018",
              invoiceDate: "2026-01-12T00:00:00.000Z",
              partyName: "Sharma Traders",
            },
          ],
          pagination: { page: 1, limit: 50, total: 23, totalPages: 1 },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/itc.ledger?input=%7B%22json%22%3A%7B%22returnPeriod%22%3A%222026-01%22%2C%22status%22%3A%22available%22%2C%22page%22%3A1%2C%22limit%22%3A25%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const ledger = await trpc.itc.ledger.query({
  returnPeriod: "2026-01",
  status: "available",
  page: 1,
  limit: 25,
});
for (const entry of ledger.entries) {
  const total = (parseFloat(entry.cgst) + parseFloat(entry.sgst) + parseFloat(entry.igst)).toFixed(2);
  console.log(\`\${entry.invoiceNumber} - \${entry.partyName}: Rs. \${total}\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/itc.ledger",
    params={"input": '{"json":{"returnPeriod":"2026-01","status":"available","page":1,"limit":25}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
for entry in data["entries"]:
    print(f"{entry['invoiceNumber']} - {entry['partyName']}: CGST={entry['cgst']}, SGST={entry['sgst']}")`,
      },
      gotchas: [
        "Requires `ITC:read` permission.",
        "Entries are ordered by creation date (newest first).",
        "If `returnPeriod` is omitted, returns entries across ALL periods. This can be a large dataset — use pagination.",
        "The `invoiceNumber`, `invoiceDate`, and `partyName` fields come from LEFT JOINs — they may be null if the invoice was deleted.",
      ],
      relatedEndpoints: ["itc-dashboard", "itc-mark-blocked", "itc-mark-eligible"],
    },
    {
      id: "itc-mark-blocked",
      method: "mutation",
      path: "itc.markBlocked",
      title: "Block ITC",
      description: "Block ITC for a purchase invoice under Section 17(5) or other disallowed categories. Moves the entry from 'available' to 'blocked' status. Only entries currently in 'available' status can be blocked.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "invoiceId", type: "string", required: true, description: "UUID of the purchase invoice" },
        { name: "blockReason", type: "string", required: true, description: "Reason for blocking ITC", enumValues: ["motor_vehicle", "food_beverage", "personal", "membership", "travel_benefits", "works_contract", "construction", "telecom", "other"] },
        { name: "notes", type: "string", required: false, description: "Additional notes (max 500 chars)" },
      ],
      output: {
        description: "The updated ITC ledger entry with blocked status.",
        example: {
          id: "01957b3c-4d5e-6f78-9012-abcdef345678",
          status: "blocked",
          blockReason: "motor_vehicle",
          notes: "Company car maintenance — blocked under Section 17(5)(a)",
          cgst: "4500.00",
          sgst: "4500.00",
          igst: "0.00",
          cess: "0.00",
          updatedAt: "2026-01-20T14:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/itc.markBlocked \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"invoiceId":"inv-uuid","blockReason":"motor_vehicle","notes":"Company car maintenance"}}'`,
        javascript: `const blocked = await trpc.itc.markBlocked.mutate({
  invoiceId: "inv-uuid",
  blockReason: "motor_vehicle",
  notes: "Company car maintenance — blocked under Section 17(5)(a)",
});
console.log("ITC blocked:", blocked.status); // "blocked"`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/itc.markBlocked",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "invoiceId": "inv-uuid",
        "blockReason": "motor_vehicle",
        "notes": "Company car maintenance",
    }},
)
blocked = resp.json()["result"]["data"]["json"]
print("Blocked:", blocked["status"])`,
      },
      gotchas: [
        "Requires `ITC:update` permission. Admin role only.",
        "Returns NOT_FOUND if no 'available' ITC entry exists for the invoice. You cannot block already-blocked or utilized ITC.",
        "Section 17(5) block reasons: motor_vehicle (cars), food_beverage (food/drinks), personal (personal use), membership (club/health), travel_benefits (employee travel), works_contract (construction), construction (immovable property), telecom (towers/pipes).",
        "Blocking ITC is reversible — use `itc.markEligible` to unblock.",
      ],
      relatedEndpoints: ["itc-mark-eligible", "itc-ledger"],
    },
    {
      id: "itc-mark-eligible",
      method: "mutation",
      path: "itc.markEligible",
      title: "Unblock ITC",
      description: "Move a blocked ITC entry back to 'available' status. Use this when an ITC entry was incorrectly blocked or when the blocking reason no longer applies.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "invoiceId", type: "string", required: true, description: "UUID of the purchase invoice whose ITC should be unblocked" },
      ],
      output: {
        description: "The updated ITC ledger entry with available status.",
        example: {
          id: "01957b3c-4d5e-6f78-9012-abcdef345678",
          status: "available",
          blockReason: null,
          cgst: "4500.00",
          sgst: "4500.00",
          igst: "0.00",
          cess: "0.00",
          updatedAt: "2026-01-22T09:15:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/itc.markEligible \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"invoiceId":"inv-uuid"}}'`,
        javascript: `const eligible = await trpc.itc.markEligible.mutate({
  invoiceId: "inv-uuid",
});
console.log("ITC unblocked:", eligible.status); // "available"`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/itc.markEligible",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {"invoiceId": "inv-uuid"}},
)
eligible = resp.json()["result"]["data"]["json"]
print("Unblocked:", eligible["status"])`,
      },
      gotchas: [
        "Requires `ITC:update` permission. Admin role only.",
        "Returns NOT_FOUND if no 'blocked' ITC entry exists for the invoice. You can only unblock entries that are currently blocked.",
        "The `blockReason` is cleared to null when unblocked.",
      ],
      relatedEndpoints: ["itc-mark-blocked", "itc-ledger"],
    },
    {
      id: "itc-aging-alerts",
      method: "query",
      path: "itc.agingAlerts",
      title: "ITC Aging Alerts",
      description: "List purchase invoices with available ITC that are approaching or past the 180-day payment deadline under Section 16(2) proviso / Section 16(4). If a purchase invoice is not paid within 180 days, the ITC must be reversed. This endpoint finds invoices older than 150 days with outstanding balances, giving you a 30-day warning window.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Array of at-risk ITC entries sorted by invoice date (oldest first). Each entry has an urgency level: 'warning' (150–180 days) or 'critical' (>180 days).",
        example: [
          {
            itcEntryId: "01957b3c-4d5e-6f78-9012-abcdef345678",
            invoiceId: "inv-uuid",
            invoiceNumber: "PUR-2025-0089",
            partyName: "Gupta Enterprises",
            invoiceDate: "2025-07-10T00:00:00.000Z",
            daysOutstanding: 175,
            itcAmount: "12500.00",
            cgst: "6250.00",
            sgst: "6250.00",
            igst: "0.00",
            cess: "0.00",
            outstandingAmount: "85000.00",
            urgency: "warning",
          },
          {
            itcEntryId: "01957c4d-5e6f-7890-1234-bcdef0123456",
            invoiceId: "inv-uuid-2",
            invoiceNumber: "PUR-2025-0072",
            partyName: "Delhi Paper Mills",
            invoiceDate: "2025-06-15T00:00:00.000Z",
            daysOutstanding: 200,
            itcAmount: "8400.00",
            cgst: "4200.00",
            sgst: "4200.00",
            igst: "0.00",
            cess: "0.00",
            outstandingAmount: "56000.00",
            urgency: "critical",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/itc.agingAlerts" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const alerts = await trpc.itc.agingAlerts.query();
const critical = alerts.filter(a => a.urgency === "critical");
const warning = alerts.filter(a => a.urgency === "warning");
console.log(\`\${critical.length} critical, \${warning.length} warning\`);

for (const alert of critical) {
  console.log(\`URGENT: Pay \${alert.partyName} Rs. \${alert.outstandingAmount} or reverse Rs. \${alert.itcAmount} ITC\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/itc.agingAlerts",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
alerts = resp.json()["result"]["data"]["json"]
for alert in alerts:
    if alert["urgency"] == "critical":
        print(f"CRITICAL: {alert['partyName']} - {alert['daysOutstanding']} days, ITC at risk: Rs. {alert['itcAmount']}")`,
      },
      gotchas: [
        "Requires `ITC:read` permission.",
        "Takes no input — scans ALL available ITC entries for the business.",
        "Only finds invoices older than 150 days with outstanding balance (totalAmount - amountPaid > 0).",
        "'warning' = 150–180 days outstanding. 'critical' = more than 180 days — ITC should have already been reversed.",
        "Section 16(4) mandates ITC reversal if payment is not made to the supplier within 180 days from the date of invoice. The reversed ITC can be reclaimed once payment is made.",
        "Results are sorted by invoice date ascending (oldest/most urgent first).",
      ],
      relatedEndpoints: ["itc-dashboard", "itc-mark-blocked"],
    },
    {
      id: "itc-record-utilization",
      method: "mutation",
      path: "itc.recordUtilization",
      title: "Record ITC Utilization",
      description: "Record how ITC was utilized against output tax liability for a return period. Creates or updates the utilization record and generates a system journal entry (Dr Output GST / Cr Input GST). Follows the GST set-off order: IGST can be utilized against IGST, CGST, or SGST output liability. CGST can only be utilized against CGST, SGST against SGST.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "returnPeriod", type: "string", required: true, description: "Return period in YYYY-MM format (e.g. '2026-01')" },
        { name: "cgstUtilized", type: "string", required: false, description: "CGST ITC utilized against CGST output liability", default: "0" },
        { name: "sgstUtilized", type: "string", required: false, description: "SGST ITC utilized against SGST output liability", default: "0" },
        { name: "igstUtilizedAgainstCgst", type: "string", required: false, description: "IGST ITC utilized against CGST output liability", default: "0" },
        { name: "igstUtilizedAgainstSgst", type: "string", required: false, description: "IGST ITC utilized against SGST output liability", default: "0" },
        { name: "igstUtilizedAgainstIgst", type: "string", required: false, description: "IGST ITC utilized against IGST output liability", default: "0" },
        { name: "notes", type: "string", required: false, description: "Optional notes (max 500 chars)" },
      ],
      output: {
        description: "The utilization record and the auto-generated journal entry.",
        example: {
          utilization: {
            id: "util-uuid",
            businessId: "biz-uuid",
            returnPeriod: "2026-01",
            cgstUtilized: "30000.00",
            sgstUtilized: "30000.00",
            igstUtilizedAgainstCgst: "0.00",
            igstUtilizedAgainstSgst: "0.00",
            igstUtilizedAgainstIgst: "0.00",
            notes: "January 2026 GSTR-3B filing",
          },
          journalEntry: {
            id: "je-uuid",
            entryNumber: "JE-00012",
            narration: "ITC utilization for return period 2026-01",
            source: "system",
          },
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/itc.recordUtilization \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"returnPeriod":"2026-01","cgstUtilized":"30000.00","sgstUtilized":"30000.00","notes":"January 2026 GSTR-3B filing"}}'`,
        javascript: `const result = await trpc.itc.recordUtilization.mutate({
  returnPeriod: "2026-01",
  cgstUtilized: "30000.00",
  sgstUtilized: "30000.00",
  igstUtilizedAgainstIgst: "0.00",
  igstUtilizedAgainstCgst: "0.00",
  igstUtilizedAgainstSgst: "0.00",
  notes: "January 2026 GSTR-3B filing",
});
console.log("Journal entry:", result.journalEntry.entryNumber);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/itc.recordUtilization",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "returnPeriod": "2026-01",
        "cgstUtilized": "30000.00",
        "sgstUtilized": "30000.00",
        "notes": "January 2026 filing",
    }},
)
result = resp.json()["result"]["data"]["json"]
print("Journal:", result["journalEntry"]["entryNumber"])`,
      },
      gotchas: [
        "Requires `ITC:update` permission. Admin role only.",
        "Utilization amounts cannot exceed available balances — returns BAD_REQUEST with specific error if CGST, SGST, or total IGST utilization exceeds available balance.",
        "IGST utilization is split into three fields: `igstUtilizedAgainstIgst`, `igstUtilizedAgainstCgst`, `igstUtilizedAgainstSgst`. The sum of all three cannot exceed available IGST.",
        "Upserts on (businessId, returnPeriod) — calling again for the same period replaces the previous utilization.",
        "Auto-creates a journal entry: Dr Output CGST (2100) / Cr Input CGST (1510), Dr Output SGST (2101) / Cr Input SGST (1511), etc. Ensure GST chart-of-accounts entries are seeded.",
        "All monetary values must be strings matching the pattern: up to 13 digits with optional 2 decimal places (e.g. '30000.00').",
      ],
      relatedEndpoints: ["itc-dashboard", "itc-gstr3b-table4"],
    },
    {
      id: "itc-gstr3b-table4",
      method: "query",
      path: "itc.gstr3bTable4",
      title: "GSTR-3B Table 4",
      description: "Generate the GSTR-3B Table 4 (ITC) breakdown for a given month. Returns the structured data matching the official GSTR-3B Table 4 format — ITC available (import of goods, import of services, reverse charge, all other), ITC reversed (Rules 42/43, others), net ITC, and ineligible ITC (Section 17(5), others).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "year", type: "number", required: true, description: "Calendar year (2017–2099)" },
        { name: "month", type: "number", required: true, description: "Month number (1–12)" },
      ],
      output: {
        description: "GSTR-3B Table 4 structured data with ITC available, reversed, net, and ineligible sections.",
        example: {
          returnPeriod: "2026-01",
          itcAvailable: {
            importOfGoods: { integratedTax: "0.00", centralTax: "0.00", stateTax: "0.00", cess: "0.00" },
            importOfServices: { integratedTax: "0.00", centralTax: "0.00", stateTax: "0.00", cess: "0.00" },
            reverseCharge: { integratedTax: "0.00", centralTax: "2000.00", stateTax: "2000.00", cess: "0.00" },
            allOther: { integratedTax: "0.00", centralTax: "45000.00", stateTax: "45000.00", cess: "0.00" },
            total: { integratedTax: "0.00", centralTax: "47000.00", stateTax: "47000.00", cess: "0.00" },
          },
          itcReversed: {
            rules42_43: { integratedTax: "0.00", centralTax: "0.00", stateTax: "0.00", cess: "0.00" },
            others: { integratedTax: "0.00", centralTax: "2500.00", stateTax: "2500.00", cess: "0.00" },
            total: { integratedTax: "0.00", centralTax: "2500.00", stateTax: "2500.00", cess: "0.00" },
          },
          netItc: { integratedTax: "0.00", centralTax: "44500.00", stateTax: "44500.00", cess: "0.00" },
          ineligible: {
            section17_5: { integratedTax: "0.00", centralTax: "2500.00", stateTax: "2500.00", cess: "0.00" },
            others: { integratedTax: "0.00", centralTax: "0.00", stateTax: "0.00", cess: "0.00" },
            total: { integratedTax: "0.00", centralTax: "2500.00", stateTax: "2500.00", cess: "0.00" },
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/itc.gstr3bTable4?input=%7B%22json%22%3A%7B%22year%22%3A2026%2C%22month%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const table4 = await trpc.itc.gstr3bTable4.query({
  year: 2026,
  month: 1,
});
console.log("Net ITC CGST:", table4.netItc.centralTax);
console.log("Net ITC SGST:", table4.netItc.stateTax);
console.log("Ineligible (Sec 17(5)):", table4.ineligible.section17_5.centralTax);`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/itc.gstr3bTable4",
    params={"input": '{"json":{"year":2026,"month":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
table4 = resp.json()["result"]["data"]["json"]
print("Net ITC CGST:", table4["netItc"]["centralTax"])
print("Blocked (17(5)):", table4["ineligible"]["section17_5"]["centralTax"])`,
      },
      gotchas: [
        "Requires `ITC:read` permission.",
        "Uses GSTR-3B official field names: 'integratedTax' (IGST), 'centralTax' (CGST), 'stateTax' (SGST).",
        "Import of goods (4A1) and import of services (4A2) are currently always zero — these will be populated when import invoice tracking is added.",
        "Net ITC = ITC Available (total) minus ITC Reversed (total). This is the amount you can utilize against output liability.",
        "The `ineligible` section shows ITC blocked under Section 17(5) and reversed for other reasons — this is informational and already included in the reversed totals.",
      ],
      relatedEndpoints: ["itc-dashboard", "itc-record-utilization", "gst-gstr3b"],
    },
  ],
};
