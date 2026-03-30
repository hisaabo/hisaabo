import * as readline from "readline";
import { HisaaboClient, HisaaboApiError, type BankAccountSummary, type BankTransactionRow } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, paginationFooter, EXIT, success, type ColumnDef,
} from "../../output.js";
import { formatAmount, formatDate, formatINR } from "../../format.js";

async function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

export async function bankListCommand(opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const [accounts, summary] = await Promise.all([
      client.bankAccount.list(),
      client.bankAccount.summary(),
    ]);

    if (opts.json) {
      outputJSON({ accounts, summary });
      return;
    }

    console.log("\n Bank Accounts\n");
    console.log(` ${"═".repeat(60)}\n`);

    const cols: ColumnDef<BankAccountSummary>[] = [
      { key: "accountName", header: "Name", width: 22 },
      { key: "bankName", header: "Bank", width: 16, format: (v) => String(v ?? "-") },
      { key: "accountType", header: "Type", width: 10 },
      { key: "accountNumber", header: "Account #", width: 16, format: (v) => String(v ?? "-") },
      { key: "currentBalance", header: "Balance (₹)", align: "right", width: 14, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "isDefault", header: "Default", width: 8, format: (v) => v ? "Yes" : "" },
    ];

    outputTable(accounts, cols);
    console.log(`\n  Total Balance: ${formatINR(summary.totalBalance)}`);
    console.log(`  Cash in Hand:  ${formatINR(summary.cashInHand)}`);
    console.log(`  Bank Balance:  ${formatINR(summary.bankBalance)}\n`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function bankGetCommand(id: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const account = await client.bankAccount.get(id);
    if (!account) fatalError(`Bank account not found: ${id}`, EXIT.NOT_FOUND);

    if (opts.json) {
      outputJSON(account);
      return;
    }

    console.log(`\n  ${account!.accountName} (${account!.accountType})`);
    console.log("  " + "─".repeat(45));
    if (account!.bankName) console.log(`  Bank:     ${account!.bankName}`);
    if (account!.accountNumber) console.log(`  Account:  ${account!.accountNumber}`);
    if (account!.ifsc) console.log(`  IFSC:     ${account!.ifsc}`);
    console.log(`  Balance:  ${formatINR(account!.currentBalance)}`);
    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function bankCreateCommand(opts: {
  json?: boolean;
  name?: string;
  type?: string;
  bank?: string;
  accountNumber?: string;
  ifsc?: string;
  openingBalance?: string;
  default?: boolean;
  yes?: boolean;
}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const isNonInteractive = !process.stdin.isTTY || opts.yes;

  let name = opts.name;
  let accountType = (opts.type ?? "current") as "savings" | "current" | "cash" | "credit" | "other";
  let bankName = opts.bank;
  let accountNumber = opts.accountNumber;
  let ifsc = opts.ifsc;
  let openingBalance = opts.openingBalance;

  if (!isNonInteractive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!name) name = (await prompt(rl, "  Account Name: ")).trim();
    const typeStr = await prompt(rl, "  Type (savings/current/cash/credit/other) [current]: ");
    accountType = (typeStr.trim() || "current") as typeof accountType;
    const bankStr = await prompt(rl, "  Bank Name: ");
    if (bankStr.trim()) bankName = bankStr.trim();
    const numStr = await prompt(rl, "  Account Number: ");
    if (numStr.trim()) accountNumber = numStr.trim();
    const ifscStr = await prompt(rl, "  IFSC: ");
    if (ifscStr.trim()) ifsc = ifscStr.trim();
    const balStr = await prompt(rl, "  Opening Balance [0]: ");
    openingBalance = balStr.trim() || "0";
    rl.close();
  }

  if (!name) fatalError("--name is required", EXIT.USAGE);

  try {
    const account = await client.bankAccount.create({
      accountName: name,
      accountType,
      bankName,
      accountNumber,
      ifsc,
      openingBalance,
      isDefault: opts.default,
    });

    if (opts.json) {
      outputJSON(account);
      return;
    }

    success(`Created: ${account.accountName}`);
    console.log(`  ID: ${account.id}\n`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function bankTransferCommand(opts: {
  json?: boolean;
  from?: string;
  to?: string;
  amount?: string;
  description?: string;
  date?: string;
}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  if (!opts.from) fatalError("--from account ID is required", EXIT.USAGE);
  if (!opts.to) fatalError("--to account ID is required", EXIT.USAGE);
  if (!opts.amount) fatalError("--amount is required", EXIT.USAGE);

  try {
    const result = await client.bankAccount.transfer({
      fromAccountId: opts.from,
      toAccountId: opts.to,
      amount: opts.amount,
      description: opts.description,
      transactionDate: opts.date,
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Transfer recorded: ${formatINR(opts.amount)}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function bankTransactionsCommand(accountId: string, opts: {
  json?: boolean;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    const result = await client.bankAccount.listTransactions({
      bankAccountId: accountId,
      fromDate: opts.from,
      toDate: opts.to,
      page,
      limit,
    });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    const cols: ColumnDef<BankTransactionRow>[] = [
      { key: "transactionDate", header: "Date", width: 13, format: (v) => formatDate(String(v ?? "")) },
      { key: "type", header: "Type", width: 12 },
      { key: "description", header: "Description", width: 25, format: (v) => String(v ?? "-") },
      { key: "amount", header: "Amount (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "balanceAfter", header: "Balance (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
    ];

    console.log(`\n Transactions for ${accountId}\n`);
    outputTable(result.data, cols);
    paginationFooter(result.page, result.limit, result.total);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
