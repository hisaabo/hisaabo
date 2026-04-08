import type { EndpointGroup } from "./types";

export const gstr2bEndpoints: EndpointGroup = {
  id: "gstr2b",
  title: "GSTR-2B Reconciliation",
  description: "Upload and reconcile GSTR-2B data against your purchase records. Identify mismatches — invoices in 2B but not in your books, and vice versa. Link or ignore records to complete reconciliation.",
  endpoints: [
    {
      id: "gstr2b-upload",
      method: "mutation",
      path: "gstr2b.upload",
      title: "Upload GSTR-2B File",
      description: "Upload a GSTR-2B file (JSON from the GST portal or CSV from accounting software). The file is parsed, all supplier records are stored, and automatic reconciliation is performed against your purchase invoices by matching GSTIN + invoice number. Returns a summary of matched, mismatched, and missing records.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "returnPeriod", type: "string", required: true, description: "Return period in YYYY-MM format (e.g. '2026-01')" },
        { name: "content", type: "string", required: true, description: "File content as a string (max 50 MB)" },
        { name: "fileName", type: "string", required: true, description: "Original filename (1-255 chars)" },
        { name: "format", type: "string", required: true, description: "File format", enumValues: ["json", "csv"] },
      ],
      output: {
        description: "Upload summary with reconciliation results.",
        example: {
          uploadId: "upload-uuid",
          returnPeriod: "2026-01",
          totalRecords: 45,
          matchedRecords: 38,
          mismatchedRecords: 3,
          missingInBooks: 4,
          missingIn2B: 2,
        },
      },
      codeExamples: {
        curl: `# Read the GSTR-2B JSON file and upload
curl -X POST https://api.hisaabo.in/api/trpc/gstr2b.upload \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"returnPeriod":"2026-01","content":"<file-content-as-string>","fileName":"GSTR2B_Jan2026.json","format":"json"}}'`,
        javascript: `// Read file from input element
const file = fileInput.files[0];
const content = await file.text();

const summary = await trpc.gstr2b.upload.mutate({
  returnPeriod: "2026-01",
  content,
  fileName: file.name,
  format: file.name.endsWith(".json") ? "json" : "csv",
});
console.log(\`Matched: \${summary.matchedRecords}/\${summary.totalRecords}\`);
console.log(\`Missing in books: \${summary.missingInBooks}\`);
console.log(\`Missing in 2B: \${summary.missingIn2B}\`);`,
        python: `import httpx
from pathlib import Path

file_path = Path("GSTR2B_Jan2026.json")
content = file_path.read_text()

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/gstr2b.upload",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "returnPeriod": "2026-01",
        "content": content,
        "fileName": file_path.name,
        "format": "json",
    }},
)
summary = resp.json()["result"]["data"]["json"]
print(f"Matched: {summary['matchedRecords']}/{summary['totalRecords']}")`,
      },
      gotchas: [
        "Requires `GstReport:create` permission. Admin role only.",
        "The file content is sent as a string (not multipart upload) -- the max size is 50 MB.",
        "Download the GSTR-2B JSON from the GST portal: Login > Returns > GSTR-2B > Download JSON.",
        "Reconciliation matches by supplier GSTIN + invoice number. If a supplier's GSTIN doesn't match, the record will be 'missing_in_books'.",
        "Records are stored in batches of 500 for performance. Large files (10,000+ records) may take a few seconds.",
        "Uploading for the same return period again creates a NEW upload -- previous uploads are preserved for history.",
        "The `missingIn2B` count reflects purchase invoices in your books that were not found in the uploaded 2B data.",
      ],
      relatedEndpoints: ["gstr2b-uploads", "gstr2b-summary", "gstr2b-missing-in-books", "gstr2b-missing-in-2b"],
    },
    {
      id: "gstr2b-uploads",
      method: "query",
      path: "gstr2b.uploads",
      title: "List Past Uploads",
      description: "List all past GSTR-2B uploads for this business, ordered by upload date (most recent first). Each upload includes summary counts of total, matched, unmatched, and new records.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "page", type: "number", required: false, description: "Page number (min 1)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Results per page (1-50)", default: "20" },
      ],
      output: {
        description: "Paginated list of GSTR-2B uploads.",
        example: {
          uploads: [
            {
              id: "upload-uuid",
              businessId: "biz-uuid",
              returnPeriod: "2026-01",
              fileName: "GSTR2B_Jan2026.json",
              totalRecords: 45,
              matchedRecords: 38,
              unmatchedRecords: 3,
              newRecords: 4,
              uploadedAt: "2026-02-10T09:30:00.000Z",
              createdByUserId: "user-uuid",
            },
            {
              id: "upload-uuid-2",
              businessId: "biz-uuid",
              returnPeriod: "2025-12",
              fileName: "GSTR2B_Dec2025.json",
              totalRecords: 52,
              matchedRecords: 50,
              unmatchedRecords: 1,
              newRecords: 1,
              uploadedAt: "2026-01-12T10:00:00.000Z",
              createdByUserId: "user-uuid",
            },
          ],
          total: 12,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/gstr2b.uploads?input=%7B%22json%22%3A%7B%22page%22%3A1%2C%22limit%22%3A10%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { uploads, total } = await trpc.gstr2b.uploads.query({
  page: 1,
  limit: 10,
});
for (const upload of uploads) {
  const matchRate = ((upload.matchedRecords / upload.totalRecords) * 100).toFixed(1);
  console.log(\`\${upload.returnPeriod}: \${matchRate}% matched (\${upload.totalRecords} records)\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/gstr2b.uploads",
    params={"input": '{"json":{"page":1,"limit":10}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
for upload in data["uploads"]:
    print(f"{upload['returnPeriod']}: {upload['matchedRecords']}/{upload['totalRecords']} matched")`,
      },
      gotchas: [
        "Requires `GstReport:read` permission. Viewer role and above can access.",
        "Input is optional -- if omitted, defaults to page 1 with limit 20.",
        "Multiple uploads can exist for the same return period. The summary endpoint uses the most recent upload.",
      ],
      relatedEndpoints: ["gstr2b-upload", "gstr2b-records", "gstr2b-summary"],
    },
    {
      id: "gstr2b-records",
      method: "query",
      path: "gstr2b.records",
      title: "Get Upload Records",
      description: "Paginated list of individual GSTR-2B records for a specific upload. Each record represents a supplier invoice from the 2B data. Supports filtering by match status to focus on records that need attention.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "uploadId", type: "string", required: true, description: "UUID of the GSTR-2B upload" },
        { name: "matchStatus", type: "string", required: false, description: "Filter by reconciliation status", enumValues: ["matched", "mismatched", "missing_in_books", "pending", "ignored"] },
        { name: "page", type: "number", required: false, description: "Page number (min 1)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Results per page (1-100)", default: "25" },
      ],
      output: {
        description: "Paginated list of 2B records with supplier details, tax breakdown, and match status.",
        example: {
          records: [
            {
              id: "record-uuid",
              uploadId: "upload-uuid",
              businessId: "biz-uuid",
              supplierGstin: "29AABCT1332L1ZL",
              supplierName: "Gupta Enterprises",
              invoiceNumber: "GE/2025-26/0154",
              invoiceDate: "2026-01-08T00:00:00.000Z",
              invoiceValue: "59000.00",
              taxableValue: "50000.00",
              cgst: "4500.00",
              sgst: "4500.00",
              igst: "0.00",
              cess: "0.00",
              itcAvailable: "Y",
              reason: null,
              sourceType: "B2B",
              matchStatus: "matched",
              matchedInvoiceId: "inv-uuid",
              mismatchReasons: null,
            },
          ],
          total: 45,
          page: 1,
          limit: 25,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/gstr2b.records?input=%7B%22json%22%3A%7B%22uploadId%22%3A%22upload-uuid%22%2C%22matchStatus%22%3A%22mismatched%22%2C%22page%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { records, total } = await trpc.gstr2b.records.query({
  uploadId: "upload-uuid",
  matchStatus: "mismatched",
  page: 1,
});
for (const rec of records) {
  console.log(\`\${rec.supplierName} - \${rec.invoiceNumber}: \${rec.mismatchReasons?.join(", ")}\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/gstr2b.records",
    params={"input": '{"json":{"uploadId":"upload-uuid","matchStatus":"mismatched","page":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
for rec in data["records"]:
    print(f"{rec['supplierName']}: {rec['mismatchReasons']}")`,
      },
      gotchas: [
        "Requires `GstReport:read` permission. Viewer role and above can access.",
        "Returns NOT_FOUND if the upload does not belong to the current business.",
        "The `mismatchReasons` field is an array of strings (e.g. ['taxable_value_mismatch', 'cgst_mismatch']) -- only populated for 'mismatched' records.",
        "The `itcAvailable` field is 'Y' or 'N' as per the GST portal format.",
        "Records are ordered by supplier name and invoice date.",
      ],
      relatedEndpoints: ["gstr2b-uploads", "gstr2b-link-invoice", "gstr2b-ignore-record"],
    },
    {
      id: "gstr2b-summary",
      method: "query",
      path: "gstr2b.summary",
      title: "Reconciliation Summary",
      description: "Get the reconciliation summary for a return period. Shows matched, mismatched, missing-in-books, pending, and ignored counts along with ITC impact -- total ITC available (from matched records) and ITC at risk (from mismatched and missing records). Uses the most recent upload for the period.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "returnPeriod", type: "string", required: true, description: "Return period in YYYY-MM format (e.g. '2026-01')" },
      ],
      output: {
        description: "Reconciliation summary with ITC impact analysis.",
        example: {
          returnPeriod: "2026-01",
          hasData: true,
          uploadId: "upload-uuid",
          uploadedAt: "2026-02-10T09:30:00.000Z",
          matched: 38,
          mismatched: 3,
          missingInBooks: 4,
          pending: 0,
          ignored: 0,
          totalRecords: 45,
          itcAvailable: { cgst: "171000.00", sgst: "171000.00", igst: "0.00", cess: "0.00", total: "342000.00" },
          itcAtRisk: { cgst: "13500.00", sgst: "13500.00", igst: "0.00", cess: "0.00", total: "27000.00" },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/gstr2b.summary?input=%7B%22json%22%3A%7B%22returnPeriod%22%3A%222026-01%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const summary = await trpc.gstr2b.summary.query({
  returnPeriod: "2026-01",
});
if (summary.hasData) {
  console.log(\`Match rate: \${((summary.matched / summary.totalRecords) * 100).toFixed(1)}%\`);
  console.log(\`ITC available: Rs. \${summary.itcAvailable.total}\`);
  console.log(\`ITC at risk: Rs. \${summary.itcAtRisk.total}\`);
} else {
  console.log("No GSTR-2B data uploaded for this period");
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/gstr2b.summary",
    params={"input": '{"json":{"returnPeriod":"2026-01"}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
summary = resp.json()["result"]["data"]["json"]
if summary["hasData"]:
    print(f"ITC available: Rs. {summary['itcAvailable']['total']}")
    print(f"ITC at risk: Rs. {summary['itcAtRisk']['total']}")
else:
    print("No data for this period")`,
      },
      gotchas: [
        "Requires `GstReport:read` permission. Viewer role and above can access.",
        "If no upload exists for the period, returns `hasData: false` with all counts at zero -- does NOT throw an error.",
        "Uses the MOST RECENT upload for the period. If you upload a corrected file, the summary reflects the latest upload.",
        "ITC available = sum of CGST/SGST/IGST/Cess from records with itcAvailable='Y' and matchStatus in ('matched', 'pending').",
        "ITC at risk = sum from records with itcAvailable='Y' and matchStatus in ('mismatched', 'missing_in_books'). These need attention before filing.",
        "GSTR-2B is auto-generated by the GST portal on the 14th of each month. Download it from gstn.gov.in and upload here for reconciliation.",
      ],
      relatedEndpoints: ["gstr2b-upload", "gstr2b-missing-in-books", "gstr2b-missing-in-2b"],
    },
    {
      id: "gstr2b-missing-in-books",
      method: "query",
      path: "gstr2b.missingInBooks",
      title: "Missing in Books",
      description: "List records that appear in the GSTR-2B upload but do not match any purchase invoice in your books. These are potential missed purchases or ITC opportunities -- the supplier has reported these invoices to the GST portal but you haven't recorded them.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "uploadId", type: "string", required: true, description: "UUID of the GSTR-2B upload" },
        { name: "page", type: "number", required: false, description: "Page number (min 1)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Results per page (1-100)", default: "25" },
      ],
      output: {
        description: "Paginated list of 2B records not found in your purchase books.",
        example: {
          records: [
            {
              id: "record-uuid",
              uploadId: "upload-uuid",
              businessId: "biz-uuid",
              supplierGstin: "07AAGCS4612P1Z2",
              supplierName: "Delhi Paper Mills",
              invoiceNumber: "DPM/25-26/0892",
              invoiceDate: "2026-01-05T00:00:00.000Z",
              invoiceValue: "23600.00",
              taxableValue: "20000.00",
              cgst: "1800.00",
              sgst: "1800.00",
              igst: "0.00",
              cess: "0.00",
              itcAvailable: "Y",
              sourceType: "B2B",
              matchStatus: "missing_in_books",
            },
          ],
          total: 4,
          page: 1,
          limit: 25,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/gstr2b.missingInBooks?input=%7B%22json%22%3A%7B%22uploadId%22%3A%22upload-uuid%22%2C%22page%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { records, total } = await trpc.gstr2b.missingInBooks.query({
  uploadId: "upload-uuid",
});
console.log(\`\${total} invoices in 2B not found in your books\`);
for (const rec of records) {
  console.log(\`  \${rec.supplierName} (\${rec.supplierGstin}): \${rec.invoiceNumber} - Rs. \${rec.invoiceValue}\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/gstr2b.missingInBooks",
    params={"input": '{"json":{"uploadId":"upload-uuid","page":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
for rec in data["records"]:
    print(f"Missing: {rec['supplierName']} - {rec['invoiceNumber']} Rs. {rec['invoiceValue']}")`,
      },
      gotchas: [
        "Requires `GstReport:read` permission. Viewer role and above can access.",
        "Returns NOT_FOUND if the upload does not belong to the current business.",
        "Action items: For each record, either (1) create the purchase invoice in your books, or (2) use `gstr2b.linkInvoice` to manually link it to an existing invoice, or (3) use `gstr2b.ignoreRecord` to mark it as handled.",
        "These records represent ITC you may be eligible for but haven't claimed -- review them promptly.",
      ],
      relatedEndpoints: ["gstr2b-link-invoice", "gstr2b-ignore-record", "gstr2b-summary"],
    },
    {
      id: "gstr2b-missing-in-2b",
      method: "query",
      path: "gstr2b.missingIn2B",
      title: "Missing in GSTR-2B",
      description: "List your purchase invoices that are not present in the GSTR-2B for a given return period. These are invoices where your suppliers haven't yet filed their GSTR-1 -- follow up with them to ensure they report these invoices so your ITC is reflected in future 2B statements.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "returnPeriod", type: "string", required: true, description: "Return period in YYYY-MM format (e.g. '2026-01')" },
        { name: "page", type: "number", required: false, description: "Page number (min 1)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Results per page (1-100)", default: "25" },
      ],
      output: {
        description: "Paginated list of your purchase invoices not found in the 2B data.",
        example: {
          records: [
            {
              id: "inv-uuid",
              invoiceNumber: "PUR-2026-0022",
              invoiceDate: "2026-01-18T00:00:00.000Z",
              totalAmount: "35400.00",
              subtotal: "30000.00",
              partyName: "Sharma Traders",
              partyGstin: "27AALCS5678B1Z9",
            },
          ],
          total: 2,
          page: 1,
          limit: 25,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/gstr2b.missingIn2B?input=%7B%22json%22%3A%7B%22returnPeriod%22%3A%222026-01%22%2C%22page%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { records, total } = await trpc.gstr2b.missingIn2B.query({
  returnPeriod: "2026-01",
});
console.log(\`\${total} of your purchase invoices not in supplier's 2B\`);
for (const inv of records) {
  console.log(\`  Follow up with \${inv.partyName} (\${inv.partyGstin}) for \${inv.invoiceNumber}\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/gstr2b.missingIn2B",
    params={"input": '{"json":{"returnPeriod":"2026-01","page":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
for inv in data["records"]:
    print(f"Missing in 2B: {inv['partyName']} - {inv['invoiceNumber']}")`,
      },
      gotchas: [
        "Requires `GstReport:read` permission. Viewer role and above can access.",
        "Returns empty results (not an error) if no GSTR-2B upload exists for the period.",
        "Only includes purchase invoices where the party has a GSTIN -- unregistered supplier invoices are excluded since they won't appear in 2B.",
        "Only non-cancelled purchase invoices within the period date range are checked.",
        "Action: Contact these suppliers and request them to file their GSTR-1 with the correct invoice details.",
        "This is computed in-memory by comparing upload records against purchase invoices -- for very large datasets, response may take a moment.",
      ],
      relatedEndpoints: ["gstr2b-summary", "gstr2b-missing-in-books"],
    },
    {
      id: "gstr2b-link-invoice",
      method: "mutation",
      path: "gstr2b.linkInvoice",
      title: "Link 2B Record to Invoice",
      description: "Manually link a GSTR-2B record to a specific purchase invoice. Use this when automatic reconciliation failed to match a record (e.g. due to minor invoice number differences) but you've identified the correct purchase invoice. Updates the record's match status to 'matched'.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "recordId", type: "string", required: true, description: "UUID of the GSTR-2B record to link" },
        { name: "invoiceId", type: "string", required: true, description: "UUID of the purchase invoice to link to" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/gstr2b.linkInvoice \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"recordId":"record-uuid","invoiceId":"inv-uuid"}}'`,
        javascript: `await trpc.gstr2b.linkInvoice.mutate({
  recordId: "record-uuid",
  invoiceId: "inv-uuid",
});
// Record is now marked as "matched" and linked to the invoice`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/gstr2b.linkInvoice",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "recordId": "record-uuid",
        "invoiceId": "inv-uuid",
    }},
)
result = resp.json()["result"]["data"]["json"]
print("Linked:", result["success"])`,
      },
      gotchas: [
        "Requires `GstReport:create` permission. Admin role only.",
        "Returns NOT_FOUND if the record does not belong to this business or if the invoice is not a purchase invoice belonging to this business.",
        "Sets the record's `matchStatus` to 'matched' and clears any `mismatchReasons`.",
        "You can re-link a record to a different invoice by calling this again with the same recordId but a different invoiceId.",
        "Common use case: supplier uses a different invoice number format (e.g. 'INV/123' vs 'INV-123') causing the auto-match to fail.",
      ],
      relatedEndpoints: ["gstr2b-records", "gstr2b-missing-in-books", "gstr2b-ignore-record"],
    },
    {
      id: "gstr2b-ignore-record",
      method: "mutation",
      path: "gstr2b.ignoreRecord",
      title: "Ignore 2B Record",
      description: "Mark a GSTR-2B record as intentionally ignored. Use this for records that don't need attention -- e.g. reverse charge already handled, duplicate entries, or records from a previous period already reconciled.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "recordId", type: "string", required: true, description: "UUID of the GSTR-2B record to ignore" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/gstr2b.ignoreRecord \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"recordId":"record-uuid"}}'`,
        javascript: `await trpc.gstr2b.ignoreRecord.mutate({
  recordId: "record-uuid",
});
// Record is now marked as "ignored" and excluded from mismatch counts`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/gstr2b.ignoreRecord",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {"recordId": "record-uuid"}},
)
result = resp.json()["result"]["data"]["json"]
print("Ignored:", result["success"])`,
      },
      gotchas: [
        "Requires `GstReport:create` permission. Admin role only.",
        "Returns NOT_FOUND if the record does not belong to this business.",
        "Sets the record's `matchStatus` to 'ignored'. Ignored records are excluded from the 'missingInBooks' and 'mismatched' counts in the summary.",
        "Ignoring a record is reversible -- use `gstr2b.linkInvoice` to re-link it to an invoice, which will change the status back to 'matched'.",
        "Use sparingly -- every ignored record is potential ITC you might be missing. Document why you're ignoring it for audit purposes.",
      ],
      relatedEndpoints: ["gstr2b-link-invoice", "gstr2b-records", "gstr2b-missing-in-books"],
    },
  ],
};
