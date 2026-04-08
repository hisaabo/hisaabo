import type { EndpointGroup } from "./types";

export const gstEndpoints: EndpointGroup = {
  id: "gst",
  title: "GST Returns",
  description: "Generate filing-ready GST returns. GSTR-1 (outward supplies), GSTR-3B (summary return), GSTR-9 (annual return), and CMP-08 (composition scheme). All endpoints return structured data ready for export to the GST portal.",
  endpoints: [
    {
      id: "gst-gstr1",
      method: "query",
      path: "gst.gstr1",
      title: "Generate GSTR-1",
      description: "Generate GSTR-1 (outward supplies) data for a given month. Returns structured sections — B2B, B2CS, B2CL, HSN summary, document summary — computed from all sale invoices in the period. Works for both GST-registered and non-GST businesses (non-GST businesses get generic financial report terminology).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "year", type: "number", required: true, description: "Calendar year (2020–2099)" },
        { name: "month", type: "number", required: true, description: "Month number (1–12)" },
      ],
      output: {
        description: "Structured GSTR-1 report with B2B, B2CS, B2CL, HSN summary, and document summary sections.",
        example: {
          period: "January 2026",
          gstin: "27AABCS1429B1Z5",
          b2b: [
            {
              gstin: "29AABCT1332L1ZL",
              partyName: "Gupta Enterprises",
              invoices: [
                {
                  invoiceNumber: "INV-2026-0042",
                  invoiceDate: "2026-01-15",
                  invoiceValue: "118000.00",
                  taxableValue: "100000.00",
                  cgst: "9000.00",
                  sgst: "9000.00",
                  igst: "0.00",
                  reverseCharge: false,
                },
              ],
            },
          ],
          b2cs: {
            taxableValue: "50000.00",
            cgst: "4500.00",
            sgst: "4500.00",
            igst: "0.00",
          },
          hsnSummary: [
            { hsn: "6109", description: "T-shirts", quantity: 500, taxableValue: "75000.00", cgst: "6750.00", sgst: "6750.00", igst: "0.00" },
          ],
          documentSummary: {
            invoicesIssued: { from: "INV-2026-0038", to: "INV-2026-0055", total: 18, cancelled: 1 },
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/gst.gstr1?input=%7B%22json%22%3A%7B%22year%22%3A2026%2C%22month%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const report = await trpc.gst.gstr1.query({
  year: 2026,
  month: 1,
});
console.log("B2B invoices:", report.b2b.length);
console.log("B2CS taxable:", report.b2cs.taxableValue);`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/gst.gstr1",
    params={"input": '{"json":{"year":2026,"month":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
report = resp.json()["result"]["data"]["json"]
print("Period:", report["period"])`,
      },
      gotchas: [
        "Requires `Report:read` permission. Viewer role and above can access.",
        "Both GST-registered and non-GST businesses can use this endpoint. Non-GST businesses receive the same data with generic terminology.",
        "Only sale invoices with status != 'cancelled' are included.",
        "B2B section only includes invoices where the customer has a GSTIN.",
      ],
      relatedEndpoints: ["gst-gstr1csv", "gst-gstr1json", "gst-gstr3b"],
    },
    {
      id: "gst-gstr3b",
      method: "query",
      path: "gst.gstr3b",
      title: "Generate GSTR-3B",
      description: "Generate GSTR-3B (monthly summary return) data for a given month. Includes outward supplies summary, inter-state supplies, ITC claimed, and tax payable. This is a summary-level return — individual invoice details are not included.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "year", type: "number", required: true, description: "Calendar year (2020–2099)" },
        { name: "month", type: "number", required: true, description: "Month number (1–12)" },
      ],
      output: {
        description: "GSTR-3B summary with tables 3.1 (outward supplies), 3.2 (inter-state), 4 (ITC), and 6 (tax payable).",
        example: {
          period: "January 2026",
          gstin: "27AABCS1429B1Z5",
          table3_1: {
            outwardTaxable: { taxableValue: "150000.00", igst: "0.00", cgst: "13500.00", sgst: "13500.00", cess: "0.00" },
            outwardZeroRated: { taxableValue: "0.00", igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00" },
            outwardNilExempt: { taxableValue: "5000.00", igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00" },
            inwardReverseCharge: { taxableValue: "0.00", igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00" },
          },
          table4: {
            itcAvailable: { igst: "0.00", cgst: "4500.00", sgst: "4500.00", cess: "0.00" },
            itcReversed: { igst: "0.00", cgst: "0.00", sgst: "0.00", cess: "0.00" },
            netItc: { igst: "0.00", cgst: "4500.00", sgst: "4500.00", cess: "0.00" },
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/gst.gstr3b?input=%7B%22json%22%3A%7B%22year%22%3A2026%2C%22month%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const summary = await trpc.gst.gstr3b.query({
  year: 2026,
  month: 1,
});
console.log("Outward taxable:", summary.table3_1.outwardTaxable.taxableValue);
console.log("Net ITC CGST:", summary.table4.netItc.cgst);`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/gst.gstr3b",
    params={"input": '{"json":{"year":2026,"month":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
summary = resp.json()["result"]["data"]["json"]
print("Tax payable CGST:", summary["table3_1"]["outwardTaxable"]["cgst"])`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "GSTR-3B is a summary return — it aggregates all invoices into category totals. Use `gst.gstr1` for invoice-level detail.",
        "Inter-state supplies (table 3.2) are derived from invoice place-of-supply vs business state code.",
      ],
      relatedEndpoints: ["gst-gstr1", "itc-gstr3b-table4"],
    },
    {
      id: "gst-gstr1csv",
      method: "query",
      path: "gst.gstr1CSV",
      title: "Export GSTR-1 as CSV",
      description: "Generate GSTR-1 data and return it as a CSV string ready for download. The CSV follows the format expected by most GST filing tools and CAs for offline filing.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "year", type: "number", required: true, description: "Calendar year (2020–2099)" },
        { name: "month", type: "number", required: true, description: "Month number (1–12)" },
      ],
      output: {
        description: "CSV string and suggested filename.",
        example: {
          csv: "GSTIN,Invoice Number,Invoice Date,Value,Taxable Value,CGST,SGST,IGST\n29AABCT1332L1ZL,INV-2026-0042,15-01-2026,118000.00,100000.00,9000.00,9000.00,0.00",
          filename: "GSTR1_January_2026.csv",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/gst.gstr1CSV?input=%7B%22json%22%3A%7B%22year%22%3A2026%2C%22month%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { csv, filename } = await trpc.gst.gstr1CSV.query({
  year: 2026,
  month: 1,
});
// Download as file
const blob = new Blob([csv], { type: "text/csv" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = filename;
a.click();`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/gst.gstr1CSV",
    params={"input": '{"json":{"year":2026,"month":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
with open(data["filename"], "w") as f:
    f.write(data["csv"])`,
      },
      gotchas: [
        "The CSV is returned as a string in the JSON response — not as a file download. Your client must convert it to a downloadable file.",
        "Requires `Report:read` permission.",
      ],
      relatedEndpoints: ["gst-gstr1", "gst-gstr1json"],
    },
    {
      id: "gst-gstr1json",
      method: "query",
      path: "gst.gstr1Json",
      title: "Export GSTR-1 as Portal JSON",
      description: "Generate GSTR-1 data in the exact JSON schema accepted by the GST portal's offline tool. Users can download this JSON and upload it directly to gstn.gov.in instead of manually entering invoice data. Includes the business GSTIN, financial year, and filing period in the portal-required format.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "year", type: "number", required: true, description: "Calendar year (2020–2099)" },
        { name: "month", type: "number", required: true, description: "Month number (1–12)" },
      ],
      output: {
        description: "Portal-compatible JSON and suggested filename.",
        example: {
          json: {
            gstin: "27AABCS1429B1Z5",
            fp: "012026",
            fy: "2025-26",
            b2b: [],
            b2cs: [],
            hsn: { data: [] },
            doc_issue: { doc_det: [] },
          },
          filename: "GSTR1_January_2026_portal.json",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/gst.gstr1Json?input=%7B%22json%22%3A%7B%22year%22%3A2026%2C%22month%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { json, filename } = await trpc.gst.gstr1Json.query({
  year: 2026,
  month: 1,
});
// Download as JSON file for GST portal upload
const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = filename;
a.click();`,
        python: `import httpx, json

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/gst.gstr1Json",
    params={"input": '{"json":{"year":2026,"month":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
with open(data["filename"], "w") as f:
    json.dump(data["json"], f, indent=2)
print("Saved portal JSON:", data["filename"])`,
      },
      gotchas: [
        "The JSON schema matches the GST portal's offline tool format exactly. Upload it at gstn.gov.in under GSTR-1 > Upload JSON.",
        "The `fp` (filing period) field uses MMYYYY format (e.g. '012026' for January 2026) as required by the portal.",
        "Financial year (`fy`) is auto-detected from the business's `financialYearStart` setting (default April).",
        "Requires `Report:read` permission.",
      ],
      relatedEndpoints: ["gst-gstr1", "gst-gstr1csv"],
    },
    {
      id: "gst-gstr9",
      method: "query",
      path: "gst.gstr9",
      title: "Generate GSTR-9 (Annual Return)",
      description: "Generate GSTR-9 annual return data for a financial year. Consolidates 12 months of GSTR-1 and GSTR-3B data into the annual return format. Tables 4-9 are auto-generated from monthly data — no separate data entry required. Filed once per financial year (April-March).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "financialYear", type: "number", required: true, description: "Financial year start year (2020–2099). For FY 2025-26, pass 2025." },
      ],
      output: {
        description: "Annual return data with tables 4 (outward supplies), 5 (outward supplies amendments), 6 (ITC), 7 (reverse charge), 8 (other ITC), and 9 (late fee).",
        example: {
          financialYear: "2025-26",
          gstin: "27AABCS1429B1Z5",
          table4: {
            b2b: { taxableValue: "1800000.00", cgst: "162000.00", sgst: "162000.00", igst: "0.00", cess: "0.00" },
            b2cs: { taxableValue: "600000.00", cgst: "54000.00", sgst: "54000.00", igst: "0.00", cess: "0.00" },
            total: { taxableValue: "2400000.00", cgst: "216000.00", sgst: "216000.00", igst: "0.00", cess: "0.00" },
          },
          table6: {
            totalItcAvailed: { cgst: "108000.00", sgst: "108000.00", igst: "0.00", cess: "0.00" },
          },
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/gst.gstr9?input=%7B%22json%22%3A%7B%22financialYear%22%3A2025%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const annual = await trpc.gst.gstr9.query({
  financialYear: 2025, // FY 2025-26
});
console.log("FY:", annual.financialYear);
console.log("Total outward:", annual.table4.total.taxableValue);`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/gst.gstr9",
    params={"input": '{"json":{"financialYear":2025}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
annual = resp.json()["result"]["data"]["json"]
print("FY:", annual["financialYear"])`,
      },
      gotchas: [
        "Requires `GstReport:read` permission (stricter than the monthly reports which need `Report:read`).",
        "Pass the START year of the financial year. For FY 2025-26 (April 2025 to March 2026), pass `financialYear: 2025`.",
        "GSTR-9 must be filed by December 31 of the following year (e.g. FY 2025-26 deadline is 31 Dec 2026).",
        "Data is generated from monthly GSTR-1 and GSTR-3B calculations — ensure monthly returns are correct before generating the annual return.",
      ],
      relatedEndpoints: ["gst-gstr9json", "gst-gstr1", "gst-gstr3b"],
    },
    {
      id: "gst-gstr9json",
      method: "query",
      path: "gst.gstr9Json",
      title: "Export GSTR-9 as Portal JSON",
      description: "Generate GSTR-9 annual return data in the exact JSON schema accepted by the GST portal's offline tool. Download and upload directly to gstn.gov.in for filing.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "financialYear", type: "number", required: true, description: "Financial year start year (2020–2099). For FY 2025-26, pass 2025." },
      ],
      output: {
        description: "Portal-compatible GSTR-9 JSON and suggested filename.",
        example: {
          json: {
            gstin: "27AABCS1429B1Z5",
            fy: "2025-26",
            table4: {},
            table5: {},
            table6: {},
          },
          filename: "GSTR9_FY2025_26_portal.json",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/gst.gstr9Json?input=%7B%22json%22%3A%7B%22financialYear%22%3A2025%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { json, filename } = await trpc.gst.gstr9Json.query({
  financialYear: 2025,
});
// Download for GST portal upload
const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = filename;
a.click();`,
        python: `import httpx, json

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/gst.gstr9Json",
    params={"input": '{"json":{"financialYear":2025}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]
with open(data["filename"], "w") as f:
    json.dump(data["json"], f, indent=2)`,
      },
      gotchas: [
        "Requires `GstReport:read` permission.",
        "The filename uses underscores: `GSTR9_FY2025_26_portal.json` (the dash in '2025-26' becomes an underscore).",
      ],
      relatedEndpoints: ["gst-gstr9"],
    },
    {
      id: "gst-cmp08",
      method: "query",
      path: "gst.cmp08",
      title: "Generate CMP-08 (Composition Scheme)",
      description: "Generate CMP-08 quarterly return for composition scheme dealers. Composition dealers pay a flat tax rate on total outward supplies instead of collecting GST from customers. Calculates total taxable value from sale invoices in the quarter and applies the composition tax rate (default 1% for traders/manufacturers).",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "year", type: "number", required: true, description: "Calendar year (2020–2099)" },
        { name: "quarter", type: "number", required: true, description: "Quarter number (1–4). Q1 = Jan-Mar, Q2 = Apr-Jun, Q3 = Jul-Sep, Q4 = Oct-Dec." },
      ],
      output: {
        description: "Total taxable value, tax payable at composition rate, and quarter date range.",
        example: {
          taxableValue: "450000.00",
          taxPayable: "4500.00",
          quarterStart: "2026-01-01T00:00:00.000Z",
          quarterEnd: "2026-03-31T23:59:59.000Z",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/gst.cmp08?input=%7B%22json%22%3A%7B%22year%22%3A2026%2C%22quarter%22%3A1%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const cmp = await trpc.gst.cmp08.query({
  year: 2026,
  quarter: 1, // Q1 = Jan-Mar
});
console.log("Taxable value:", cmp.taxableValue);
console.log("Tax payable (1%):", cmp.taxPayable);`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/gst.cmp08",
    params={"input": '{"json":{"year":2026,"quarter":1}}'},
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
cmp = resp.json()["result"]["data"]["json"]
print(f"Tax payable: Rs. {cmp['taxPayable']}")`,
      },
      gotchas: [
        "Requires `Report:read` permission.",
        "The default composition rate is 1% (for traders/manufacturers). Restaurants pay 5%, service providers pay 6% — the endpoint currently defaults to 1%.",
        "CMP-08 is filed quarterly by the 18th of the month following the quarter (e.g. Q1 Jan-Mar due by April 18).",
        "Quarters are calendar quarters (Q1 = Jan-Mar), not financial year quarters. This differs from some GST contexts where Q1 starts in April.",
        "Only sale invoices with status != 'cancelled' are included in the taxable value calculation.",
      ],
      relatedEndpoints: ["gst-gstr1", "gst-gstr3b"],
    },
  ],
};
