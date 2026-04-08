import type { EndpointGroup } from "./types";

export const journalEndpoints: EndpointGroup = {
  id: "journals",
  title: "Journal Entries",
  description: "Post manual journal entries for depreciation, provisions, bad debt write-offs, and year-end adjustments. Create and use templates for recurring entries. Void entries with automatic reversing entries.",
  endpoints: [
    {
      id: "journal-list",
      method: "query",
      path: "journal.list",
      title: "List Journal Entries",
      description: "List all journal entries for the business, ordered by entry date (newest first). Supports filtering by date range. Each entry includes a computed `lineCount` and `totalAmount` (sum of debits) via subqueries.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "fromDate", type: "string (ISO 8601)", required: false, description: "Start of date range (inclusive)" },
        { name: "toDate", type: "string (ISO 8601)", required: false, description: "End of date range (inclusive)" },
      ],
      output: {
        description: "Array of journal entries with computed line count and total amount.",
        example: [
          {
            id: "je-uuid-1",
            businessId: "biz-uuid",
            entryNumber: "JE-00012",
            entryDate: "2026-03-31T00:00:00.000Z",
            narration: "Depreciation for FY 2025-26 - Office Equipment",
            source: "manual",
            isVoided: false,
            voidedByEntryId: null,
            createdByUserId: "user-uuid",
            createdByName: "Rahul Sharma",
            createdAt: "2026-03-31T18:00:00.000Z",
            updatedAt: "2026-03-31T18:00:00.000Z",
            lineCount: 2,
            totalAmount: "45000.00",
          },
          {
            id: "je-uuid-2",
            businessId: "biz-uuid",
            entryNumber: "JE-00011",
            entryDate: "2026-03-31T00:00:00.000Z",
            narration: "Bad debt write-off - Mehta & Sons",
            source: "manual",
            isVoided: true,
            voidedByEntryId: "je-uuid-3",
            createdByUserId: "user-uuid",
            createdByName: "Rahul Sharma",
            createdAt: "2026-03-31T17:30:00.000Z",
            updatedAt: "2026-04-01T10:00:00.000Z",
            lineCount: 2,
            totalAmount: "15000.00",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/journal.list?input=%7B%22json%22%3A%7B%22fromDate%22%3A%222026-04-01T00%3A00%3A00.000Z%22%2C%22toDate%22%3A%222026-04-30T23%3A59%3A59.000Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const entries = await trpc.journal.list.query({
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2026-04-30T23:59:59.000Z",
});

entries.forEach(e => {
  const status = e.isVoided ? "[VOIDED]" : "";
  console.log(\`\${e.entryNumber} | \${e.narration} | \u20B9\${e.totalAmount} \${status}\`);
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {
    "fromDate": "2026-04-01T00:00:00.000Z",
    "toDate": "2026-04-30T23:59:59.000Z",
}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/journal.list?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
entries = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "`totalAmount` is the sum of debit amounts across all lines (which equals total credits in a balanced entry). It is a string.",
        "Voided entries are still returned in the list with `isVoided: true`. Filter them client-side if needed.",
        "This is not paginated. For businesses with many journal entries, always use a date range filter.",
      ],
    },
    {
      id: "journal-get-by-id",
      method: "query",
      path: "journal.getById",
      title: "Get Journal Entry",
      description: "Fetch a single journal entry by ID, including all lines joined with account name and code from the Chart of Accounts. Throws NOT_FOUND if the entry does not exist or belongs to a different business.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Journal entry ID" },
      ],
      output: {
        description: "Journal entry with full line details including account names.",
        example: {
          id: "je-uuid-1",
          businessId: "biz-uuid",
          entryNumber: "JE-00012",
          entryDate: "2026-03-31T00:00:00.000Z",
          narration: "Depreciation for FY 2025-26 - Office Equipment",
          source: "manual",
          isVoided: false,
          voidedByEntryId: null,
          createdByUserId: "user-uuid",
          createdByName: "Rahul Sharma",
          createdAt: "2026-03-31T18:00:00.000Z",
          updatedAt: "2026-03-31T18:00:00.000Z",
          lines: [
            {
              id: "jl-uuid-1",
              journalEntryId: "je-uuid-1",
              accountId: "acc-depreciation-uuid",
              accountCode: "4200",
              accountName: "Depreciation Expense",
              debit: "45000.00",
              credit: "0.00",
              narration: "Office equipment - 15% SLM",
            },
            {
              id: "jl-uuid-2",
              journalEntryId: "je-uuid-1",
              accountId: "acc-accum-dep-uuid",
              accountCode: "1250",
              accountName: "Accumulated Depreciation - Equipment",
              debit: "0.00",
              credit: "45000.00",
              narration: null,
            },
          ],
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/journal.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22je-uuid-1%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const entry = await trpc.journal.getById.query({ id: "je-uuid-1" });

console.log(\`\${entry.entryNumber}: \${entry.narration}\`);
entry.lines.forEach(line => {
  const side = Number(line.debit) > 0 ? "DR" : "CR";
  const amount = Number(line.debit) > 0 ? line.debit : line.credit;
  console.log(\`  \${line.accountCode} \${line.accountName} | \u20B9\${amount} \${side}\`);
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "je-uuid-1"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/journal.getById?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
entry = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Unlike most `getById` endpoints, this throws NOT_FOUND (not null) when the entry is missing.",
        "Lines include `accountCode` and `accountName` from the Chart of Accounts join. These are denormalized for display convenience.",
        "Both `debit` and `credit` are always present on each line. One will be \"0.00\" and the other will have the amount.",
      ],
    },
    {
      id: "journal-create",
      method: "mutation",
      path: "journal.create",
      title: "Create Journal Entry",
      description: "Post a new manual journal entry. The entry number (e.g. `JE-00013`) is atomically generated using a PostgreSQL transaction. All account IDs in the lines are verified to belong to the current business. The entry `source` is always set to `manual`.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "entryDate", type: "string (ISO 8601)", required: true, description: "Date of the journal entry, e.g. \"2026-03-31T00:00:00.000Z\"" },
        { name: "narration", type: "string", required: false, description: "Description/narration for the entry (max 2000 chars)" },
        { name: "lines", type: "array", required: true, description: "At least 2 lines required. Total debits must equal total credits." },
        { name: "lines[].accountId", type: "string (UUID)", required: true, description: "Chart of Accounts account ID" },
        { name: "lines[].debit", type: "string (decimal)", required: false, description: "Debit amount as decimal string. Default \"0\".", default: "0" },
        { name: "lines[].credit", type: "string (decimal)", required: false, description: "Credit amount as decimal string. Default \"0\".", default: "0" },
        { name: "lines[].narration", type: "string", required: false, description: "Per-line narration (max 500 chars)" },
      ],
      output: {
        description: "Created journal entry (without lines). Use `journal.getById` to fetch full details.",
        example: {
          id: "je-uuid-new",
          businessId: "biz-uuid",
          entryNumber: "JE-00013",
          entryDate: "2026-03-31T00:00:00.000Z",
          narration: "Provision for doubtful debts - Q4 FY26",
          source: "manual",
          isVoided: false,
          voidedByEntryId: null,
          createdByUserId: "user-uuid",
          createdByName: "Rahul Sharma",
          createdAt: "2026-03-31T18:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/journal.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "entryDate": "2026-03-31T00:00:00.000Z",
      "narration": "Depreciation for FY 2025-26 - Office Equipment",
      "lines": [
        {
          "accountId": "acc-depreciation-uuid",
          "debit": "45000.00",
          "credit": "0",
          "narration": "Office equipment - 15% SLM"
        },
        {
          "accountId": "acc-accum-dep-uuid",
          "debit": "0",
          "credit": "45000.00"
        }
      ]
    }
  }'`,
        javascript: `const entry = await trpc.journal.create.mutate({
  entryDate: "2026-03-31T00:00:00.000Z",
  narration: "Depreciation for FY 2025-26 - Office Equipment",
  lines: [
    {
      accountId: "acc-depreciation-uuid",  // 4200 - Depreciation Expense
      debit: "45000.00",
      credit: "0",
      narration: "Office equipment - 15% SLM",
    },
    {
      accountId: "acc-accum-dep-uuid",     // 1250 - Accumulated Depreciation
      debit: "0",
      credit: "45000.00",
    },
  ],
});

console.log("Created:", entry.entryNumber); // "JE-00013"`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/journal.create",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "entryDate": "2026-03-31T00:00:00.000Z",
        "narration": "Depreciation for FY 2025-26 - Office Equipment",
        "lines": [
            {"accountId": "acc-depreciation-uuid", "debit": "45000.00", "credit": "0"},
            {"accountId": "acc-accum-dep-uuid", "debit": "0", "credit": "45000.00"},
        ],
    }},
)
entry = resp.json()["result"]["data"]["json"]
print("Created:", entry["entryNumber"])`,
      },
      gotchas: [
        "Total debits MUST equal total credits. The API enforces double-entry balancing with a tolerance of 0.01.",
        "All `accountId` values must belong to the current business. Using an account from another business returns BAD_REQUEST.",
        "Entry number is auto-generated (JE-00001, JE-00002, etc.). You cannot set it manually.",
        "Debit and credit amounts must be decimal strings matching the pattern `/^\\d{1,13}(\\.\\d{1,2})?$/`. Max 15 digits total.",
        "Requires `admin` role. Members cannot create journal entries.",
      ],
      relatedEndpoints: ["account-list", "journal-get-by-id"],
    },
    {
      id: "journal-update",
      method: "mutation",
      path: "journal.update",
      title: "Update Journal Entry",
      description: "Update a manual journal entry's date, narration, or lines. Only manually created entries (source=manual) can be updated. Voided entries cannot be updated. When lines are provided, existing lines are deleted and replaced atomically.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Journal entry ID to update" },
        { name: "entryDate", type: "string (ISO 8601)", required: false, description: "Updated entry date" },
        { name: "narration", type: "string", required: false, description: "Updated narration" },
        { name: "lines", type: "array", required: false, description: "Replacement lines (all existing lines are deleted). Same schema as create." },
        { name: "lines[].accountId", type: "string (UUID)", required: true, description: "Chart of Accounts account ID" },
        { name: "lines[].debit", type: "string (decimal)", required: false, description: "Debit amount", default: "0" },
        { name: "lines[].credit", type: "string (decimal)", required: false, description: "Credit amount", default: "0" },
        { name: "lines[].narration", type: "string", required: false, description: "Per-line narration" },
      ],
      output: {
        description: "Updated journal entry (without lines).",
        example: {
          id: "je-uuid-1",
          entryNumber: "JE-00012",
          entryDate: "2026-03-31T00:00:00.000Z",
          narration: "Depreciation for FY 2025-26 - Office Equipment (revised)",
          source: "manual",
          isVoided: false,
          updatedAt: "2026-04-08T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/journal.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "id": "je-uuid-1",
      "narration": "Depreciation for FY 2025-26 - Office Equipment (revised)",
      "lines": [
        { "accountId": "acc-depreciation-uuid", "debit": "50000.00", "credit": "0" },
        { "accountId": "acc-accum-dep-uuid", "debit": "0", "credit": "50000.00" }
      ]
    }
  }'`,
        javascript: `const updated = await trpc.journal.update.mutate({
  id: "je-uuid-1",
  narration: "Depreciation for FY 2025-26 - Office Equipment (revised)",
  lines: [
    { accountId: "acc-depreciation-uuid", debit: "50000.00", credit: "0" },
    { accountId: "acc-accum-dep-uuid", debit: "0", credit: "50000.00" },
  ],
});`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/journal.update",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {
        "id": "je-uuid-1",
        "narration": "Depreciation for FY 2025-26 - Office Equipment (revised)",
        "lines": [
            {"accountId": "acc-depreciation-uuid", "debit": "50000.00", "credit": "0"},
            {"accountId": "acc-accum-dep-uuid", "debit": "0", "credit": "50000.00"},
        ],
    }},
)`,
      },
      gotchas: [
        "Only entries with `source: \"manual\"` can be updated. System-generated entries (from payments, expenses, etc.) return BAD_REQUEST.",
        "Voided entries cannot be updated. The API returns BAD_REQUEST with a clear message.",
        "When `lines` is provided, ALL existing lines are deleted and replaced. This is a full replacement, not a patch. Omit `lines` to update only date/narration.",
        "If providing lines, they must still balance (total debits = total credits).",
      ],
    },
    {
      id: "journal-void",
      method: "mutation",
      path: "journal.void",
      title: "Void Journal Entry",
      description: "Void a journal entry by creating an automatic reversing entry with debits and credits swapped. The original entry is marked `isVoided: true` and linked to the reversing entry via `voidedByEntryId`. The reversing entry gets a new entry number and is dated the same as the original.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Journal entry ID to void" },
      ],
      output: {
        description: "Both the voided original entry and the new reversing entry.",
        example: {
          voidedEntry: {
            id: "je-uuid-1",
            entryNumber: "JE-00012",
            isVoided: true,
            voidedByEntryId: "je-uuid-reversal",
          },
          reversingEntry: {
            id: "je-uuid-reversal",
            entryNumber: "JE-00013",
            entryDate: "2026-03-31T00:00:00.000Z",
            narration: "Void: reversal of JE-00012",
            source: "manual",
            reversesEntryId: "je-uuid-1",
            isVoided: false,
            createdByUserId: "user-uuid",
            createdByName: "Rahul Sharma",
          },
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/journal.void \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"je-uuid-1"}}'`,
        javascript: `const { voidedEntry, reversingEntry } = await trpc.journal.void.mutate({
  id: "je-uuid-1",
});

console.log(\`Voided \${voidedEntry.entryNumber}\`);
console.log(\`Reversal: \${reversingEntry.entryNumber} - \${reversingEntry.narration}\`);`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/journal.void",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "je-uuid-1"}},
)
result = resp.json()["result"]["data"]["json"]
print(f"Voided: {result['voidedEntry']['entryNumber']}")
print(f"Reversal: {result['reversingEntry']['entryNumber']}")`,
      },
      gotchas: [
        "Cannot void an already-voided entry. The API returns BAD_REQUEST.",
        "The reversing entry has debits and credits SWAPPED: original debits become credits and vice versa. This is standard accounting void practice.",
        "The reversing entry is dated the same as the original entry, not the current date. This keeps the reversal in the same accounting period.",
        "The reversing entry narration is auto-generated as \"Void: reversal of {entryNumber}\".",
        "Both the void and the reversal are created in a single PostgreSQL transaction.",
      ],
      relatedEndpoints: ["journal-get-by-id", "journal-delete"],
    },
    {
      id: "journal-delete",
      method: "mutation",
      path: "journal.delete",
      title: "Delete Journal Entry",
      description: "Permanently delete a journal entry and all its lines (via FK cascade). Unlike void, this physically removes the entry from the database with no reversing entry. Use void for audit-trail-preserving reversals.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Journal entry ID to delete" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/journal.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"je-uuid-1"}}'`,
        javascript: `await trpc.journal.delete.mutate({ id: "je-uuid-1" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/journal.delete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "je-uuid-1"}},
)`,
      },
      gotchas: [
        "This is a hard delete. Lines are cascade-deleted by the FK constraint. There is no undo.",
        "Prefer `journal.void` for entries that have already been used in reports, as void preserves the audit trail.",
        "Returns NOT_FOUND if the entry does not exist or belongs to a different business.",
      ],
      relatedEndpoints: ["journal-void"],
    },
    {
      id: "journal-template-list",
      method: "query",
      path: "journal.templateList",
      title: "List Templates",
      description: "List all journal entry templates for the business. Templates store reusable line configurations for recurring entries like monthly depreciation, salary provisions, or closing entries. Supports search by template name.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "search", type: "string", required: false, description: "Search by template name (case-insensitive, max 200 chars)" },
      ],
      output: {
        description: "Array of journal entry templates.",
        example: [
          {
            id: "jt-uuid-1",
            businessId: "biz-uuid",
            name: "Monthly Depreciation - Office Equipment",
            narration: "Depreciation for {month} - Office Equipment @ 15% SLM",
            lines: [
              { accountId: "acc-depreciation-uuid", debit: "3750.00", credit: "0", narration: null },
              { accountId: "acc-accum-dep-uuid", debit: "0", credit: "3750.00", narration: null },
            ],
            createdByUserId: "user-uuid",
            createdAt: "2026-01-15T10:00:00.000Z",
            updatedAt: "2026-01-15T10:00:00.000Z",
          },
          {
            id: "jt-uuid-2",
            businessId: "biz-uuid",
            name: "Salary Provision",
            narration: "Salary provision for {month}",
            lines: [
              { accountId: "acc-salary-uuid", debit: "150000.00", credit: "0", narration: null },
              { accountId: "acc-salary-payable-uuid", debit: "0", credit: "150000.00", narration: null },
            ],
            createdByUserId: "user-uuid",
            createdAt: "2026-02-01T10:00:00.000Z",
            updatedAt: "2026-02-01T10:00:00.000Z",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/journal.templateList" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const templates = await trpc.journal.templateList.query();

templates.forEach(t => {
  const total = t.lines.reduce((s, l) => s + Number(l.debit), 0);
  console.log(\`\${t.name}: \u20B9\${total}\`);
});`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/journal.templateList",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
templates = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Template lines are stored as JSONB. The `lines` array contains accountId, debit, credit, and narration.",
        "Search is case-insensitive and uses ILIKE with wildcards on both sides.",
      ],
    },
    {
      id: "journal-template-create",
      method: "mutation",
      path: "journal.templateCreate",
      title: "Create Template",
      description: "Create a reusable journal entry template. Templates store a set of predefined lines that can be used to quickly create recurring entries. All account IDs are verified to belong to the current business.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "name", type: "string", required: true, description: "Template name, e.g. \"Monthly Depreciation - Office Equipment\"" },
        { name: "narration", type: "string", required: false, description: "Default narration for entries created from this template" },
        { name: "lines", type: "array", required: true, description: "Template line items" },
        { name: "lines[].accountId", type: "string (UUID)", required: true, description: "Chart of Accounts account ID" },
        { name: "lines[].debit", type: "string (decimal)", required: false, description: "Default debit amount", default: "0" },
        { name: "lines[].credit", type: "string (decimal)", required: false, description: "Default credit amount", default: "0" },
        { name: "lines[].narration", type: "string", required: false, description: "Per-line narration" },
      ],
      output: {
        description: "Created template.",
        example: {
          id: "jt-uuid-new",
          businessId: "biz-uuid",
          name: "Monthly Depreciation - Office Equipment",
          narration: "Depreciation for {month} - Office Equipment @ 15% SLM",
          lines: [
            { accountId: "acc-depreciation-uuid", debit: "3750.00", credit: "0", narration: null },
            { accountId: "acc-accum-dep-uuid", debit: "0", credit: "3750.00", narration: null },
          ],
          createdByUserId: "user-uuid",
          createdAt: "2026-04-08T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/journal.templateCreate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "name": "Monthly Depreciation - Office Equipment",
      "narration": "Depreciation for {month} - Office Equipment @ 15% SLM",
      "lines": [
        { "accountId": "acc-depreciation-uuid", "debit": "3750.00", "credit": "0" },
        { "accountId": "acc-accum-dep-uuid", "debit": "0", "credit": "3750.00" }
      ]
    }
  }'`,
        javascript: `const template = await trpc.journal.templateCreate.mutate({
  name: "Monthly Depreciation - Office Equipment",
  narration: "Depreciation for {month} - Office Equipment @ 15% SLM",
  lines: [
    { accountId: "acc-depreciation-uuid", debit: "3750.00", credit: "0" },
    { accountId: "acc-accum-dep-uuid", debit: "0", credit: "3750.00" },
  ],
});

console.log("Template created:", template.id);`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/journal.templateCreate",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "name": "Monthly Depreciation - Office Equipment",
        "narration": "Depreciation for {month} - Office Equipment @ 15% SLM",
        "lines": [
            {"accountId": "acc-depreciation-uuid", "debit": "3750.00", "credit": "0"},
            {"accountId": "acc-accum-dep-uuid", "debit": "0", "credit": "3750.00"},
        ],
    }},
)`,
      },
      gotchas: [
        "Template lines do NOT need to be balanced. You can create a template with placeholder amounts that get adjusted when creating entries from it.",
        "All account IDs must belong to the current business. Invalid IDs return BAD_REQUEST.",
      ],
      relatedEndpoints: ["journal-create-from-template"],
    },
    {
      id: "journal-template-delete",
      method: "mutation",
      path: "journal.templateDelete",
      title: "Delete Template",
      description: "Permanently delete a journal entry template. Existing entries created from this template are not affected.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Template ID to delete" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/journal.templateDelete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"jt-uuid-1"}}'`,
        javascript: `await trpc.journal.templateDelete.mutate({ id: "jt-uuid-1" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/journal.templateDelete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "jt-uuid-1"}},
)`,
      },
      gotchas: [
        "This is a hard delete. There is no soft-delete or undo.",
        "Journal entries previously created from this template are not affected.",
      ],
    },
    {
      id: "journal-create-from-template",
      method: "mutation",
      path: "journal.createFromTemplate",
      title: "Create from Template",
      description: "Create a journal entry from an existing template. Uses the template's lines by default, but you can override with custom lines (e.g. adjusted amounts for a specific month). The entry must be balanced (total debits = total credits).",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "templateId", type: "string (UUID)", required: true, description: "Template to use as the base" },
        { name: "entryDate", type: "string (ISO 8601)", required: true, description: "Date for the new entry" },
        { name: "narration", type: "string", required: false, description: "Override narration (defaults to template narration)" },
        { name: "lines", type: "array", required: false, description: "Override lines with adjusted amounts. If omitted, template lines are used as-is." },
        { name: "lines[].accountId", type: "string (UUID)", required: true, description: "Chart of Accounts account ID" },
        { name: "lines[].debit", type: "string (decimal)", required: false, description: "Debit amount", default: "0" },
        { name: "lines[].credit", type: "string (decimal)", required: false, description: "Credit amount", default: "0" },
        { name: "lines[].narration", type: "string", required: false, description: "Per-line narration" },
      ],
      output: {
        description: "Created journal entry.",
        example: {
          id: "je-uuid-from-tmpl",
          businessId: "biz-uuid",
          entryNumber: "JE-00014",
          entryDate: "2026-04-30T00:00:00.000Z",
          narration: "Depreciation for April 2026 - Office Equipment @ 15% SLM",
          source: "manual",
          isVoided: false,
          createdByUserId: "user-uuid",
          createdByName: "Rahul Sharma",
          createdAt: "2026-04-30T18:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/journal.createFromTemplate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "templateId": "jt-uuid-1",
      "entryDate": "2026-04-30T00:00:00.000Z",
      "narration": "Depreciation for April 2026 - Office Equipment @ 15% SLM"
    }
  }'`,
        javascript: `// Use template lines as-is
const entry = await trpc.journal.createFromTemplate.mutate({
  templateId: "jt-uuid-1",
  entryDate: "2026-04-30T00:00:00.000Z",
  narration: "Depreciation for April 2026 - Office Equipment @ 15% SLM",
});

// Or override with adjusted amounts
const adjustedEntry = await trpc.journal.createFromTemplate.mutate({
  templateId: "jt-uuid-1",
  entryDate: "2026-04-30T00:00:00.000Z",
  lines: [
    { accountId: "acc-depreciation-uuid", debit: "4000.00", credit: "0" },
    { accountId: "acc-accum-dep-uuid", debit: "0", credit: "4000.00" },
  ],
});`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/journal.createFromTemplate",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "templateId": "jt-uuid-1",
        "entryDate": "2026-04-30T00:00:00.000Z",
        "narration": "Depreciation for April 2026 - Office Equipment @ 15% SLM",
    }},
)
entry = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "If `lines` is omitted, the template's lines are used verbatim. If provided, they completely replace the template lines.",
        "Balance is enforced: total debits must equal total credits within 0.01. If the template lines are unbalanced and no override is provided, creation fails.",
        "If `narration` is omitted, the template's narration is used. If the template has no narration, the entry narration is null.",
        "The created entry has `source: \"manual\"` regardless of how it was created.",
        "All account IDs (from template or overridden lines) are verified to belong to the current business.",
      ],
      relatedEndpoints: ["journal-template-list", "journal-create"],
    },
  ],
};
