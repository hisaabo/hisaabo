import type { EndpointGroup } from "./types";

export const bankAccountEndpoints: EndpointGroup = {
  id: "bank-accounts",
  title: "Bank Accounts",
  description: "Manage bank accounts, record transactions, and configure payment gateways. Supports inter-account transfers with atomic dual-entry. Payment gateway configuration for Razorpay integration with auto-charge and settlement tracking.",
  endpoints: [
    {
      id: "bank-account-list",
      method: "query",
      path: "bankAccount.list",
      title: "List Bank Accounts",
      description: "Returns all bank accounts for the active business, ordered by default account first, then alphabetically by account name. Includes cash-in-hand, savings, current, and payment gateway accounts.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Array of bank account objects, sorted with default account first.",
        example: [
          {
            id: "ba-uuid-1",
            businessId: "biz-uuid",
            accountName: "HDFC Current Account",
            accountNumber: "50200012345678",
            ifsc: "HDFC0001234",
            bankName: "HDFC Bank",
            accountType: "current",
            openingBalance: "250000.00",
            currentBalance: "487350.00",
            isDefault: true,
            createdAt: "2026-01-15T10:00:00.000Z",
            updatedAt: "2026-04-05T14:30:00.000Z",
          },
          {
            id: "ba-uuid-2",
            businessId: "biz-uuid",
            accountName: "Cash in Hand",
            accountNumber: null,
            ifsc: null,
            bankName: null,
            accountType: "cash",
            openingBalance: "50000.00",
            currentBalance: "32750.00",
            isDefault: false,
            createdAt: "2026-01-15T10:00:00.000Z",
            updatedAt: "2026-04-02T09:15:00.000Z",
          },
        ],
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/bankAccount.list" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const accounts = await trpc.bankAccount.list.query();

const totalBalance = accounts.reduce(
  (sum, a) => sum + Number(a.currentBalance), 0
);
console.log(\`Total across \${accounts.length} accounts: \u20B9\${totalBalance}\`);`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/bankAccount.list",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
accounts = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns all account types including `cash`, `savings`, `current`, and `payment_gateway`. Filter client-side if needed.",
        "The default account (isDefault=true) is always sorted first. Only one account can be default at a time.",
        "Monetary values (`openingBalance`, `currentBalance`) are strings to preserve decimal precision.",
      ],
    },
    {
      id: "bank-account-get-by-id",
      method: "query",
      path: "bankAccount.getById",
      title: "Get Bank Account",
      description: "Fetch a single bank account by ID, including the 20 most recent transactions. Returns `null` if the account does not exist or belongs to a different business.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Bank account ID" },
      ],
      output: {
        description: "Bank account object with `recentTransactions` array (up to 20, newest first).",
        example: {
          id: "ba-uuid-1",
          accountName: "HDFC Current Account",
          accountNumber: "50200012345678",
          ifsc: "HDFC0001234",
          bankName: "HDFC Bank",
          accountType: "current",
          openingBalance: "250000.00",
          currentBalance: "487350.00",
          isDefault: true,
          recentTransactions: [
            {
              id: "bt-uuid-1",
              bankAccountId: "ba-uuid-1",
              type: "deposit",
              amount: "26250.00",
              description: "Payment received from Gupta Enterprises - INV-00043",
              referenceType: "payment",
              referenceId: "pay-uuid",
              transactionDate: "2026-04-05T00:00:00.000Z",
              createdAt: "2026-04-05T14:30:00.000Z",
            },
          ],
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/bankAccount.getById?input=%7B%22json%22%3A%7B%22id%22%3A%22ba-uuid-1%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const account = await trpc.bankAccount.getById.query({ id: "ba-uuid-1" });

if (!account) {
  console.log("Account not found");
  return;
}

console.log(\`\${account.accountName}: \u20B9\${account.currentBalance}\`);
console.log(\`Recent txns: \${account.recentTransactions.length}\`);`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"id": "ba-uuid-1"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/bankAccount.getById?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
account = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns `null` (not an error) when the account is not found. Always check for null before accessing properties.",
        "The `recentTransactions` array is limited to 20 entries. Use `bankAccount.listTransactions` for full paginated history.",
      ],
      relatedEndpoints: ["bank-account-list-transactions"],
    },
    {
      id: "bank-account-create",
      method: "mutation",
      path: "bankAccount.create",
      title: "Create Bank Account",
      description: "Add a new bank account to the business. If `isDefault` is true, the existing default account (if any) is automatically un-flagged in the same transaction. The `currentBalance` is initialized to the `openingBalance`.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "accountName", type: "string", required: true, description: "Display name, e.g. \"HDFC Current Account\", \"Petty Cash\"" },
        { name: "accountNumber", type: "string", required: false, description: "Bank account number. Omit for cash accounts." },
        { name: "ifsc", type: "string", required: false, description: "IFSC code, e.g. \"HDFC0001234\", \"SBIN0005432\"" },
        { name: "bankName", type: "string", required: false, description: "Bank name, e.g. \"HDFC Bank\", \"State Bank of India\"" },
        { name: "accountType", type: "enum", required: true, description: "Type of account", enumValues: ["savings", "current", "cash", "payment_gateway"] },
        { name: "openingBalance", type: "string (decimal)", required: false, description: "Opening balance as decimal string. Defaults to \"0.00\".", default: "0" },
        { name: "isDefault", type: "boolean", required: false, description: "Set as the default account for payments. Only one account can be default.", default: "false" },
      ],
      output: {
        description: "Created bank account with `currentBalance` set to `openingBalance`.",
        example: {
          id: "ba-uuid-new",
          businessId: "biz-uuid",
          accountName: "SBI Savings Account",
          accountNumber: "30987654321",
          ifsc: "SBIN0005432",
          bankName: "State Bank of India",
          accountType: "savings",
          openingBalance: "150000.00",
          currentBalance: "150000.00",
          isDefault: false,
          createdAt: "2026-04-08T10:00:00.000Z",
          updatedAt: "2026-04-08T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankAccount.create \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "accountName": "SBI Savings Account",
      "accountNumber": "30987654321",
      "ifsc": "SBIN0005432",
      "bankName": "State Bank of India",
      "accountType": "savings",
      "openingBalance": "150000.00",
      "isDefault": false
    }
  }'`,
        javascript: `const account = await trpc.bankAccount.create.mutate({
  accountName: "SBI Savings Account",
  accountNumber: "30987654321",
  ifsc: "SBIN0005432",
  bankName: "State Bank of India",
  accountType: "savings",
  openingBalance: "150000.00",  // \u20B91,50,000
  isDefault: false,
});

console.log("Created:", account.accountName);`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/bankAccount.create",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "accountName": "SBI Savings Account",
        "accountNumber": "30987654321",
        "ifsc": "SBIN0005432",
        "bankName": "State Bank of India",
        "accountType": "savings",
        "openingBalance": "150000.00",
        "isDefault": False,
    }},
)
account = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Setting `isDefault: true` atomically un-flags the current default account. There is no need to manually un-default the previous one.",
        "`currentBalance` is automatically set to `openingBalance` on creation. You cannot set it directly.",
        "For payment gateway accounts (Razorpay), set `accountType: \"payment_gateway\"` and then configure the gateway via `bankAccount.upsertGatewayConfig`.",
        "Opening balance is a string, not a number. Passing a number will fail validation.",
      ],
      relatedEndpoints: ["bank-account-upsert-gateway-config"],
    },
    {
      id: "bank-account-update",
      method: "mutation",
      path: "bankAccount.update",
      title: "Update Bank Account",
      description: "Update bank account details (name, account number, IFSC, etc.). If `isDefault` is set to true, the existing default account is atomically un-flagged. Ownership is verified before update.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Bank account ID to update" },
        { name: "data.accountName", type: "string", required: false, description: "Updated display name" },
        { name: "data.accountNumber", type: "string", required: false, description: "Updated account number" },
        { name: "data.ifsc", type: "string", required: false, description: "Updated IFSC code" },
        { name: "data.bankName", type: "string", required: false, description: "Updated bank name" },
        { name: "data.isDefault", type: "boolean", required: false, description: "Set as default account" },
      ],
      output: {
        description: "Updated bank account object.",
        example: {
          id: "ba-uuid-1",
          accountName: "HDFC Current A/C - Main",
          accountNumber: "50200012345678",
          ifsc: "HDFC0001234",
          bankName: "HDFC Bank",
          accountType: "current",
          isDefault: true,
          updatedAt: "2026-04-08T11:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankAccount.update \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "id": "ba-uuid-1",
      "data": { "accountName": "HDFC Current A/C - Main", "isDefault": true }
    }
  }'`,
        javascript: `const updated = await trpc.bankAccount.update.mutate({
  id: "ba-uuid-1",
  data: {
    accountName: "HDFC Current A/C - Main",
    isDefault: true,
  },
});`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/bankAccount.update",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {
        "id": "ba-uuid-1",
        "data": {"accountName": "HDFC Current A/C - Main", "isDefault": True},
    }},
)`,
      },
      gotchas: [
        "You cannot change `accountType` after creation. Create a new account instead.",
        "The `data` wrapper is required around the fields to update. Passing fields at the top level will fail.",
        "Returns NOT_FOUND (404) if the account belongs to a different business.",
      ],
    },
    {
      id: "bank-account-delete",
      method: "mutation",
      path: "bankAccount.delete",
      title: "Delete Bank Account",
      description: "Permanently delete a bank account. Fails if the account has any transactions. Requires admin role. An audit log entry is created for every deletion.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "id", type: "string (UUID)", required: true, description: "Bank account ID to delete" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankAccount.delete \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"id":"ba-uuid-1"}}'`,
        javascript: `await trpc.bankAccount.delete.mutate({ id: "ba-uuid-1" });`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/bankAccount.delete",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"id": "ba-uuid-1"}},
)`,
      },
      gotchas: [
        "This is a hard delete, not soft delete. The account is permanently removed from the database.",
        "Cannot delete an account that has transactions. You must delete all transactions first. The error message includes the transaction count.",
        "Requires `admin` role. Members and viewers will get a FORBIDDEN error.",
      ],
    },
    {
      id: "bank-account-list-transactions",
      method: "query",
      path: "bankAccount.listTransactions",
      title: "List Transactions",
      description: "Paginated list of transactions for a specific bank account. Supports filtering by date range and transaction type. Each row includes a computed `balanceAfter` column showing the running balance from the opening balance.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "bankAccountId", type: "string (UUID)", required: true, description: "Bank account to list transactions for" },
        { name: "fromDate", type: "string (ISO 8601)", required: false, description: "Start of date range (inclusive)" },
        { name: "toDate", type: "string (ISO 8601)", required: false, description: "End of date range (inclusive)" },
        { name: "type", type: "enum", required: false, description: "Filter by transaction type", enumValues: ["deposit", "withdrawal", "transfer"] },
        { name: "page", type: "number", required: false, description: "Page number (1-indexed)", default: "1" },
        { name: "limit", type: "number", required: false, description: "Items per page (1-100)", default: "20" },
      ],
      output: {
        description: "Paginated transaction list with running balance.",
        example: {
          data: [
            {
              id: "bt-uuid-1",
              businessId: "biz-uuid",
              bankAccountId: "ba-uuid-1",
              type: "deposit",
              amount: "26250.00",
              description: "Payment received from Gupta Enterprises - INV-00043",
              referenceType: "payment",
              referenceId: "pay-uuid",
              transactionDate: "2026-04-05T00:00:00.000Z",
              createdAt: "2026-04-05T14:30:00.000Z",
              balanceAfter: "487350.00",
            },
          ],
          total: 42,
          page: 1,
          limit: 20,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/bankAccount.listTransactions?input=%7B%22json%22%3A%7B%22bankAccountId%22%3A%22ba-uuid-1%22%2C%22page%22%3A1%2C%22limit%22%3A20%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const { data, total } = await trpc.bankAccount.listTransactions.query({
  bankAccountId: "ba-uuid-1",
  fromDate: "2026-04-01T00:00:00.000Z",
  toDate: "2026-04-30T23:59:59.000Z",
  page: 1,
  limit: 50,
});

console.log(\`Showing \${data.length} of \${total} transactions\`);
// Each row has balanceAfter for running balance display`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {
    "bankAccountId": "ba-uuid-1",
    "fromDate": "2026-04-01T00:00:00.000Z",
    "toDate": "2026-04-30T23:59:59.000Z",
    "page": 1,
    "limit": 20,
}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/bankAccount.listTransactions?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
result = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "The `balanceAfter` is a computed running balance starting from the account's `openingBalance`. It is calculated using a window function over all transactions, not just the current page.",
        "Results are ordered newest-first (descending by transaction date). The `balanceAfter` computation still runs chronologically.",
        "The bank account must belong to the current business. Returns NOT_FOUND if it does not.",
      ],
    },
    {
      id: "bank-account-add-transaction",
      method: "mutation",
      path: "bankAccount.addTransaction",
      title: "Add Transaction",
      description: "Record a manual transaction (deposit or withdrawal) against a bank account. The account's `currentBalance` is atomically updated using a row-level lock (`SELECT...FOR UPDATE`) to prevent race conditions.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "bankAccountId", type: "string (UUID)", required: true, description: "Target bank account" },
        { name: "type", type: "enum", required: true, description: "Transaction direction", enumValues: ["deposit", "withdrawal"] },
        { name: "amount", type: "string (decimal)", required: true, description: "Transaction amount as decimal string, e.g. \"5000.00\"" },
        { name: "description", type: "string", required: false, description: "Transaction description, e.g. \"Counter cash deposit\"" },
        { name: "referenceType", type: "string", required: false, description: "Link type: \"payment\", \"expense\", \"transfer\", etc." },
        { name: "referenceId", type: "string (UUID)", required: false, description: "ID of the linked entity" },
        { name: "transactionDate", type: "string (ISO 8601)", required: false, description: "Transaction date. Defaults to current timestamp." },
      ],
      output: {
        description: "Created transaction record.",
        example: {
          id: "bt-uuid-new",
          businessId: "biz-uuid",
          bankAccountId: "ba-uuid-1",
          type: "deposit",
          amount: "75000.00",
          description: "NEFT from Sharma Traders - INV-00055",
          referenceType: "payment",
          referenceId: "pay-uuid",
          transactionDate: "2026-04-08T00:00:00.000Z",
          createdAt: "2026-04-08T10:30:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankAccount.addTransaction \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "bankAccountId": "ba-uuid-1",
      "type": "deposit",
      "amount": "75000.00",
      "description": "NEFT from Sharma Traders - INV-00055",
      "referenceType": "payment",
      "referenceId": "pay-uuid",
      "transactionDate": "2026-04-08T00:00:00.000Z"
    }
  }'`,
        javascript: `const txn = await trpc.bankAccount.addTransaction.mutate({
  bankAccountId: "ba-uuid-1",
  type: "deposit",
  amount: "75000.00",           // \u20B975,000
  description: "NEFT from Sharma Traders - INV-00055",
  referenceType: "payment",
  referenceId: "pay-uuid",
  transactionDate: "2026-04-08T00:00:00.000Z",
});

console.log("Transaction recorded:", txn.id);`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/bankAccount.addTransaction",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "bankAccountId": "ba-uuid-1",
        "type": "deposit",
        "amount": "75000.00",
        "description": "NEFT from Sharma Traders - INV-00055",
        "referenceType": "payment",
        "referenceId": "pay-uuid",
        "transactionDate": "2026-04-08T00:00:00.000Z",
    }},
)
txn = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "The account balance is updated atomically using `SELECT...FOR UPDATE`. Concurrent transactions on the same account are serialized.",
        "For deposits and transfers, the amount is added to `currentBalance`. For withdrawals, it is subtracted. There is no overdraft check.",
        "Amount must be a string (decimal). Passing a number will fail Zod validation.",
        "Typically you do not call this directly. Payments and expenses auto-create bank transactions when a bank account is selected.",
      ],
      relatedEndpoints: ["bank-account-transfer"],
    },
    {
      id: "bank-account-transfer",
      method: "mutation",
      path: "bankAccount.transfer",
      title: "Inter-Account Transfer",
      description: "Transfer money between two bank accounts. Creates a withdrawal transaction on the source account and a deposit transaction on the destination account, atomically within a single PostgreSQL transaction. Accounts are locked in a consistent order (by UUID) to prevent deadlocks.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "fromAccountId", type: "string (UUID)", required: true, description: "Source bank account ID" },
        { name: "toAccountId", type: "string (UUID)", required: true, description: "Destination bank account ID" },
        { name: "amount", type: "string (decimal)", required: true, description: "Transfer amount as decimal string, e.g. \"100000.00\"" },
        { name: "description", type: "string", required: false, description: "Transfer description, e.g. \"Move to savings for GST payment\"" },
        { name: "transactionDate", type: "string (ISO 8601)", required: false, description: "Transfer date. Defaults to current timestamp." },
      ],
      output: {
        description: "Both transaction records: the withdrawal (from source) and deposit (to destination).",
        example: {
          withdrawal: {
            id: "bt-uuid-w",
            bankAccountId: "ba-hdfc-uuid",
            type: "withdrawal",
            amount: "100000.00",
            description: "Transfer to SBI Savings for GST payment",
            referenceType: "transfer",
            referenceId: "ba-sbi-uuid",
            transactionDate: "2026-04-08T00:00:00.000Z",
          },
          deposit: {
            id: "bt-uuid-d",
            bankAccountId: "ba-sbi-uuid",
            type: "deposit",
            amount: "100000.00",
            description: "Transfer from HDFC Current Account",
            referenceType: "transfer",
            referenceId: "ba-hdfc-uuid",
            transactionDate: "2026-04-08T00:00:00.000Z",
          },
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankAccount.transfer \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "fromAccountId": "ba-hdfc-uuid",
      "toAccountId": "ba-sbi-uuid",
      "amount": "100000.00",
      "description": "Move to savings for GST payment"
    }
  }'`,
        javascript: `const { withdrawal, deposit } = await trpc.bankAccount.transfer.mutate({
  fromAccountId: "ba-hdfc-uuid",   // HDFC Current Account
  toAccountId: "ba-sbi-uuid",      // SBI Savings Account
  amount: "100000.00",             // \u20B91,00,000
  description: "Move to savings for GST payment",
});

console.log("Withdrawn:", withdrawal.id);
console.log("Deposited:", deposit.id);`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/bankAccount.transfer",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "fromAccountId": "ba-hdfc-uuid",
        "toAccountId": "ba-sbi-uuid",
        "amount": "100000.00",
        "description": "Move to savings for GST payment",
    }},
)
result = resp.json()["result"]["data"]["json"]
print("Withdrawal:", result["withdrawal"]["id"])
print("Deposit:", result["deposit"]["id"])`,
      },
      gotchas: [
        "Cannot transfer to the same account. The API returns BAD_REQUEST if `fromAccountId === toAccountId`.",
        "Both accounts are locked using `SELECT...FOR UPDATE` in a consistent order (sorted by UUID) to prevent deadlocks.",
        "Both accounts must belong to the same business. Returns NOT_FOUND if either is missing.",
        "If no description is provided, the API auto-generates one like \"Transfer to account {toAccountId}\".",
        "The two transactions are linked via `referenceType: \"transfer\"` with `referenceId` pointing to the other account.",
      ],
      relatedEndpoints: ["bank-account-add-transaction"],
    },
    {
      id: "bank-account-summary",
      method: "query",
      path: "bankAccount.summary",
      title: "Account Summary",
      description: "Returns an aggregate summary across all bank accounts: total balance, cash-in-hand balance, bank balance (non-cash), and total account count. Useful for dashboard widgets.",
      auth: "business",
      requiredRole: "viewer",
      input: [],
      output: {
        description: "Aggregated balance summary across all accounts.",
        example: {
          totalBalance: "520100.00",
          cashInHand: "32750.00",
          bankBalance: "487350.00",
          accountCount: 3,
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/bankAccount.summary" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const summary = await trpc.bankAccount.summary.query();

console.log(\`Total: \u20B9\${summary.totalBalance}\`);
console.log(\`Cash: \u20B9\${summary.cashInHand}\`);
console.log(\`Bank: \u20B9\${summary.bankBalance}\`);
console.log(\`Accounts: \${summary.accountCount}\`);`,
        python: `resp = httpx.get(
    "https://api.hisaabo.in/api/trpc/bankAccount.summary",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
summary = resp.json()["result"]["data"]["json"]
print(f"Total: {summary['totalBalance']}")`,
      },
      gotchas: [
        "`cashInHand` only includes accounts where `accountType = 'cash'`. All other types (savings, current, payment_gateway) are summed into `bankBalance`.",
        "Returns \"0\" and `accountCount: 0` if the business has no bank accounts, not an error.",
        "All monetary values are strings. Do not use `parseFloat` for arithmetic.",
      ],
    },
    {
      id: "bank-account-get-gateway-config",
      method: "query",
      path: "bankAccount.getGatewayConfig",
      title: "Get Gateway Config",
      description: "Fetch the payment gateway configuration for a bank account. Returns the Razorpay integration settings including settlement account, charge configuration, and auto-settle flag. Returns `null` if no config exists.",
      auth: "business",
      requiredRole: "viewer",
      input: [
        { name: "bankAccountId", type: "string (UUID)", required: true, description: "The payment_gateway bank account ID" },
      ],
      output: {
        description: "Gateway configuration object, or `null` if not configured.",
        example: {
          id: "pgc-uuid",
          businessId: "biz-uuid",
          bankAccountId: "ba-razorpay-uuid",
          settlementAccountId: "ba-hdfc-uuid",
          chargeConfig: { flatFee: "2.00", percentFee: "2.00" },
          expenseCategory: "Payment Gateway Charges",
          autoSettle: true,
          createdAt: "2026-03-01T10:00:00.000Z",
          updatedAt: "2026-03-01T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl "https://api.hisaabo.in/api/trpc/bankAccount.getGatewayConfig?input=%7B%22json%22%3A%7B%22bankAccountId%22%3A%22ba-razorpay-uuid%22%7D%7D" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID"`,
        javascript: `const config = await trpc.bankAccount.getGatewayConfig.query({
  bankAccountId: "ba-razorpay-uuid",
});

if (config) {
  console.log("Settlement to:", config.settlementAccountId);
  console.log("Auto-settle:", config.autoSettle);
}`,
        python: `import httpx, json, urllib.parse

params = urllib.parse.quote(json.dumps({"json": {"bankAccountId": "ba-razorpay-uuid"}}))
resp = httpx.get(
    f"https://api.hisaabo.in/api/trpc/bankAccount.getGatewayConfig?input={params}",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
)
config = resp.json()["result"]["data"]["json"]`,
      },
      gotchas: [
        "Returns `null` (not an error) if no gateway config has been set up for this account.",
        "Only meaningful for accounts with `accountType: \"payment_gateway\"`. Querying a regular bank account will return `null`.",
      ],
      relatedEndpoints: ["bank-account-upsert-gateway-config", "bank-account-delete-gateway-config"],
    },
    {
      id: "bank-account-upsert-gateway-config",
      method: "mutation",
      path: "bankAccount.upsertGatewayConfig",
      title: "Upsert Gateway Config",
      description: "Create or update the payment gateway configuration for a bank account. Uses PostgreSQL `ON CONFLICT DO UPDATE` for atomic upsert. The bank account must be of type `payment_gateway`, and the settlement account must NOT be a `payment_gateway` type.",
      auth: "business",
      requiredRole: "member",
      input: [
        { name: "bankAccountId", type: "string (UUID)", required: true, description: "The payment_gateway bank account to configure" },
        { name: "settlementAccountId", type: "string (UUID)", required: true, description: "Target account for settlements (must not be a payment_gateway)" },
        { name: "chargeConfig", type: "object", required: false, description: "Fee structure: { flatFee: \"2.00\", percentFee: \"2.00\" }" },
        { name: "expenseCategory", type: "string", required: false, description: "Expense category for auto-created gateway charge expenses" },
        { name: "autoSettle", type: "boolean", required: false, description: "Automatically create settlement transactions when payments arrive", default: "true" },
      ],
      output: {
        description: "The created or updated gateway configuration.",
        example: {
          id: "pgc-uuid",
          businessId: "biz-uuid",
          bankAccountId: "ba-razorpay-uuid",
          settlementAccountId: "ba-hdfc-uuid",
          chargeConfig: { flatFee: "2.00", percentFee: "2.00" },
          expenseCategory: "Payment Gateway Charges",
          autoSettle: true,
          createdAt: "2026-04-08T10:00:00.000Z",
          updatedAt: "2026-04-08T10:00:00.000Z",
        },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankAccount.upsertGatewayConfig \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{
    "json": {
      "bankAccountId": "ba-razorpay-uuid",
      "settlementAccountId": "ba-hdfc-uuid",
      "chargeConfig": { "flatFee": "2.00", "percentFee": "2.00" },
      "expenseCategory": "Payment Gateway Charges",
      "autoSettle": true
    }
  }'`,
        javascript: `const config = await trpc.bankAccount.upsertGatewayConfig.mutate({
  bankAccountId: "ba-razorpay-uuid",
  settlementAccountId: "ba-hdfc-uuid",
  chargeConfig: {
    flatFee: "2.00",       // \u20B92 flat fee per txn
    percentFee: "2.00",    // 2% of transaction amount
  },
  expenseCategory: "Payment Gateway Charges",
  autoSettle: true,
});`,
        python: `resp = httpx.post(
    "https://api.hisaabo.in/api/trpc/bankAccount.upsertGatewayConfig",
    headers={
        "Authorization": f"Bearer {session_token}",
        "x-business-id": business_id,
    },
    json={"json": {
        "bankAccountId": "ba-razorpay-uuid",
        "settlementAccountId": "ba-hdfc-uuid",
        "chargeConfig": {"flatFee": "2.00", "percentFee": "2.00"},
        "expenseCategory": "Payment Gateway Charges",
        "autoSettle": True,
    }},
)`,
      },
      gotchas: [
        "The `bankAccountId` must reference an account with `accountType: \"payment_gateway\"`. Any other type returns BAD_REQUEST.",
        "The `settlementAccountId` must NOT be a `payment_gateway` account. This prevents circular settlement loops.",
        "This is an upsert: if a config already exists for this `bankAccountId`, it is updated. No need to check existence first.",
        "When `autoSettle` is true, every payment received through the gateway automatically creates a settlement transfer to the settlement account and an expense for gateway charges.",
      ],
      relatedEndpoints: ["bank-account-get-gateway-config", "bank-account-create"],
    },
    {
      id: "bank-account-delete-gateway-config",
      method: "mutation",
      path: "bankAccount.deleteGatewayConfig",
      title: "Delete Gateway Config",
      description: "Remove the payment gateway configuration from a bank account. Requires admin role. The bank account itself is not deleted.",
      auth: "business",
      requiredRole: "admin",
      input: [
        { name: "bankAccountId", type: "string (UUID)", required: true, description: "The payment_gateway bank account whose config should be removed" },
      ],
      output: {
        description: "Success confirmation.",
        example: { success: true },
      },
      codeExamples: {
        curl: `curl -X POST https://api.hisaabo.in/api/trpc/bankAccount.deleteGatewayConfig \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \\
  -H "x-business-id: YOUR_BUSINESS_ID" \\
  -d '{"json":{"bankAccountId":"ba-razorpay-uuid"}}'`,
        javascript: `await trpc.bankAccount.deleteGatewayConfig.mutate({
  bankAccountId: "ba-razorpay-uuid",
});`,
        python: `httpx.post(
    "https://api.hisaabo.in/api/trpc/bankAccount.deleteGatewayConfig",
    headers={"Authorization": f"Bearer {session_token}", "x-business-id": business_id},
    json={"json": {"bankAccountId": "ba-razorpay-uuid"}},
)`,
      },
      gotchas: [
        "Returns NOT_FOUND if no gateway config exists for this account.",
        "Deleting the config does not delete the bank account itself. The account remains as a `payment_gateway` type but without active gateway integration.",
        "Existing settlement and charge records are not affected. Only future auto-settle behavior stops.",
      ],
      relatedEndpoints: ["bank-account-upsert-gateway-config"],
    },
  ],
};
