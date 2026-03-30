import type { EndpointGroup } from "./types";

export const expenseEndpoints: EndpointGroup = {
  id: "expense",
  title: "Expenses",
  description: "Track and categorise business expenses. Expenses are soft-deleted (deletedAt timestamp). All amounts are NUMERIC strings — never use floating point. Requires an active business context via the `x-business-id` header.",
  endpoints: [
    {
      id: "expense-list",
      method: "query",
      path: "expense.list",
      title: "List Expenses",
      description: "Paginated list of expenses for the active business. Filter by category, free-text search (matches description and category), and date range. Results are ordered by expense date descending.",
      auth: "business",
      input: [
        { name: "category", type: "string", required: false, description: "Filter to a specific category (exact match)" },
        { name: "search", type: "string", required: false, description: "Full-text search on description and category (case-insensitive)" },
        { name: "fromDate", type: "string (ISO datetime)", required: false, description: "Include only expenses on or after this datetime" },
        { name: "toDate", type: "string (ISO datetime)", required: false, description: "Include only expenses on or before this datetime" },
        { name: "page", type: "number", required: false, description: "Page number (default: 1)" },
        { name: "limit", type: "number", required: false, description: "Results per page (default: 20)" },
      ],
      output: {
        description: "Paginated result with expense records and total count.",
        example: {
          data: [
            {
              id: "exp-uuid",
              businessId: "biz-uuid",
              category: "Transport",
              description: "Auto to client site",
              amount: "250.00",
              mode: "cash",
              expenseDate: "2026-03-01T00:00:00.000Z",
              createdByUserId: "user-uuid",
              createdByName: "Rahul Sharma",
              deletedAt: null,
            },
          ],
          total: 42,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/expense.list?input=%7B%22json%22%3A%7B%22page%22%3A1%2C%22limit%22%3A20%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const result = await trpc.expense.list.query({
  page: 1,
  limit: 20,
  category: "Transport",
  fromDate: "2026-04-01T00:00:00.000Z",
});
console.log(result.data, result.total);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"page": 1, "limit": 20}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/expense.list?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
data = resp.json()["result"]["data"]["json"]`,
      },
    },
    {
      id: "expense-create",
      method: "mutation",
      path: "expense.create",
      title: "Create Expense",
      description: "Record a new business expense. The `createdByUserId` and `createdByName` are set automatically from the authenticated session. Requires `member` role or above.",
      auth: "business",
      input: [
        { name: "category", type: "string", required: true, description: "Expense category (1–100 chars), e.g. 'Transport', 'Office Supplies'" },
        { name: "description", type: "string", required: false, description: "Optional description (max 500 chars)" },
        { name: "amount", type: "string (decimal)", required: true, description: "Amount as a decimal string, e.g. '1500.00'" },
        { name: "mode", type: "'cash' | 'bank' | 'upi' | 'cheque' | 'other'", required: true, description: "Payment mode used" },
        { name: "expenseDate", type: "string (ISO datetime)", required: false, description: "Date of the expense. Defaults to now." },
        { name: "referenceNumber", type: "string", required: false, description: "Optional reference number or receipt number (max 100 chars)" },
      ],
      output: {
        description: "The created expense record.",
        example: {
          id: "exp-uuid",
          businessId: "biz-uuid",
          category: "Transport",
          description: "Auto to client site",
          amount: "250.00",
          mode: "cash",
          expenseDate: "2026-03-01T00:00:00.000Z",
          referenceNumber: null,
          createdByUserId: "user-uuid",
          createdByName: "Rahul Sharma",
          deletedAt: null,
          createdAt: "2026-03-01T10:00:00.000Z",
          updatedAt: "2026-03-01T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/expense.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"category":"Transport","amount":"250.00","mode":"cash","expenseDate":"2026-03-01T00:00:00.000Z"}}'`,
        javascript: `const expense = await trpc.expense.create.mutate({
  category: "Transport",
  description: "Auto to client site",
  amount: "250.00",
  mode: "cash",
  expenseDate: new Date().toISOString(),
});`,
        python: `import httpx

resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/expense.create",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "category": "Transport",
        "amount": "250.00",
        "mode": "cash",
    }},
)
expense = resp.json()["result"]["data"]["json"]`,
      },
    },
    {
      id: "expense-update",
      method: "mutation",
      path: "expense.update",
      title: "Update Expense",
      description: "Partially update an existing expense. All fields from `createExpenseSchema` are optional — only the provided fields are updated. Requires `member` role or above.",
      auth: "business",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "ID of the expense to update" },
        { name: "data.category", type: "string", required: false, description: "New category" },
        { name: "data.description", type: "string", required: false, description: "New description" },
        { name: "data.amount", type: "string (decimal)", required: false, description: "New amount" },
        { name: "data.mode", type: "'cash' | 'bank' | 'upi' | 'cheque' | 'other'", required: false, description: "New payment mode" },
        { name: "data.expenseDate", type: "string (ISO datetime)", required: false, description: "New expense date" },
        { name: "data.referenceNumber", type: "string", required: false, description: "New reference number" },
      ],
      output: {
        description: "The updated expense record.",
        example: {
          id: "exp-uuid",
          category: "Travel",
          amount: "500.00",
          mode: "upi",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/expense.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"exp-uuid","data":{"amount":"500.00","mode":"upi"}}}'`,
        javascript: `const updated = await trpc.expense.update.mutate({
  id: "exp-uuid",
  data: { amount: "500.00", mode: "upi" },
});`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/expense.update",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "exp-uuid", "data": {"amount": "500.00"}}},
)`,
      },
      gotchas: [
        "Returns NOT_FOUND if the expense ID does not belong to the active business.",
      ],
    },
    {
      id: "expense-delete",
      method: "mutation",
      path: "expense.delete",
      title: "Delete Expense",
      description: "Soft-delete an expense by setting its `deletedAt` timestamp. The record is not physically removed. Calling delete on an already-deleted expense is a no-op. Requires `admin` role.",
      auth: "business",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "ID of the expense to delete" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/expense.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"exp-uuid"}}'`,
        javascript: `await trpc.expense.delete.mutate({ id: "exp-uuid" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/expense.delete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "exp-uuid"}},
)`,
      },
      gotchas: [
        "Soft-delete only — the record remains in the database with `deletedAt` set.",
        "Requires `admin` role. Members cannot delete expenses.",
        "Idempotent: calling delete on an already-deleted expense returns `{success: true}` without error.",
      ],
    },
    {
      id: "expense-categories",
      method: "query",
      path: "expense.categories",
      title: "List Categories",
      description: "Returns a distinct list of all expense category strings that have been used in the active business (excluding soft-deleted records). Useful for autocomplete inputs.",
      auth: "business",
      input: [],
      output: {
        description: "Array of category strings sorted alphabetically.",
        example: ["Meals", "Office Supplies", "Rent", "Transport"],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/expense.categories" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const categories = await trpc.expense.categories.query();
// Use for autocomplete: ["Meals", "Rent", "Transport", ...]`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/expense.categories",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)
categories = resp.json()["result"]["data"]["json"]`,
      },
    },
    {
      id: "expense-summary",
      method: "query",
      path: "expense.summary",
      title: "Expense Summary",
      description: "Returns total amount and count of expenses grouped by category for a given date range. Results are ordered by total amount descending. Use this to build expense breakdown charts or widgets.",
      auth: "business",
      input: [
        { name: "from", type: "string (ISO datetime)", required: false, description: "Start of the date range" },
        { name: "to", type: "string (ISO datetime)", required: false, description: "End of the date range" },
      ],
      output: {
        description: "Array of category totals sorted by amount descending.",
        example: [
          { category: "Transport", total: "8500.00", count: 34 },
          { category: "Meals", total: "3200.00", count: 12 },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/expense.summary?input=%7B%22json%22%3A%7B%22from%22%3A%222026-04-01T00%3A00%3A00.000Z%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const summary = await trpc.expense.summary.query({
  from: "2026-04-01T00:00:00.000Z",
  to: "2027-03-31T23:59:59.999Z",
});
summary.forEach(({ category, total }) => console.log(category, total));`,
        python: `import urllib.parse, json

params = urllib.parse.quote(json.dumps({"json": {"from": "2026-04-01T00:00:00.000Z"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/expense.summary?input={params}",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
)
summary = resp.json()["result"]["data"]["json"]`,
      },
      relatedEndpoints: ["expense-list"],
    },
  ],
};
