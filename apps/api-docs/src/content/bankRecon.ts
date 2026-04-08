import type { EndpointGroup } from "./types";

export const bankReconEndpoints: EndpointGroup = {
  id: "bank-recon",
  title: "Bank Reconciliation",
  description: "Import bank statements and reconcile against your books. Pre-built templates for 10 Indian banks (SBI, HDFC, ICICI, Axis, Kotak, PNB, BOB, Union, IDBI, IndusInd). 4-tier auto-matching: exact, strong, narration parse, partial. Auto-categorization rules for recurring entries.",
  endpoints: [
    {
      id: "bank-recon-upload",
      method: "mutation",
      path: "bankRecon.uploadCSV",
      title: "Upload CSV",
      description: "Step 1 of reconciliation: upload a bank statement CSV. The server parses the first 5 rows for preview, auto-detects column mapping using header heuristics, and attempts to match a pre-built bank template (SBI, HDFC, ICICI, etc.) based on IFSC prefix and header patterns. Creates an import record in `pending` status.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "bankAccountId", type: "string (UUID)", required: true, description: "Bank account this statement belongs to" },
        { name: "fileName", type: "string", required: true, description: "Original file name for display, e.g. \"HDFC_April_2026.csv\"" },
        { name: "csvContent", type: "string", required: true, description: "Raw CSV content as a string (max 10 MB)" },
      ],
      output: {
        description: "Import ID, detected column mapping, preview rows, and optional template detection result.",
        example: {
          importId: "imp-uuid",
          headers: ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
          previewRows: [
            ["05/04/2026", "NEFT-CR-SBIN0005432-GUPTA ENTERPRISES", "N078263548", "05/04/2026", "", "26250.00", "487350.00"],
            ["04/04/2026", "ATM-CASH/WDL-HDFC0001234", "S2837465", "04/04/2026", "10000.00", "", "461100.00"],
          ],
          detectedMapping: {
            date: 0,
            narration: 1,
            reference: 2,
            debit: 4,
            credit: 5,
            balance: 6,
            dateFormat: "DD/MM/YYYY",
          },
          detectedTemplate: {
            templateId: "tmpl-hdfc-v2-uuid",
            bankSlug: "hdfc",
            bankDisplayName: "HDFC Bank",
            version: 2,
            confidence: 0.95,
          },
          detectionWarning: null,
          totalRows: 87,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.uploadCSV \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "bankAccountId": "ba-hdfc-uuid",
      "fileName": "HDFC_April_2026.csv",
      "csvContent": "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\\n05/04/2026,NEFT-CR-SBIN0005432-GUPTA ENTERPRISES,N078263548,05/04/2026,,26250.00,487350.00"
    }
  }'`,
        javascript: `// Read CSV file and upload
const csvContent = await file.text(); // from File input

const result = await trpc.bankRecon.uploadCSV.mutate({
  bankAccountId: "ba-hdfc-uuid",
  fileName: file.name,
  csvContent,
});

console.log(\`Detected \${result.totalRows} rows\`);
console.log("Template:", result.detectedTemplate?.bankDisplayName ?? "None");
// Show result.previewRows in a preview table
// Let user confirm/adjust result.detectedMapping`,
        python: `with open("HDFC_April_2026.csv") as f:
    csv_content = f.read()

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.uploadCSV",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "bankAccountId": "ba-hdfc-uuid",
        "fileName": "HDFC_April_2026.csv",
        "csvContent": csv_content,
    }},
)
result = resp.json()["result"]["data"]["json"]
print(f"Detected {result['totalRows']} rows, template: {result.get('detectedTemplate')}")`,
      },
      gotchas: [
        "CSV content is sent as a string in the JSON body, not as a file upload. Max size is 10 MB.",
        "The first row is treated as headers. A CSV with fewer than 2 rows (header + 1 data row) returns BAD_REQUEST.",
        "Bank templates are lazily seeded on first upload for each business. The first upload may be slightly slower.",
        "Template detection uses IFSC prefix and header patterns. If the bank account's IFSC does not match the CSV format, a `detectionWarning` is returned.",
        "The import is created in `pending` status. You must call `bankRecon.confirmMapping` to proceed.",
      ],
      relatedEndpoints: ["bank-recon-confirm-mapping"],
    },
    {
      id: "bank-recon-confirm-mapping",
      method: "mutation",
      path: "bankRecon.confirmMapping",
      title: "Confirm Mapping",
      description: "Step 2 of reconciliation: confirm column mapping and trigger full parsing + auto-matching. Parses all CSV rows, runs the 4-tier matching engine (exact amount+date, strong reference match, narration parse, partial), applies categorization rules, and inserts all statement lines. Updates import status to `review`.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "importId", type: "string (UUID)", required: true, description: "Import ID from the upload step" },
        { name: "columnMapping", type: "object", required: true, description: "Column mapping: { date, narration, debit, credit, amount, type, reference, balance, dateFormat, skipRows, amountSignConvention }" },
        { name: "columnMapping.date", type: "number", required: true, description: "Column index for transaction date" },
        { name: "columnMapping.narration", type: "number", required: true, description: "Column index for narration/description" },
        { name: "columnMapping.debit", type: "number", required: false, description: "Column index for debit amount (mutually exclusive with `amount`)" },
        { name: "columnMapping.credit", type: "number", required: false, description: "Column index for credit amount (mutually exclusive with `amount`)" },
        { name: "columnMapping.amount", type: "number", required: false, description: "Single amount column (use with `type` column or `amountSignConvention`)" },
        { name: "columnMapping.reference", type: "number", required: false, description: "Column index for reference/cheque number" },
        { name: "columnMapping.balance", type: "number", required: false, description: "Column index for closing/running balance" },
        { name: "columnMapping.dateFormat", type: "string", required: false, description: "Date format string, e.g. \"DD/MM/YYYY\", \"MM/DD/YYYY\", \"YYYY-MM-DD\"" },
        { name: "columnMapping.skipRows", type: "number", required: false, description: "Number of data rows to skip after header (for bank-specific extra header rows)" },
        { name: "csvContent", type: "string", required: true, description: "Same CSV content from step 1 (max 10 MB)" },
        { name: "templateId", type: "string (UUID)", required: false, description: "Template to apply preprocessing rules from" },
      ],
      output: {
        description: "Matching summary: total, matched, and unmatched line counts.",
        example: {
          importId: "imp-uuid",
          totalLines: 87,
          matchedLines: 62,
          unmatchedLines: 25,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.confirmMapping \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "importId": "imp-uuid",
      "columnMapping": {
        "date": 0,
        "narration": 1,
        "reference": 2,
        "debit": 4,
        "credit": 5,
        "balance": 6,
        "dateFormat": "DD/MM/YYYY"
      },
      "csvContent": "...full CSV content...",
      "templateId": "tmpl-hdfc-v2-uuid"
    }
  }'`,
        javascript: `const result = await trpc.bankRecon.confirmMapping.mutate({
  importId: uploadResult.importId,
  columnMapping: uploadResult.detectedMapping, // or user-adjusted mapping
  csvContent: originalCsvContent,
  templateId: uploadResult.detectedTemplate?.templateId,
});

console.log(\`Matched: \${result.matchedLines}/\${result.totalLines}\`);
console.log(\`Unmatched: \${result.unmatchedLines} lines need review\`);`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.confirmMapping",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "importId": "imp-uuid",
        "columnMapping": {
            "date": 0,
            "narration": 1,
            "reference": 2,
            "debit": 4,
            "credit": 5,
            "balance": 6,
            "dateFormat": "DD/MM/YYYY",
        },
        "csvContent": csv_content,
        "templateId": "tmpl-hdfc-v2-uuid",
    }},
)
result = resp.json()["result"]["data"]["json"]
print(f"Matched: {result['matchedLines']}/{result['totalLines']}")`,
      },
      gotchas: [
        "You must send the same `csvContent` again. The server does not store raw CSV data between steps (only parsed lines).",
        "Re-calling confirmMapping on the same import replaces all existing lines (delete + re-insert). Safe to retry if mapping was wrong.",
        "Only imports in `pending` or `mapped` status can be confirmed. Once in `review` you can still re-confirm to re-run matching.",
        "Auto-matching looks at payments, expenses, and bank transactions within +/- 7 days of the statement date range.",
        "Lines are inserted in batches of 500 to avoid PostgreSQL parameter limits on large statements.",
        "If a template is provided, its `preprocessRules` (extra header rows, subtotal skip, amount parsing mode) are applied before column mapping.",
      ],
      relatedEndpoints: ["bank-recon-upload", "bank-recon-lines"],
    },
    {
      id: "bank-recon-import-list",
      method: "query",
      path: "bankRecon.importList",
      title: "List Imports",
      description: "Paginated list of all bank statement imports for the business. Optionally filter by bank account. Shows import status, match counts, and date range.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "bankAccountId", type: "string (UUID)", required: false, description: "Filter imports for a specific bank account" },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1-100)", default: "20" },
      ],
      output: {
        description: "Paginated list of import records.",
        example: {
          data: [
            {
              id: "imp-uuid",
              businessId: "biz-uuid",
              bankAccountId: "ba-hdfc-uuid",
              fileName: "HDFC_April_2026.csv",
              status: "review",
              totalLines: 87,
              matchedLines: 62,
              unmatchedLines: 25,
              statementStartDate: "2026-04-01T00:00:00.000Z",
              statementEndDate: "2026-04-30T00:00:00.000Z",
              closingBalance: "487350.00",
              createdByUserId: "user-uuid",
              createdAt: "2026-04-08T10:00:00.000Z",
            },
          ],
          total: 5,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/bankRecon.importList?input=%7B%22json%22%3A%7B%22bankAccountId%22%3A%22ba-hdfc-uuid%22%2C%22page%22%3A1%2C%22limit%22%3A20%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.bankRecon.importList.query({
  bankAccountId: "ba-hdfc-uuid",
  page: 1,
  limit: 20,
});

data.forEach(imp => {
  const pct = Math.round((imp.matchedLines / imp.totalLines) * 100);
  console.log(\`\${imp.fileName}: \${pct}% matched (\${imp.status})\`);
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {
    "bankAccountId": "ba-hdfc-uuid", "page": 1, "limit": 20
}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/bankRecon.importList?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
result = resp.json()["result"]["data"]["json"]`,
      },
    },
    {
      id: "bank-recon-import-detail",
      method: "query",
      path: "bankRecon.importDetail",
      title: "Get Import Detail",
      description: "Fetch a single import record with full metadata: status, match counts, date range, closing balance, template used, and column mapping.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "importId", type: "string (UUID)", required: true, description: "Import ID" },
      ],
      output: {
        description: "Full import record.",
        example: {
          id: "imp-uuid",
          businessId: "biz-uuid",
          bankAccountId: "ba-hdfc-uuid",
          fileName: "HDFC_April_2026.csv",
          status: "review",
          totalLines: 87,
          matchedLines: 62,
          unmatchedLines: 25,
          statementStartDate: "2026-04-01T00:00:00.000Z",
          statementEndDate: "2026-04-30T00:00:00.000Z",
          closingBalance: "487350.00",
          columnMapping: { date: 0, narration: 1, debit: 4, credit: 5, balance: 6, dateFormat: "DD/MM/YYYY" },
          templateId: "tmpl-hdfc-v2-uuid",
          templateVersion: 2,
          createdByUserId: "user-uuid",
          createdAt: "2026-04-08T10:00:00.000Z",
          updatedAt: "2026-04-08T10:05:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/bankRecon.importDetail?input=%7B%22json%22%3A%7B%22importId%22%3A%22imp-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const imp = await trpc.bankRecon.importDetail.query({
  importId: "imp-uuid",
});

console.log(\`\${imp.fileName}: \${imp.status}\`);
console.log(\`Period: \${imp.statementStartDate} to \${imp.statementEndDate}\`);
console.log(\`Closing balance: \u20B9\${imp.closingBalance}\`);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"importId": "imp-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/bankRecon.importDetail?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
imp = resp.json()["result"]["data"]["json"]`,
      },
    },
    {
      id: "bank-recon-lines",
      method: "query",
      path: "bankRecon.lines",
      title: "List Statement Lines",
      description: "Paginated list of parsed statement lines for a specific import. Supports filtering by match status to show only unmatched, auto-matched, manually matched, created, or ignored lines.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "importId", type: "string (UUID)", required: true, description: "Import ID" },
        { name: "status", type: "enum", required: false, description: "Filter by match status", enumValues: ["auto_matched", "manual_matched", "unmatched", "created", "ignored"] },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1-100)", default: "20" },
      ],
      output: {
        description: "Paginated statement lines with match metadata.",
        example: {
          data: [
            {
              id: "sl-uuid-1",
              importId: "imp-uuid",
              businessId: "biz-uuid",
              lineNumber: 1,
              transactionDate: "2026-04-05T00:00:00.000Z",
              narration: "NEFT-CR-SBIN0005432-GUPTA ENTERPRISES",
              debit: null,
              credit: "26250.00",
              balance: "487350.00",
              referenceNumber: "N078263548",
              matchStatus: "auto_matched",
              matchConfidence: "0.95",
              matchedPaymentId: "pay-uuid",
              matchedExpenseId: null,
              matchedBankTransactionId: null,
              autoCategory: null,
            },
            {
              id: "sl-uuid-2",
              importId: "imp-uuid",
              businessId: "biz-uuid",
              lineNumber: 2,
              transactionDate: "2026-04-04T00:00:00.000Z",
              narration: "ATM-CASH/WDL-HDFC0001234",
              debit: "10000.00",
              credit: null,
              balance: "461100.00",
              referenceNumber: "S2837465",
              matchStatus: "unmatched",
              matchConfidence: null,
              matchedPaymentId: null,
              matchedExpenseId: null,
              matchedBankTransactionId: null,
              autoCategory: "Cash Withdrawal",
            },
          ],
          total: 87,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/bankRecon.lines?input=%7B%22json%22%3A%7B%22importId%22%3A%22imp-uuid%22%2C%22status%22%3A%22unmatched%22%2C%22page%22%3A1%2C%22limit%22%3A50%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `// Show only unmatched lines for review
const { data: unmatchedLines, total } = await trpc.bankRecon.lines.query({
  importId: "imp-uuid",
  status: "unmatched",
  page: 1,
  limit: 50,
});

unmatchedLines.forEach(line => {
  const amount = line.debit ?? line.credit;
  const dir = line.debit ? "DR" : "CR";
  console.log(\`\${line.narration} | \u20B9\${amount} \${dir} | \${line.autoCategory ?? "Uncategorized"}\`);
});`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {
    "importId": "imp-uuid", "status": "unmatched", "page": 1, "limit": 50
}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/bankRecon.lines?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Lines are ordered by `lineNumber` (original CSV row order), not by date.",
        "The `autoCategory` field is populated by categorization rules during import. It is a suggestion, not a confirmed match.",
        "Monetary fields (`debit`, `credit`, `balance`) can be `null`. Debit lines have `credit: null` and vice versa.",
      ],
      relatedEndpoints: ["bank-recon-confirm-match", "bank-recon-manual-match", "bank-recon-create-expense", "bank-recon-ignore-line"],
    },
    {
      id: "bank-recon-confirm-match",
      method: "mutation",
      path: "bankRecon.confirmMatch",
      title: "Confirm Auto-Match",
      description: "Promote an auto-matched statement line to `manual_matched` status, confirming the system's suggested match. Updates the import's match/unmatched counts.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "lineId", type: "string (UUID)", required: true, description: "Statement line ID to confirm" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.confirmMatch \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"lineId":"sl-uuid-1"}}'`,
        javascript: `await trpc.bankRecon.confirmMatch.mutate({ lineId: "sl-uuid-1" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.confirmMatch",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"lineId": "sl-uuid-1"}},
)`,
      },
      gotchas: [
        "Only works on lines with `matchStatus: \"auto_matched\"`. Any other status returns BAD_REQUEST.",
        "The import's `matchedLines` and `unmatchedLines` counts are automatically recalculated after confirmation.",
      ],
    },
    {
      id: "bank-recon-manual-match",
      method: "mutation",
      path: "bankRecon.manualMatch",
      title: "Manual Match",
      description: "Manually link an unmatched statement line to a specific payment, expense, or bank transaction. Exactly one of `paymentId`, `expenseId`, or `bankTransactionId` must be provided.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "lineId", type: "string (UUID)", required: true, description: "Statement line ID to match" },
        { name: "paymentId", type: "string (UUID)", required: false, description: "Payment to match against (provide exactly one)" },
        { name: "expenseId", type: "string (UUID)", required: false, description: "Expense to match against (provide exactly one)" },
        { name: "bankTransactionId", type: "string (UUID)", required: false, description: "Bank transaction to match against (provide exactly one)" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.manualMatch \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "lineId": "sl-uuid-2",
      "paymentId": "pay-uuid-match"
    }
  }'`,
        javascript: `// Match a statement line to a payment
await trpc.bankRecon.manualMatch.mutate({
  lineId: "sl-uuid-2",
  paymentId: "pay-uuid-match",
});

// Or match to an expense
await trpc.bankRecon.manualMatch.mutate({
  lineId: "sl-uuid-3",
  expenseId: "exp-uuid-match",
});`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.manualMatch",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"lineId": "sl-uuid-2", "paymentId": "pay-uuid-match"}},
)`,
      },
      gotchas: [
        "You must provide exactly one of `paymentId`, `expenseId`, or `bankTransactionId`. Providing zero or more than one returns a validation error.",
        "Sets `matchConfidence` to 1 (100%) since the user explicitly confirmed the match.",
        "The line status becomes `manual_matched`. Use `bankRecon.unmatch` to undo.",
      ],
      relatedEndpoints: ["bank-recon-unmatch"],
    },
    {
      id: "bank-recon-unmatch",
      method: "mutation",
      path: "bankRecon.unmatch",
      title: "Unmatch Line",
      description: "Undo a match (auto or manual) and revert the statement line back to `unmatched` status. Clears all match references and confidence.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "lineId", type: "string (UUID)", required: true, description: "Statement line ID to unmatch" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.unmatch \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"lineId":"sl-uuid-1"}}'`,
        javascript: `await trpc.bankRecon.unmatch.mutate({ lineId: "sl-uuid-1" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.unmatch",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"lineId": "sl-uuid-1"}},
)`,
      },
      gotchas: [
        "Only works on lines with `matchStatus` of `auto_matched` or `manual_matched`. Lines in other states (unmatched, created, ignored) return BAD_REQUEST.",
        "Clears `matchedPaymentId`, `matchedExpenseId`, `matchedBankTransactionId`, and `matchConfidence`. The `autoCategory` suggestion is preserved.",
      ],
    },
    {
      id: "bank-recon-create-expense",
      method: "mutation",
      path: "bankRecon.createExpense",
      title: "Create Expense from Line",
      description: "Create a new expense record from an unmatched debit statement line and automatically link it. The expense date defaults to the statement line's transaction date if not provided. Sets the line status to `created`.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "lineId", type: "string (UUID)", required: true, description: "Unmatched statement line ID" },
        { name: "expense", type: "object", required: true, description: "Expense details (same schema as expense.create)" },
        { name: "expense.amount", type: "string (decimal)", required: true, description: "Expense amount, e.g. \"10000.00\"" },
        { name: "expense.category", type: "string", required: true, description: "Expense category, e.g. \"Cash Withdrawal\", \"Bank Charges\"" },
        { name: "expense.description", type: "string", required: false, description: "Description of the expense" },
        { name: "expense.expenseDate", type: "string (ISO 8601)", required: false, description: "Defaults to the statement line's transaction date" },
      ],
      output: {
        description: "The created expense record.",
        example: {
          id: "exp-uuid-new",
          businessId: "biz-uuid",
          amount: "10000.00",
          category: "Cash Withdrawal",
          description: "ATM withdrawal - HDFC Connaught Place",
          expenseDate: "2026-04-04T00:00:00.000Z",
          createdByUserId: "user-uuid",
          createdByName: "Rahul Sharma",
          createdAt: "2026-04-08T11:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.createExpense \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "lineId": "sl-uuid-2",
      "expense": {
        "amount": "10000.00",
        "category": "Cash Withdrawal",
        "description": "ATM withdrawal - HDFC Connaught Place"
      }
    }
  }'`,
        javascript: `const expense = await trpc.bankRecon.createExpense.mutate({
  lineId: "sl-uuid-2",
  expense: {
    amount: "10000.00",
    category: "Cash Withdrawal",
    description: "ATM withdrawal - HDFC Connaught Place",
  },
});

console.log("Created expense:", expense.id);`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.createExpense",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "lineId": "sl-uuid-2",
        "expense": {
            "amount": "10000.00",
            "category": "Cash Withdrawal",
            "description": "ATM withdrawal - HDFC Connaught Place",
        },
    }},
)
expense = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Only works on lines with `matchStatus: \"unmatched\"`. Already matched or ignored lines return BAD_REQUEST.",
        "The statement line status changes to `created` (not `manual_matched`), indicating a new record was created from it.",
        "The expense and the line link are created atomically in a single transaction.",
        "If you omit `expenseDate`, it defaults to the statement line's `transactionDate`, not the current date.",
      ],
      relatedEndpoints: ["bank-recon-lines"],
    },
    {
      id: "bank-recon-ignore-line",
      method: "mutation",
      path: "bankRecon.ignoreLine",
      title: "Ignore Line",
      description: "Mark a statement line as ignored, indicating no matching is needed. Useful for ATM withdrawals, internal transfers, or other entries that do not need reconciliation. Updates import counts.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "lineId", type: "string (UUID)", required: true, description: "Statement line ID to ignore" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.ignoreLine \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"lineId":"sl-uuid-3"}}'`,
        javascript: `await trpc.bankRecon.ignoreLine.mutate({ lineId: "sl-uuid-3" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.ignoreLine",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"lineId": "sl-uuid-3"}},
)`,
      },
      gotchas: [
        "Ignored lines are counted as \"resolved\" in import stats (neither matched nor unmatched). They reduce the unmatched count.",
        "To un-ignore a line, there is no dedicated endpoint. The line status is set directly and cannot be easily reverted.",
      ],
    },
    {
      id: "bank-recon-summary",
      method: "query",
      path: "bankRecon.summary",
      title: "Reconciliation Summary",
      description: "Bank Reconciliation Statement (BRS): compare the bank statement closing balance with the book balance (currentBalance from bank_accounts). Shows the difference, unmatched debits, and unmatched credits. Uses the latest import for the account unless a specific import ID is provided.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "bankAccountId", type: "string (UUID)", required: true, description: "Bank account to reconcile" },
        { name: "importId", type: "string (UUID)", required: false, description: "Specific import to use (defaults to latest)" },
      ],
      output: {
        description: "Bank Reconciliation Statement with balance comparison.",
        example: {
          accountName: "HDFC Current Account",
          bankName: "HDFC Bank",
          bookBalance: "475000.00",
          statementBalance: "487350.00",
          difference: "12350.00",
          unmatchedDebits: "5000.00",
          unmatchedCredits: "17350.00",
          import: {
            id: "imp-uuid",
            fileName: "HDFC_April_2026.csv",
            status: "review",
            totalLines: 87,
            matchedLines: 62,
            unmatchedLines: 25,
            closingBalance: "487350.00",
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/bankRecon.summary?input=%7B%22json%22%3A%7B%22bankAccountId%22%3A%22ba-hdfc-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const brs = await trpc.bankRecon.summary.query({
  bankAccountId: "ba-hdfc-uuid",
});

console.log(\`Book balance:      \u20B9\${brs.bookBalance}\`);
console.log(\`Statement balance: \u20B9\${brs.statementBalance}\`);
console.log(\`Difference:        \u20B9\${brs.difference}\`);

if (brs.difference !== "0.00") {
  console.log(\`Unmatched debits:  \u20B9\${brs.unmatchedDebits}\`);
  console.log(\`Unmatched credits: \u20B9\${brs.unmatchedCredits}\`);
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"bankAccountId": "ba-hdfc-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/bankRecon.summary?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
brs = resp.json()["result"]["data"]["json"]
print(f"Difference: {brs['difference']}")`,
      },
      gotchas: [
        "`difference` is computed as `statementBalance - bookBalance`. A positive difference means the bank shows more money than your books.",
        "If no import exists for the account, `statementBalance` and `difference` are `null`. The `import` field is also `null`.",
        "`bookBalance` comes from the bank account's `currentBalance` field (real-time), not from a snapshot at import time.",
      ],
    },
    {
      id: "bank-recon-template-list",
      method: "query",
      path: "bankRecon.templateList",
      title: "List Templates",
      description: "List all bank statement templates for the business, including seeded templates (SBI, HDFC, ICICI, Axis, Kotak, PNB, BOB, Union, IDBI, IndusInd) and custom/forked ones. Supports search by bank display name.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "search", type: "string", required: false, description: "Search by bank display name (case-insensitive)" },
      ],
      output: {
        description: "Array of template summaries.",
        example: [
          {
            id: "tmpl-hdfc-v2-uuid",
            bankSlug: "hdfc",
            bankDisplayName: "HDFC Bank",
            version: 2,
            label: "HDFC Net Banking CSV (2024+)",
            isSeeded: true,
            forkedFromId: null,
            fileFormat: "csv",
            isActive: true,
            createdAt: "2026-01-15T10:00:00.000Z",
          },
          {
            id: "tmpl-sbi-v1-uuid",
            bankSlug: "sbi",
            bankDisplayName: "State Bank of India",
            version: 1,
            label: "SBI Internet Banking CSV",
            isSeeded: true,
            forkedFromId: null,
            fileFormat: "csv",
            isActive: true,
            createdAt: "2026-01-15T10:00:00.000Z",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/bankRecon.templateList" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const templates = await trpc.bankRecon.templateList.query();

const seeded = templates.filter(t => t.isSeeded);
const custom = templates.filter(t => !t.isSeeded);
console.log(\`\${seeded.length} built-in, \${custom.length} custom templates\`);`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/bankRecon.templateList",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
templates = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Templates are lazily seeded on first CSV upload. If no upload has happened yet, this list may be empty.",
        "Results are ordered by `bankDisplayName` (ascending), then by `version` (descending). The newest version of each bank appears first.",
      ],
    },
    {
      id: "bank-recon-template-create",
      method: "mutation",
      path: "bankRecon.templateCreate",
      title: "Create Template",
      description: "Create a custom bank statement template for a bank not in the pre-built list (e.g. a cooperative bank or NBFC). Define column mapping, preprocessing rules, and detection rules.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "bankDisplayName", type: "string", required: true, description: "Human-readable bank name, e.g. \"Saraswat Co-op Bank\"" },
        { name: "bankSlug", type: "string", required: false, description: "URL-safe slug. Auto-generated as `custom_{uuid}` if omitted." },
        { name: "columnMapping", type: "object", required: true, description: "Column mapping definition (same as confirmMapping)" },
        { name: "preprocessRules", type: "object", required: false, description: "Pre-processing: { extraHeaderRows, skipRowPatterns, amountParsingMode, skipSubtotalRows, encoding }" },
        { name: "preprocessRules.amountParsingMode", type: "enum", required: false, description: "How amounts are formatted in the CSV", enumValues: ["standard", "dr_cr_suffix", "parentheses_negative", "signed"] },
        { name: "detectionRules", type: "object", required: false, description: "Auto-detection: { headerPatterns, columnCount, firstRowPatterns, ifscPrefix }" },
        { name: "label", type: "string", required: false, description: "Description label, e.g. \"Saraswat Net Banking CSV\"" },
        { name: "fileFormat", type: "enum", required: false, description: "Expected file format", default: "csv", enumValues: ["csv", "xlsx", "pdf"] },
      ],
      output: {
        description: "Created template.",
        example: {
          id: "tmpl-custom-uuid",
          businessId: "biz-uuid",
          bankSlug: "saraswat",
          bankDisplayName: "Saraswat Co-op Bank",
          version: 1,
          label: "Saraswat Net Banking CSV",
          isSeeded: false,
          forkedFromId: null,
          fileFormat: "csv",
          isActive: true,
          createdAt: "2026-04-08T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.templateCreate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "bankSlug": "saraswat",
      "bankDisplayName": "Saraswat Co-op Bank",
      "columnMapping": {
        "date": 0,
        "narration": 2,
        "debit": 3,
        "credit": 4,
        "balance": 5,
        "dateFormat": "DD-MM-YYYY"
      },
      "label": "Saraswat Net Banking CSV"
    }
  }'`,
        javascript: `const template = await trpc.bankRecon.templateCreate.mutate({
  bankSlug: "saraswat",
  bankDisplayName: "Saraswat Co-op Bank",
  columnMapping: {
    date: 0,
    narration: 2,
    debit: 3,
    credit: 4,
    balance: 5,
    dateFormat: "DD-MM-YYYY",
  },
  label: "Saraswat Net Banking CSV",
});`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.templateCreate",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "bankSlug": "saraswat",
        "bankDisplayName": "Saraswat Co-op Bank",
        "columnMapping": {
            "date": 0, "narration": 2, "debit": 3,
            "credit": 4, "balance": 5, "dateFormat": "DD-MM-YYYY",
        },
        "label": "Saraswat Net Banking CSV",
    }},
)`,
      },
    },
    {
      id: "bank-recon-template-fork",
      method: "mutation",
      path: "bankRecon.templateFork",
      title: "Fork Template",
      description: "Fork a seeded or existing template into an editable copy. Useful when a bank changes their CSV format and you need to adjust the column mapping. The forked copy gets the next version number for that bank slug.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "templateId", type: "string (UUID)", required: true, description: "Source template ID to fork" },
        { name: "label", type: "string", required: false, description: "Custom label for the forked copy" },
      ],
      output: {
        description: "The forked template with incremented version number.",
        example: {
          id: "tmpl-forked-uuid",
          bankSlug: "hdfc",
          bankDisplayName: "HDFC Bank",
          version: 3,
          label: "HDFC - Adjusted for 2026 format",
          isSeeded: false,
          forkedFromId: "tmpl-hdfc-v2-uuid",
          fileFormat: "csv",
          isActive: true,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.templateFork \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "templateId": "tmpl-hdfc-v2-uuid",
      "label": "HDFC - Adjusted for 2026 format"
    }
  }'`,
        javascript: `const forked = await trpc.bankRecon.templateFork.mutate({
  templateId: "tmpl-hdfc-v2-uuid",
  label: "HDFC - Adjusted for 2026 format",
});

console.log(\`Forked as v\${forked.version}\`);
// Now update the forked template with templateUpdate`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.templateFork",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "templateId": "tmpl-hdfc-v2-uuid",
        "label": "HDFC - Adjusted for 2026 format",
    }},
)`,
      },
      gotchas: [
        "Seeded templates cannot be edited directly. You must fork them first.",
        "The version number is auto-incremented based on the highest existing version for that `bankSlug`.",
        "The forked copy inherits all settings (columnMapping, preprocessRules, detectionRules) from the source.",
      ],
      relatedEndpoints: ["bank-recon-template-update"],
    },
    {
      id: "bank-recon-template-update",
      method: "mutation",
      path: "bankRecon.templateUpdate",
      title: "Update Template",
      description: "Update a custom or forked template. Seeded templates cannot be modified directly -- fork them first. You can update column mapping, preprocessing rules, detection rules, label, and active status.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Template ID to update" },
        { name: "columnMapping", type: "object", required: false, description: "Updated column mapping" },
        { name: "preprocessRules", type: "object", required: false, description: "Updated preprocessing rules" },
        { name: "detectionRules", type: "object", required: false, description: "Updated auto-detection rules" },
        { name: "label", type: "string", required: false, description: "Updated label" },
        { name: "isActive", type: "boolean", required: false, description: "Enable or disable the template" },
      ],
      output: {
        description: "Updated template.",
        example: {
          id: "tmpl-forked-uuid",
          bankSlug: "hdfc",
          bankDisplayName: "HDFC Bank",
          version: 3,
          label: "HDFC - Fixed date column",
          isSeeded: false,
          isActive: true,
          updatedAt: "2026-04-08T12:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.templateUpdate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "id": "tmpl-forked-uuid",
      "columnMapping": { "date": 1, "narration": 2, "debit": 3, "credit": 4, "balance": 5, "dateFormat": "YYYY-MM-DD" },
      "label": "HDFC - Fixed date column"
    }
  }'`,
        javascript: `const updated = await trpc.bankRecon.templateUpdate.mutate({
  id: "tmpl-forked-uuid",
  columnMapping: {
    date: 1, narration: 2, debit: 3, credit: 4, balance: 5,
    dateFormat: "YYYY-MM-DD",
  },
  label: "HDFC - Fixed date column",
});`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.templateUpdate",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "id": "tmpl-forked-uuid",
        "columnMapping": {
            "date": 1, "narration": 2, "debit": 3,
            "credit": 4, "balance": 5, "dateFormat": "YYYY-MM-DD",
        },
        "label": "HDFC - Fixed date column",
    }},
)`,
      },
      gotchas: [
        "Returns FORBIDDEN if you try to update a seeded template. Fork it first with `bankRecon.templateFork`.",
        "Only provided fields are updated. Omitted fields retain their current values.",
      ],
      relatedEndpoints: ["bank-recon-template-fork"],
    },
    {
      id: "bank-recon-template-delete",
      method: "mutation",
      path: "bankRecon.templateDelete",
      title: "Delete Template",
      description: "Delete a custom or forked template. Seeded (built-in) templates cannot be deleted.",
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
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.templateDelete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"tmpl-forked-uuid"}}'`,
        javascript: `await trpc.bankRecon.templateDelete.mutate({ id: "tmpl-forked-uuid" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.templateDelete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "tmpl-forked-uuid"}},
)`,
      },
      gotchas: [
        "Returns FORBIDDEN for seeded templates. They are read-only and cannot be deleted.",
        "This is a hard delete. Existing imports that used this template are not affected (they store templateId and templateVersion as snapshots).",
      ],
    },
    {
      id: "bank-recon-rule-list",
      method: "query",
      path: "bankRecon.ruleList",
      title: "List Categorization Rules",
      description: "List all auto-categorization rules for the business. Rules are applied during CSV import to auto-categorize statement lines based on narration or reference patterns. Optionally filter by bank account (includes global rules with no bankAccountId).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "bankAccountId", type: "string (UUID)", required: false, description: "Filter rules for a specific account (also includes global rules)" },
      ],
      output: {
        description: "Array of categorization rules, ordered by priority (highest first).",
        example: [
          {
            id: "rule-uuid-1",
            businessId: "biz-uuid",
            bankAccountId: null,
            matchField: "narration",
            matchType: "contains",
            matchValue: "NEFT-CR",
            action: "tag_party",
            expenseCategory: null,
            partyId: null,
            priority: 100,
            isActive: true,
            createdAt: "2026-03-01T10:00:00.000Z",
          },
          {
            id: "rule-uuid-2",
            businessId: "biz-uuid",
            bankAccountId: "ba-hdfc-uuid",
            matchField: "narration",
            matchType: "contains",
            matchValue: "ATM-CASH/WDL",
            action: "create_expense",
            expenseCategory: "Cash Withdrawal",
            partyId: null,
            priority: 50,
            isActive: true,
            createdAt: "2026-03-01T10:00:00.000Z",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/bankRecon.ruleList" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const rules = await trpc.bankRecon.ruleList.query();

rules.forEach(rule => {
  console.log(\`\${rule.matchField} \${rule.matchType} "\${rule.matchValue}" -> \${rule.action}\`);
});`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/bankRecon.ruleList",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
rules = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Rules with `bankAccountId: null` are global and apply to all accounts. Account-specific rules are scoped to that account only.",
        "When filtering by `bankAccountId`, both account-specific rules AND global rules (null bankAccountId) are returned.",
        "Rules are ordered by priority descending, then by creation date. Higher priority rules are checked first.",
      ],
    },
    {
      id: "bank-recon-rule-create",
      method: "mutation",
      path: "bankRecon.ruleCreate",
      title: "Create Categorization Rule",
      description: "Create an auto-categorization rule for bank reconciliation. Rules are evaluated during CSV import to automatically categorize unmatched statement lines. Supports matching on narration or reference fields with contains, starts_with, exact, or regex match types.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "matchField", type: "enum", required: true, description: "Which field to match against", enumValues: ["narration", "reference"] },
        { name: "matchType", type: "enum", required: true, description: "How to match", enumValues: ["contains", "starts_with", "exact", "regex"] },
        { name: "matchValue", type: "string", required: true, description: "Value to match, e.g. \"ATM-CASH/WDL\", \"NEFT-CR\"" },
        { name: "action", type: "enum", required: true, description: "Action to take on match", enumValues: ["create_expense", "ignore", "tag_party"] },
        { name: "expenseCategory", type: "string", required: false, description: "Expense category (required when action is create_expense)" },
        { name: "partyId", type: "string (UUID)", required: false, description: "Party to tag (required when action is tag_party)" },
        { name: "bankAccountId", type: "string (UUID)", required: false, description: "Scope rule to a specific account. Omit for global rule." },
        { name: "priority", type: "number", required: false, description: "Rule priority (higher = checked first)", default: "0" },
      ],
      output: {
        description: "Created categorization rule.",
        example: {
          id: "rule-uuid-new",
          businessId: "biz-uuid",
          bankAccountId: null,
          matchField: "narration",
          matchType: "contains",
          matchValue: "ATM-CASH/WDL",
          action: "create_expense",
          expenseCategory: "Cash Withdrawal",
          partyId: null,
          priority: 50,
          isActive: true,
          createdAt: "2026-04-08T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.ruleCreate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "matchField": "narration",
      "matchType": "contains",
      "matchValue": "ATM-CASH/WDL",
      "action": "create_expense",
      "expenseCategory": "Cash Withdrawal",
      "priority": 50
    }
  }'`,
        javascript: `const rule = await trpc.bankRecon.ruleCreate.mutate({
  matchField: "narration",
  matchType: "contains",
  matchValue: "ATM-CASH/WDL",
  action: "create_expense",
  expenseCategory: "Cash Withdrawal",
  priority: 50,
});

console.log("Rule created:", rule.id);`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.ruleCreate",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "matchField": "narration",
        "matchType": "contains",
        "matchValue": "ATM-CASH/WDL",
        "action": "create_expense",
        "expenseCategory": "Cash Withdrawal",
        "priority": 50,
    }},
)`,
      },
      gotchas: [
        "Rules are applied during `bankRecon.confirmMapping`, not retroactively. Create rules before importing statements.",
        "For `regex` match type, the value is used as a JavaScript RegExp. Invalid regex will cause import errors.",
        "If `bankAccountId` is provided, it must belong to the current business. Otherwise returns NOT_FOUND.",
      ],
    },
    {
      id: "bank-recon-rule-update",
      method: "mutation",
      path: "bankRecon.ruleUpdate",
      title: "Update Categorization Rule",
      description: "Update an existing categorization rule. Supports partial updates for any field including match criteria, action, category, priority, and active status.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Rule ID to update" },
        { name: "data.matchField", type: "enum", required: false, description: "Updated match field", enumValues: ["narration", "reference"] },
        { name: "data.matchType", type: "enum", required: false, description: "Updated match type", enumValues: ["contains", "starts_with", "exact", "regex"] },
        { name: "data.matchValue", type: "string", required: false, description: "Updated match value" },
        { name: "data.action", type: "enum", required: false, description: "Updated action", enumValues: ["create_expense", "ignore", "tag_party"] },
        { name: "data.expenseCategory", type: "string", required: false, description: "Updated expense category" },
        { name: "data.priority", type: "number", required: false, description: "Updated priority" },
        { name: "data.isActive", type: "boolean", required: false, description: "Enable or disable the rule" },
      ],
      output: {
        description: "Updated rule.",
        example: {
          id: "rule-uuid-1",
          matchField: "narration",
          matchType: "contains",
          matchValue: "ATM-CASH/WDL",
          action: "create_expense",
          expenseCategory: "Cash Withdrawal",
          priority: 75,
          isActive: true,
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.ruleUpdate \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "id": "rule-uuid-1",
      "data": { "priority": 75, "isActive": true }
    }
  }'`,
        javascript: `const updated = await trpc.bankRecon.ruleUpdate.mutate({
  id: "rule-uuid-1",
  data: { priority: 75, isActive: true },
});`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.ruleUpdate",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "rule-uuid-1", "data": {"priority": 75, "isActive": True}}},
)`,
      },
      gotchas: [
        "The `data` wrapper is required around the fields to update.",
        "Setting `isActive: false` keeps the rule but excludes it from matching during future imports.",
      ],
    },
    {
      id: "bank-recon-rule-delete",
      method: "mutation",
      path: "bankRecon.ruleDelete",
      title: "Delete Categorization Rule",
      description: "Permanently delete a categorization rule. Previously categorized lines are not affected.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Rule ID to delete" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankRecon.ruleDelete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"rule-uuid-1"}}'`,
        javascript: `await trpc.bankRecon.ruleDelete.mutate({ id: "rule-uuid-1" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/bankRecon.ruleDelete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "rule-uuid-1"}},
)`,
      },
      gotchas: [
        "This is a hard delete. Consider setting `isActive: false` instead if you might need the rule again.",
        "Previously imported lines that were categorized by this rule retain their `autoCategory` value.",
      ],
    },
  ],
};
