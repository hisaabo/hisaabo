import type { EndpointGroup } from "./types";

export const hsnEndpoints: EndpointGroup = {
  id: "hsn",
  title: "HSN Codes",
  description: "Search and validate HSN/SAC codes against the official 19,000-code master list. Public endpoints — no authentication required.",
  endpoints: [
    {
      id: "hsn-search",
      method: "query",
      path: "hsn.search",
      title: "Search HSN/SAC Codes",
      description: "Full-text search across the 19,000-code HSN/SAC master list. Returns matching codes with descriptions. Supports filtering by type (goods for HSN, services for SAC) and limiting result count. Useful for item creation forms where the user needs to pick the correct HSN code.",
      auth: "public",
      input: [
        { name: "query", type: "string", required: true, description: "Search term — code prefix or description keyword (1–50 chars). Example: '6109' or 'cotton t-shirt'" },
        { name: "type", type: "string", required: false, description: "Filter by code type", enumValues: ["goods", "services"] },
        { name: "limit", type: "number", required: false, description: "Max results to return (1–50)", default: "20" },
      ],
      output: {
        description: "Array of matching HSN/SAC codes with descriptions.",
        example: [
          { code: "6109", description: "T-shirts, singlets and other vests, knitted or crocheted", type: "goods" },
          { code: "61091000", description: "T-shirts, singlets and other vests, of cotton", type: "goods" },
          { code: "61099010", description: "T-shirts, singlets and other vests, of man-made fibres", type: "goods" },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/hsn.search?input=%7B%22json%22%3A%7B%22query%22%3A%22cotton%20t-shirt%22%2C%22type%22%3A%22goods%22%2C%22limit%22%3A5%7D%7D"`,
        javascript: `const results = await trpc.hsn.search.query({
  query: "cotton t-shirt",
  type: "goods",
  limit: 5,
});
// results = [{ code: "6109", description: "T-shirts...", type: "goods" }, ...]`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/hsn.search",
    params={"input": '{"json":{"query":"cotton t-shirt","type":"goods","limit":5}}'},
)
results = resp.json()["result"]["data"]["json"]
for item in results:
    print(f"{item['code']}: {item['description']}")`,
      },
      gotchas: [
        "This is a public endpoint — no authentication or business ID required.",
        "Search matches both the HSN code prefix and the description text.",
        "SAC codes (for services) start with 99 — use `type: 'services'` to filter to SAC codes only.",
        "The master list contains approximately 19,000 codes. Results are ranked by relevance.",
      ],
      relatedEndpoints: ["hsn-validate", "hsn-validate-for-turnover"],
    },
    {
      id: "hsn-validate",
      method: "query",
      path: "hsn.validate",
      title: "Validate HSN Code",
      description: "Check whether an HSN/SAC code exists in the official master list. Returns a boolean. Use this for form validation before saving items.",
      auth: "public",
      input: [
        { name: "hsn", type: "string", required: true, description: "HSN or SAC code to validate (2–8 characters)" },
      ],
      output: {
        description: "Validation result.",
        example: { valid: true },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/hsn.validate?input=%7B%22json%22%3A%7B%22hsn%22%3A%2261091000%22%7D%7D"`,
        javascript: `const { valid } = await trpc.hsn.validate.query({
  hsn: "61091000",
});
if (!valid) {
  showError("Invalid HSN code");
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/hsn.validate",
    params={"input": '{"json":{"hsn":"61091000"}}'},
)
result = resp.json()["result"]["data"]["json"]
print("Valid:", result["valid"])`,
      },
      gotchas: [
        "This is a public endpoint — no authentication required.",
        "Accepts 2 to 8 digit codes. Both 2-digit chapter codes (e.g. '61') and full 8-digit codes (e.g. '61091000') are valid.",
        "The validation is against the static master list — it does not check whether the code is mandatory for your turnover bracket.",
      ],
      relatedEndpoints: ["hsn-search", "hsn-validate-for-turnover"],
    },
    {
      id: "hsn-validate-for-turnover",
      method: "query",
      path: "hsn.validateForTurnover",
      title: "Validate HSN for Turnover",
      description: "Validate whether an HSN code meets the digit requirements for a given annual turnover. GST rules mandate different HSN digit lengths based on turnover: 4 digits for turnover above Rs. 5 crore, 6 digits above Rs. 10 crore on e-invoices. This endpoint checks both code validity and digit sufficiency.",
      auth: "public",
      input: [
        { name: "hsn", type: "string", required: true, description: "HSN or SAC code to validate (2–8 characters)" },
        { name: "annualTurnover", type: "string", required: true, description: "Annual turnover as a numeric string (e.g. '75000000.00' for Rs. 7.5 crore)" },
      ],
      output: {
        description: "Validation result with required digit count and whether the code meets the requirement.",
        example: {
          valid: true,
          code: "61091000",
          digits: 8,
          requiredDigits: 4,
          sufficient: true,
          message: "HSN code meets the requirement for your turnover bracket",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/hsn.validateForTurnover?input=%7B%22json%22%3A%7B%22hsn%22%3A%2261%22%2C%22annualTurnover%22%3A%2275000000.00%22%7D%7D"`,
        javascript: `const result = await trpc.hsn.validateForTurnover.query({
  hsn: "61",
  annualTurnover: "75000000.00", // Rs. 7.5 crore
});
if (!result.sufficient) {
  showWarning(\`Need at least \${result.requiredDigits}-digit HSN for your turnover\`);
}`,
        python: `import httpx

resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/hsn.validateForTurnover",
    params={"input": '{"json":{"hsn":"61","annualTurnover":"75000000.00"}}'},
)
result = resp.json()["result"]["data"]["json"]
if not result["sufficient"]:
    print(f"Need {result['requiredDigits']}-digit HSN code")`,
      },
      gotchas: [
        "This is a public endpoint — no authentication required.",
        "Turnover must be passed as a string (money rule) — e.g. '75000000.00' not 75000000.",
        "GST Notification 78/2020: Turnover > Rs. 5 crore requires 4-digit HSN on invoices. Below Rs. 5 crore, 2-digit HSN is acceptable for B2B invoices.",
        "E-invoicing requirements may demand 6-digit HSN — check with your CA for the latest mandate.",
      ],
      relatedEndpoints: ["hsn-search", "hsn-validate"],
    },
  ],
};
