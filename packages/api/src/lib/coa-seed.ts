import { chartOfAccounts } from "@hisaabo/db";

interface SeedAccount {
  code: string;
  name: string;
  accountType: "asset" | "liability" | "equity" | "income" | "expense";
}

// Default Indian SMB Chart of Accounts
const DEFAULT_ACCOUNTS: SeedAccount[] = [
  // Assets
  { code: "1000", name: "Cash in Hand", accountType: "asset" },
  { code: "1010", name: "Bank Accounts", accountType: "asset" },
  { code: "1100", name: "Accounts Receivable", accountType: "asset" },
  { code: "1200", name: "Inventory", accountType: "asset" },
  { code: "1300", name: "Advances to Suppliers", accountType: "asset" },
  { code: "1400", name: "Prepaid Expenses", accountType: "asset" },
  { code: "1500", name: "Fixed Assets", accountType: "asset" },
  { code: "1510", name: "Input CGST", accountType: "asset" },
  { code: "1511", name: "Input SGST", accountType: "asset" },
  { code: "1512", name: "Input IGST", accountType: "asset" },

  // Liabilities
  { code: "2000", name: "Accounts Payable", accountType: "liability" },
  { code: "2100", name: "Output CGST Payable", accountType: "liability" },
  { code: "2101", name: "Output SGST Payable", accountType: "liability" },
  { code: "2102", name: "Output IGST Payable", accountType: "liability" },
  { code: "2200", name: "TDS Payable", accountType: "liability" },
  { code: "2300", name: "Other Current Liabilities", accountType: "liability" },

  // Equity
  { code: "3000", name: "Capital Account", accountType: "equity" },
  { code: "3100", name: "Drawings", accountType: "equity" },
  { code: "3200", name: "Retained Earnings", accountType: "equity" },

  // Income
  { code: "4000", name: "Sales", accountType: "income" },
  { code: "4010", name: "Sales Returns", accountType: "income" },
  { code: "4100", name: "Other Income", accountType: "income" },
  { code: "4200", name: "Discount Received", accountType: "income" },

  // Expenses
  { code: "5000", name: "Purchases", accountType: "expense" },
  { code: "5010", name: "Purchase Returns", accountType: "expense" },
  { code: "5100", name: "Direct Expenses", accountType: "expense" },
  { code: "5200", name: "Salary & Wages", accountType: "expense" },
  { code: "5300", name: "Rent", accountType: "expense" },
  { code: "5400", name: "Electricity & Utilities", accountType: "expense" },
  { code: "5500", name: "Communication", accountType: "expense" },
  { code: "5600", name: "Conveyance & Travel", accountType: "expense" },
  { code: "5700", name: "Office Expenses", accountType: "expense" },
  { code: "5800", name: "Repairs & Maintenance", accountType: "expense" },
  { code: "5900", name: "Depreciation", accountType: "expense" },
  { code: "5950", name: "Bank Charges", accountType: "expense" },
  { code: "5960", name: "Payment Gateway Charges", accountType: "expense" },
  { code: "5970", name: "Bad Debts", accountType: "expense" },
  { code: "5980", name: "Professional Fees", accountType: "expense" },
  { code: "5990", name: "Miscellaneous Expenses", accountType: "expense" },
];

export async function seedChartOfAccounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, // Drizzle transaction or db instance
  businessId: string,
): Promise<void> {
  const values = DEFAULT_ACCOUNTS.map((a) => ({
    businessId,
    code: a.code,
    name: a.name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    accountType: a.accountType as any,
    isSystem: true,
    isActive: true,
  }));

  if (values.length > 0) {
    await tx.insert(chartOfAccounts).values(values);
  }
}

export { DEFAULT_ACCOUNTS };
