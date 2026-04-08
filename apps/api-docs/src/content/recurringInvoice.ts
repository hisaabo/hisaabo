import type { EndpointGroup } from "./types";

export const recurringInvoiceEndpoints: EndpointGroup = {
  id: "recurring",
  title: "Recurring Invoices",
  description: "Create recurring invoice templates that auto-generate invoices on schedule. Supports daily, weekly, monthly, and yearly frequencies. In-process scheduler with 60s tick. Plan limit: 5 runs/month on free tier.",
  endpoints: [
    {
      id: "recurring-list",
      method: "query",
      path: "recurringInvoice.list",
      title: "List Recurring Templates",
      description: "Paginated list of recurring invoice templates for the current business. Supports filtering by status (active, paused, completed, expired). Includes party name, frequency, next run date, and run count.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "status", type: "enum", required: false, description: "Filter by template status", enumValues: ["active", "paused", "completed", "expired"] },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1-100)", default: "20" },
      ],
      output: {
        description: "Paginated list of recurring invoice templates.",
        example: {
          data: [
            {
              id: "template-uuid",
              name: "Monthly Rent — Sharma Properties",
              partyId: "party-uuid",
              partyName: "Sharma Properties",
              type: "purchase",
              frequency: "monthly",
              status: "active",
              nextRunDate: "2026-05-01T00:00:00.000Z",
              lastRunDate: "2026-04-01T00:05:12.000Z",
              totalRuns: 6,
              maxRuns: null,
              startDate: "2025-11-01T00:00:00.000Z",
              endDate: null,
              createdAt: "2025-10-28T09:15:00.000Z",
            },
          ],
          total: 4,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/recurringInvoice.list?input=%7B%22json%22%3A%7B%22page%22%3A1%2C%22limit%22%3A20%2C%22status%22%3A%22active%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.recurringInvoice.list.query({
  status: "active",
  page: 1,
  limit: 20,
});
console.log(\`\${total} active recurring templates\`);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"page": 1, "limit": 20, "status": "active"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/recurringInvoice.list?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
result = resp.json()["result"]["data"]["json"]`,
      },
    },
    {
      id: "recurring-get-by-id",
      method: "query",
      path: "recurringInvoice.getById",
      title: "Get Recurring Template",
      description: "Retrieve full details of a recurring invoice template including line items, charges, notes, terms, and schedule configuration. The party name is joined for display convenience.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "The template ID" },
      ],
      output: {
        description: "Full recurring invoice template with all configuration.",
        example: {
          id: "template-uuid",
          businessId: "biz-uuid",
          partyId: "party-uuid",
          partyName: "Sharma Properties",
          name: "Monthly Rent — Sharma Properties",
          type: "purchase",
          frequency: "monthly",
          customIntervalDays: null,
          lineItems: [
            { itemName: "Office Rent", description: "Monthly rent for 2nd floor office", quantity: "1", unitPrice: "35000.00", taxPercent: "18", discountPercent: "0" },
          ],
          notes: "Pay before 5th of every month",
          termsAndConditions: null,
          additionalCharges: "0",
          charges: null,
          status: "active",
          startDate: "2025-11-01T00:00:00.000Z",
          endDate: null,
          nextRunDate: "2026-05-01T00:00:00.000Z",
          lastRunDate: "2026-04-01T00:05:12.000Z",
          totalRuns: 6,
          maxRuns: null,
          createdAt: "2025-10-28T09:15:00.000Z",
          updatedAt: "2026-04-01T00:05:12.000Z",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/recurringInvoice.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22template-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const template = await trpc.recurringInvoice.getById.query({
  id: "template-uuid",
});
console.log(template.name, "—", template.frequency);
console.log("Next run:", template.nextRunDate);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "template-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/recurringInvoice.getById?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
template = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns NOT_FOUND if the template doesn't belong to the current business.",
        "`lineItems` is stored as JSONB on the template — not normalized into a separate table.",
      ],
    },
    {
      id: "recurring-create",
      method: "mutation",
      path: "recurringInvoice.create",
      title: "Create Recurring Template",
      description: "Create a new recurring invoice template. Specify a party, line items, frequency, and start date. The scheduler automatically generates invoices when the next run date arrives. If the start date is in the future, the first invoice is generated on that date. If it's in the past, the next run date is computed from today.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "partyId", type: "string (UUID)", required: true, description: "The party (customer/supplier) for the recurring invoice" },
        { name: "name", type: "string", required: true, description: "Template name for identification (1-200 chars)" },
        { name: "type", type: "enum", required: true, description: "Invoice direction", enumValues: ["sale", "purchase"] },
        { name: "frequency", type: "enum", required: true, description: "How often to generate invoices", enumValues: ["weekly", "biweekly", "monthly", "quarterly", "half_yearly", "yearly", "custom"] },
        { name: "customIntervalDays", type: "number", required: false, description: "Custom interval in days (1-365). Required when frequency is 'custom'." },
        { name: "lineItems", type: "array", required: true, description: "Invoice line items (at least 1). Each item has itemName, description, quantity, unitPrice, taxPercent, discountPercent." },
        { name: "notes", type: "string", required: false, description: "Notes to include on generated invoices (max 2000 chars)" },
        { name: "termsAndConditions", type: "string", required: false, description: "Terms to include on generated invoices (max 2000 chars)" },
        { name: "additionalCharges", type: "string", required: false, description: "Additional charges amount (e.g. '500.00')", default: "0" },
        { name: "charges", type: "array", required: false, description: "Named charges (e.g. [{label: 'Delivery', amount: '200.00'}])" },
        { name: "startDate", type: "string (ISO 8601)", required: true, description: "When to start generating invoices" },
        { name: "endDate", type: "string (ISO 8601)", required: false, description: "Optional end date — template expires after this" },
        { name: "maxRuns", type: "number", required: false, description: "Maximum number of invoices to generate. Leave unset for unlimited." },
      ],
      output: {
        description: "The created template record.",
        example: {
          id: "template-uuid",
          businessId: "biz-uuid",
          partyId: "party-uuid",
          name: "Monthly Rent — Sharma Properties",
          type: "purchase",
          frequency: "monthly",
          status: "active",
          nextRunDate: "2026-05-01T00:00:00.000Z",
          startDate: "2025-11-01T00:00:00.000Z",
          totalRuns: 0,
          createdAt: "2026-04-08T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/recurringInvoice.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{
    "partyId": "party-uuid",
    "name": "Monthly Rent — Sharma Properties",
    "type": "purchase",
    "frequency": "monthly",
    "startDate": "2026-05-01T00:00:00.000Z",
    "lineItems": [
      {"itemName": "Office Rent", "description": "Monthly rent for 2nd floor", "quantity": "1", "unitPrice": "35000.00", "taxPercent": "18", "discountPercent": "0"}
    ],
    "notes": "Pay before 5th of every month"
  }}'`,
        javascript: `const template = await trpc.recurringInvoice.create.mutate({
  partyId: "party-uuid",
  name: "Monthly Rent — Sharma Properties",
  type: "purchase",
  frequency: "monthly",
  startDate: "2026-05-01T00:00:00.000Z",
  lineItems: [
    {
      itemName: "Office Rent",
      description: "Monthly rent for 2nd floor",
      quantity: "1",
      unitPrice: "35000.00",
      taxPercent: "18",
      discountPercent: "0",
    },
  ],
  notes: "Pay before 5th of every month",
});
console.log("Template created, next run:", template.nextRunDate);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/recurringInvoice.create",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "partyId": "party-uuid",
        "name": "Monthly Rent — Sharma Properties",
        "type": "purchase",
        "frequency": "monthly",
        "startDate": "2026-05-01T00:00:00.000Z",
        "lineItems": [
            {"itemName": "Office Rent", "description": "Monthly rent for 2nd floor",
             "quantity": "1", "unitPrice": "35000.00", "taxPercent": "18", "discountPercent": "0"}
        ],
        "notes": "Pay before 5th of every month",
    }},
)
template = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns BAD_REQUEST if the party does not belong to the current business.",
        "When `frequency` is `custom`, `customIntervalDays` is required (1-365).",
        "Line items are stored as JSONB on the template — item IDs are not referenced, only names and prices.",
        "Monetary values in line items must be strings (e.g. '35000.00', not 35000).",
        "Free tier limit: 5 successful recurring invoice runs per month. The template is created regardless, but execution may be blocked.",
        "An audit log entry is created for every template creation.",
      ],
    },
    {
      id: "recurring-update",
      method: "mutation",
      path: "recurringInvoice.update",
      title: "Update Recurring Template",
      description: "Update an existing recurring invoice template. All fields are optional — only provided fields are changed. Can update line items, schedule, party, and metadata. The template must exist and belong to the current business.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "The template ID to update" },
        { name: "data", type: "object", required: true, description: "Fields to update. Same shape as create but all fields optional: name, partyId, type, frequency, customIntervalDays, lineItems, notes, termsAndConditions, additionalCharges, charges, endDate, maxRuns." },
      ],
      output: {
        description: "The updated template record.",
        example: {
          id: "template-uuid",
          name: "Monthly Rent — Sharma Properties (Updated)",
          frequency: "monthly",
          status: "active",
          updatedAt: "2026-04-08T11:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/recurringInvoice.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"template-uuid","data":{"name":"Monthly Rent — Sharma Properties (Revised)","additionalCharges":"500.00"}}}'`,
        javascript: `const updated = await trpc.recurringInvoice.update.mutate({
  id: "template-uuid",
  data: {
    name: "Monthly Rent — Sharma Properties (Revised)",
    additionalCharges: "500.00",
  },
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/recurringInvoice.update",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "id": "template-uuid",
        "data": {"name": "Monthly Rent — Sharma Properties (Revised)", "additionalCharges": "500.00"},
    }},
)`,
      },
      gotchas: [
        "Returns NOT_FOUND if the template doesn't belong to the current business.",
        "If updating `partyId`, the new party must belong to the current business.",
        "Set `maxRuns` to `null` to remove the run limit (unlimited).",
        "Updating does not recalculate `nextRunDate` — use `resume` after `pause` for that.",
      ],
    },
    {
      id: "recurring-delete",
      method: "mutation",
      path: "recurringInvoice.delete",
      title: "Delete Recurring Template",
      description: "Permanently delete a recurring invoice template. Previously generated invoices are not affected. Requires admin-level permission. An audit log entry is created.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "The template ID to delete" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/recurringInvoice.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"template-uuid"}}'`,
        javascript: `await trpc.recurringInvoice.delete.mutate({ id: "template-uuid" });`,
        python: `import httpx

httpx.post(
    "https://api.hisaabo.in/api/trpc/recurringInvoice.delete",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {"id": "template-uuid"}},
)`,
      },
      gotchas: [
        "Requires admin-level permission (`delete` on RecurringInvoice).",
        "Deletion is permanent — the template and its schedule are removed.",
        "Previously generated invoices from this template are NOT deleted.",
        "Execution history (runs) may become orphaned but is retained for audit.",
      ],
    },
    {
      id: "recurring-pause",
      method: "mutation",
      path: "recurringInvoice.pause",
      title: "Pause Recurring Template",
      description: "Pause an active recurring invoice template. The scheduler will skip this template until it is resumed. Only active templates can be paused.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "The template ID to pause" },
      ],
      output: {
        description: "The updated (paused) template record.",
        example: {
          id: "template-uuid",
          status: "paused",
          updatedAt: "2026-04-08T12:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/recurringInvoice.pause \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"template-uuid"}}'`,
        javascript: `const paused = await trpc.recurringInvoice.pause.mutate({
  id: "template-uuid",
});
console.log("Status:", paused.status); // "paused"`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/recurringInvoice.pause",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {"id": "template-uuid"}},
)`,
      },
      gotchas: [
        "Returns BAD_REQUEST if the template is not currently `active`.",
        "Pausing does not cancel the current run — if an invoice was being generated at the moment of pause, it will complete.",
      ],
      relatedEndpoints: ["recurring-resume"],
    },
    {
      id: "recurring-resume",
      method: "mutation",
      path: "recurringInvoice.resume",
      title: "Resume Recurring Template",
      description: "Resume a paused recurring invoice template. Recalculates the next run date from the current time based on the template's frequency. Only paused templates can be resumed.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "The template ID to resume" },
      ],
      output: {
        description: "The updated (active) template record with recalculated next run date.",
        example: {
          id: "template-uuid",
          status: "active",
          nextRunDate: "2026-05-08T00:00:00.000Z",
          updatedAt: "2026-04-08T12:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/recurringInvoice.resume \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"template-uuid"}}'`,
        javascript: `const resumed = await trpc.recurringInvoice.resume.mutate({
  id: "template-uuid",
});
console.log("Next run:", resumed.nextRunDate);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/recurringInvoice.resume",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {"id": "template-uuid"}},
)
data = resp.json()["result"]["data"]["json"]
print("Next run:", data["nextRunDate"])`,
      },
      gotchas: [
        "Returns NOT_FOUND if the template doesn't belong to the current business.",
        "Returns BAD_REQUEST if the template is not currently `paused`.",
        "The next run date is recalculated from NOW, not from where it left off. If a template was paused for 3 months, it won't generate back-dated invoices.",
      ],
      relatedEndpoints: ["recurring-pause"],
    },
    {
      id: "recurring-run-now",
      method: "mutation",
      path: "recurringInvoice.runNow",
      title: "Run Template Now",
      description: "Manually trigger an immediate invoice generation from a recurring template. The template must be active or paused. Generates an invoice using the template's current line items and party. Useful for testing templates or generating an invoice ahead of schedule.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "The template ID to run immediately" },
      ],
      output: {
        description: "The result from the invoice generation engine.",
        example: {
          invoiceId: "inv-uuid",
          invoiceNumber: "INV-2026-042",
          status: "success",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/recurringInvoice.runNow \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"template-uuid"}}'`,
        javascript: `const result = await trpc.recurringInvoice.runNow.mutate({
  id: "template-uuid",
});
console.log("Generated invoice:", result.invoiceNumber);`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/recurringInvoice.runNow",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {"id": "template-uuid"}},
)
result = resp.json()["result"]["data"]["json"]
print("Generated:", result["invoiceNumber"])`,
      },
      gotchas: [
        "Returns NOT_FOUND if the template doesn't belong to the current business.",
        "Returns BAD_REQUEST if the template status is `completed` or `expired`.",
        "This counts against the monthly plan limit for recurring invoice runs (5/month on free tier).",
        "The generated invoice uses atomic invoice number generation — no duplicates.",
      ],
      relatedEndpoints: ["recurring-execution-history"],
    },
    {
      id: "recurring-execution-history",
      method: "query",
      path: "recurringInvoice.executionHistory",
      title: "Execution History",
      description: "Paginated list of invoice generation runs for a specific template. Shows each run's status (success/failed), generated invoice number, error message (if failed), and execution timestamp. Useful for auditing and debugging template behavior.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "templateId", type: "string (UUID)", required: true, description: "The template to view history for" },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1-100)", default: "20" },
      ],
      output: {
        description: "Paginated list of execution runs sorted newest-first.",
        example: {
          data: [
            {
              id: "run-uuid-1",
              templateId: "template-uuid",
              invoiceId: "inv-uuid",
              invoiceNumber: "INV-2026-042",
              status: "success",
              errorMessage: null,
              executedAt: "2026-04-01T00:05:12.000Z",
            },
            {
              id: "run-uuid-2",
              templateId: "template-uuid",
              invoiceId: null,
              invoiceNumber: null,
              status: "failed",
              errorMessage: "Party not found — may have been deleted",
              executedAt: "2026-03-01T00:04:58.000Z",
            },
          ],
          total: 6,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/recurringInvoice.executionHistory?input=%7B%22json%22%3A%7B%22templateId%22%3A%22template-uuid%22%2C%22page%22%3A1%2C%22limit%22%3A20%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.recurringInvoice.executionHistory.query({
  templateId: "template-uuid",
  page: 1,
  limit: 20,
});
for (const run of data) {
  console.log(\`\${run.executedAt}: \${run.status} — \${run.invoiceNumber ?? run.errorMessage}\`);
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"templateId": "template-uuid", "page": 1, "limit": 20}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/recurringInvoice.executionHistory?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Failed runs have `invoiceId: null` and an `errorMessage` explaining the failure.",
        "The invoice number is joined from the invoices table — if the invoice was deleted, it shows null.",
      ],
      relatedEndpoints: ["recurring-run-now"],
    },
    {
      id: "recurring-plan-usage",
      method: "query",
      path: "recurringInvoice.planUsage",
      title: "Plan Usage",
      description: "Check the current month's recurring invoice usage against plan limits. Returns the number of successful runs this month and the total number of templates. Useful for displaying a usage meter in the UI.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Current month's usage statistics.",
        example: {
          runsThisMonth: 3,
          totalTemplates: 4,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/recurringInvoice.planUsage" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const usage = await trpc.recurringInvoice.planUsage.query();
console.log(\`\${usage.runsThisMonth}/5 runs used this month\`);
console.log(\`\${usage.totalTemplates} templates configured\`);`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/recurringInvoice.planUsage",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
usage = resp.json()["result"]["data"]["json"]
print(f"{usage['runsThisMonth']}/5 runs this month")`,
      },
      gotchas: [
        "Only counts successful runs — failed runs don't count against the limit.",
        "'This month' starts at midnight on the 1st (server timezone).",
        "Free tier limit is 5 runs/month. Pro and above have higher or unlimited limits.",
      ],
    },
    {
      id: "recurring-suggestions",
      method: "query",
      path: "recurringInvoice.suggestions",
      title: "Suggestions",
      description: "Analyze the last 2 months of invoices to suggest parties that could benefit from recurring invoice automation. Uses statistical analysis: groups invoices by party, calculates the median interval between invoices, and suggests a frequency. Only suggests parties with 3+ invoices and a coefficient of variation below 0.5 (regular patterns).",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Array of suggestions sorted by invoice frequency (most frequent first), limited to 20.",
        example: [
          {
            partyId: "party-uuid-1",
            partyName: "Sharma Properties",
            type: "purchase",
            suggestedFrequency: "monthly",
            invoiceCount: 6,
            medianAmount: "35000.00",
            medianIntervalDays: 30,
          },
          {
            partyId: "party-uuid-2",
            partyName: "Raj Electronics",
            type: "sale",
            suggestedFrequency: "weekly",
            invoiceCount: 9,
            medianAmount: "12500.00",
            medianIntervalDays: 7,
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/recurringInvoice.suggestions" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const suggestions = await trpc.recurringInvoice.suggestions.query();
for (const s of suggestions) {
  console.log(\`\${s.partyName}: suggest \${s.suggestedFrequency} (\${s.invoiceCount} invoices, median Rs \${s.medianAmount})\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/recurringInvoice.suggestions",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
suggestions = resp.json()["result"]["data"]["json"]
for s in suggestions:
    print(f"{s['partyName']}: {s['suggestedFrequency']} (median Rs {s['medianAmount']})")`,
      },
      gotchas: [
        "Only analyzes the last 2 months of invoices — older patterns are not considered.",
        "Requires at least 3 invoices per party to generate a suggestion.",
        "Parties with irregular intervals (coefficient of variation > 0.5) are excluded.",
        "Returns at most 20 suggestions, sorted by invoice count (most active first).",
        "The `medianAmount` is the median total amount across recent invoices — use as a starting point for line item amounts.",
      ],
    },
  ],
};
