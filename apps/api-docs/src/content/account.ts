import type { EndpointGroup } from "./types";

export const accountEndpoints: EndpointGroup = {
  id: "accounts",
  title: "Chart of Accounts",
  description: "Manage the Chart of Accounts. Seeded with 40 standard Indian accounts on business creation (Assets, Liabilities, Income, Expense groups). Accounts are referenced by journal entries, reports, and financial statements.",
  endpoints: [
    {
      id: "account-list",
      method: "query",
      path: "account.list",
      title: "List Accounts",
      description: "Returns all accounts in the Chart of Accounts for the active business, ordered by account code (ascending). Includes both system-seeded accounts and user-created custom accounts.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Array of all accounts, sorted by account code.",
        example: [
          {
            id: "acc-cash-uuid",
            businessId: "biz-uuid",
            code: "1000",
            name: "Cash",
            accountType: "asset",
            parentId: null,
            isSystem: true,
            isActive: true,
            createdAt: "2026-01-15T10:00:00.000Z",
            updatedAt: "2026-01-15T10:00:00.000Z",
          },
          {
            id: "acc-bank-uuid",
            businessId: "biz-uuid",
            code: "1010",
            name: "Bank Accounts",
            accountType: "asset",
            parentId: "acc-cash-uuid",
            isSystem: true,
            isActive: true,
            createdAt: "2026-01-15T10:00:00.000Z",
            updatedAt: "2026-01-15T10:00:00.000Z",
          },
          {
            id: "acc-receivable-uuid",
            businessId: "biz-uuid",
            code: "1100",
            name: "Accounts Receivable",
            accountType: "asset",
            parentId: null,
            isSystem: true,
            isActive: true,
            createdAt: "2026-01-15T10:00:00.000Z",
            updatedAt: "2026-01-15T10:00:00.000Z",
          },
          {
            id: "acc-gst-input-uuid",
            businessId: "biz-uuid",
            code: "1200",
            name: "GST Input Credit (CGST)",
            accountType: "asset",
            parentId: null,
            isSystem: true,
            isActive: true,
            createdAt: "2026-01-15T10:00:00.000Z",
            updatedAt: "2026-01-15T10:00:00.000Z",
          },
          {
            id: "acc-sales-uuid",
            businessId: "biz-uuid",
            code: "3000",
            name: "Sales Revenue",
            accountType: "income",
            parentId: null,
            isSystem: true,
            isActive: true,
            createdAt: "2026-01-15T10:00:00.000Z",
            updatedAt: "2026-01-15T10:00:00.000Z",
          },
          {
            id: "acc-custom-uuid",
            businessId: "biz-uuid",
            code: "4500",
            name: "Marketing Expenses",
            accountType: "expense",
            parentId: null,
            isSystem: false,
            isActive: true,
            createdAt: "2026-03-15T14:00:00.000Z",
            updatedAt: "2026-03-15T14:00:00.000Z",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/account.list" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const accounts = await trpc.account.list.query();

// Group by type for a tree view
const grouped = Object.groupBy(accounts, a => a.accountType);
console.log("Assets:", grouped.asset?.length ?? 0);
console.log("Liabilities:", grouped.liability?.length ?? 0);
console.log("Income:", grouped.income?.length ?? 0);
console.log("Expenses:", grouped.expense?.length ?? 0);`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/account.list",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
accounts = resp.json()["result"]["data"]["json"]

# Group by type
from itertools import groupby
for account_type, group in groupby(accounts, key=lambda a: a["accountType"]):
    items = list(group)
    print(f"{account_type}: {len(items)} accounts")`,
      },
      gotchas: [
        "Returns ALL accounts (active and inactive). Filter by `isActive: true` client-side if needed for dropdowns.",
        "System accounts (`isSystem: true`) are seeded on business creation and cannot be deleted. They can be renamed.",
        "Account codes are strings, not numbers. They are sorted lexicographically (\"1000\" < \"1010\" < \"1100\").",
        "The `parentId` field supports hierarchical account trees. Top-level accounts have `parentId: null`.",
      ],
      relatedEndpoints: ["journal-create"],
    },
    {
      id: "account-create",
      method: "mutation",
      path: "account.create",
      title: "Create Account",
      description: "Add a custom account to the Chart of Accounts. The account is created with `isSystem: false` and `isActive: true`. Use this for business-specific accounts not covered by the 40 seeded accounts (e.g. \"Marketing Expenses\", \"Vehicle Loan\").",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "code", type: "string", required: true, description: "Account code, e.g. \"4500\". Must be unique within the business." },
        { name: "name", type: "string", required: true, description: "Account name, e.g. \"Marketing Expenses\"" },
        { name: "accountType", type: "enum", required: true, description: "Account classification", enumValues: ["asset", "liability", "income", "expense", "equity"] },
        { name: "parentId", type: "string (UUID)", required: false, description: "Parent account ID for hierarchical grouping" },
      ],
      output: {
        description: "Created account.",
        example: {
          id: "acc-new-uuid",
          businessId: "biz-uuid",
          code: "4500",
          name: "Marketing Expenses",
          accountType: "expense",
          parentId: null,
          isSystem: false,
          isActive: true,
          createdAt: "2026-04-08T10:00:00.000Z",
          updatedAt: "2026-04-08T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/account.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "code": "4500",
      "name": "Marketing Expenses",
      "accountType": "expense"
    }
  }'`,
        javascript: `const account = await trpc.account.create.mutate({
  code: "4500",
  name: "Marketing Expenses",
  accountType: "expense",
});

console.log(\`Created: \${account.code} - \${account.name}\`);`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/account.create",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "code": "4500",
        "name": "Marketing Expenses",
        "accountType": "expense",
    }},
)
account = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Account code must be unique within the business. A duplicate code will cause a database constraint error.",
        "Requires `admin` role. Members and viewers cannot create accounts.",
        "The `accountType` determines which financial statement the account appears in: asset/liability on Balance Sheet, income/expense on P&L.",
        "Custom accounts are created with `isSystem: false`, meaning they can be deleted later (unlike seeded accounts).",
      ],
      relatedEndpoints: ["account-list"],
    },
    {
      id: "account-update",
      method: "mutation",
      path: "account.update",
      title: "Update Account",
      description: "Update an account's name or active status. Account code and type cannot be changed after creation. Both system and custom accounts can be renamed. Use `isActive: false` to hide accounts from dropdowns without deleting them.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Account ID to update" },
        { name: "name", type: "string", required: false, description: "Updated account name" },
        { name: "isActive", type: "boolean", required: false, description: "Set to false to deactivate (hide from dropdowns)" },
      ],
      output: {
        description: "Updated account.",
        example: {
          id: "acc-custom-uuid",
          code: "4500",
          name: "Digital Marketing Expenses",
          accountType: "expense",
          isSystem: false,
          isActive: true,
          updatedAt: "2026-04-08T11:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/account.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "id": "acc-custom-uuid",
      "name": "Digital Marketing Expenses"
    }
  }'`,
        javascript: `const updated = await trpc.account.update.mutate({
  id: "acc-custom-uuid",
  name: "Digital Marketing Expenses",
});

// Deactivate an account
await trpc.account.update.mutate({
  id: "acc-old-uuid",
  isActive: false,
});`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/account.update",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "acc-custom-uuid", "name": "Digital Marketing Expenses"}},
)`,
      },
      gotchas: [
        "Account `code` and `accountType` cannot be changed after creation. Only `name` and `isActive` can be updated.",
        "System accounts can be renamed but not deactivated. Attempting to set `isActive: false` on a system account has no effect since the update only applies provided fields.",
        "Returns NOT_FOUND if the account belongs to a different business.",
      ],
    },
    {
      id: "account-delete",
      method: "mutation",
      path: "account.delete",
      title: "Delete Account",
      description: "Permanently delete a custom account from the Chart of Accounts. System accounts (seeded on business creation) cannot be deleted. This is a hard delete.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Account ID to delete" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/account.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"acc-custom-uuid"}}'`,
        javascript: `await trpc.account.delete.mutate({ id: "acc-custom-uuid" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/account.delete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "acc-custom-uuid"}},
)`,
      },
      gotchas: [
        "System accounts (`isSystem: true`) CANNOT be deleted. The API returns FORBIDDEN with \"Cannot delete a system account\".",
        "If the account is referenced by journal entry lines, deletion will fail with a FK constraint error. Void or delete referencing entries first.",
        "Consider using `account.update` with `isActive: false` instead of deleting, to preserve historical references.",
        "This is a hard delete. There is no undo or soft-delete mechanism.",
      ],
      relatedEndpoints: ["account-update"],
    },
  ],
};
