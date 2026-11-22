/**
 * golden-helpers.ts — the tiny shared kit behind the golden accounting suite.
 *
 * Every scenario seeds a business THROUGH THE REAL ROUTERS (business.create,
 * party.create, invoice.create, payment.create, ...), then reads the books back
 * through the report procedures and compares them with hand-computed literals.
 * See README.md in this folder for the purpose and the how-to.
 *
 * Conventions:
 *   - Money is always a string; the only arithmetic here is `money.*` (integer
 *     paise). Expected values in scenarios are written as literals, never
 *     computed with these helpers.
 *   - A "book" is the trial balance + P&L + balance sheet over one date range.
 *     Rows are flattened to string tuples so a scenario's expectation reads as
 *     a small table.
 */

import { afterAll, expect } from "vitest";
import { money } from "@hisaabo/shared";
import { createCallerFactory } from "../../../trpc.js";
import { appRouter } from "../../../router.js";
import { createUser, createTenant, addMember } from "../../helpers/fixtures.js";
import { truncateAllTables, closeTestDb } from "../../helpers/test-db.js";

const callerFactory = createCallerFactory(appRouter);
type Caller = ReturnType<typeof callerFactory>;

/** Register the per-file teardown every golden test file needs. Call once at the top. */
export function useGoldenDb(): void {
  afterAll(async () => {
    await truncateAllTables();
    await closeTestDb();
  });
}

// ── World ────────────────────────────────────────────────────────────────────

export interface GoldenWorld {
  caller: Caller;
  tenantId: string;
  businessId: string;
  userId: string;
  /** Chart-of-accounts id by account code, e.g. accounts["1100"]. */
  accounts: Record<string, string>;
}

let worldCounter = 0;

/**
 * A fresh owner + tenant + business created via `business.create` (which seeds
 * the default chart of accounts, TDS sections, the Cash account and the
 * walk-in party). The business is in Maharashtra (state code 27), financial
 * year starting 1 April. Each call is fully isolated by businessId.
 */
export async function createGoldenWorld(): Promise<GoldenWorld> {
  const n = ++worldCounter;
  const user = await createUser({ name: "Golden Owner" });
  const tenant = await createTenant({ name: `Golden Tenant ${n}` });
  await addMember(tenant.id, user.id, "owner");

  const ctxBase = {
    user: { id: user.id, email: user.email, name: user.name ?? null },
    tenantId: tenant.id,
    ipAddress: null,
    resHeaders: new Headers(),
  };
  const tenantCaller = callerFactory({
    ...ctxBase,
    businessId: null,
    req: new Request("http://localhost:3000/api/trpc/golden", { method: "POST" }),
  });

  const biz = await tenantCaller.business.create({
    name: `Golden Traders ${n}`,
    pan: "AABCU9603R",
    // 15-char GSTIN: only the trailing check char varies so each world is unique.
    gstin: `27AABCU9603R1Z${(n % 36).toString(36).toUpperCase()}`,
    gstRegistrationType: "regular",
    phone: "9876543210",
    address: "1 Golden Road, Mumbai",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
    pincode: "400001",
    currency: "INR",
  });

  const caller = callerFactory({
    ...ctxBase,
    businessId: biz.id,
    req: new Request("http://localhost:3000/api/trpc/golden", {
      method: "POST",
      headers: new Headers({ "x-business-id": biz.id }),
    }),
  });

  const coa = await caller.account.list();
  const accounts = Object.fromEntries(coa.map((a) => [a.code, a.id]));
  return { caller, tenantId: tenant.id, businessId: biz.id, userId: user.id, accounts };
}

// ── Seeding shortcuts (all go through routers) ───────────────────────────────

const STATES = {
  /** Same state as the business: sales/purchases split into CGST + SGST. */
  MH: { state: "Maharashtra", stateCode: "27" },
  /** Different state: sales/purchases carry IGST. */
  KA: { state: "Karnataka", stateCode: "29" },
} as const;

export function addParty(
  w: GoldenWorld,
  type: "customer" | "supplier",
  where: keyof typeof STATES,
  extra: { name?: string; openingBalance?: string } = {},
) {
  return w.caller.party.create({
    type,
    name: extra.name ?? `${type === "customer" ? "Customer" : "Supplier"} ${where}`,
    ...STATES[where],
    openingBalance: extra.openingBalance ?? "0",
  });
}

export interface Line {
  name: string;
  qty: string;
  price: string;
  /** GST percent, default "0". */
  tax?: string;
  /** Line discount percent, default "0". */
  discount?: string;
}

function toLineItems(lines: Line[]) {
  return lines.map((l) => ({
    itemName: l.name,
    quantity: l.qty,
    unitPrice: l.price,
    taxPercent: l.tax ?? "0",
    discountPercent: l.discount ?? "0",
  }));
}

/** Create an invoice (sale or purchase) and move it from draft to sent. */
export async function addInvoice(
  w: GoldenWorld,
  type: "sale" | "purchase",
  partyId: string,
  lines: Line[],
  opts: { date: string; roundOff?: string; invoiceDiscount?: string; additionalCharges?: string },
) {
  const inv = await w.caller.invoice.create({
    partyId,
    type,
    invoiceDate: opts.date,
    lineItems: toLineItems(lines),
    ...(opts.roundOff ? { roundOff: opts.roundOff } : {}),
    ...(opts.invoiceDiscount ? { invoiceDiscount: opts.invoiceDiscount } : {}),
    ...(opts.additionalCharges
      ? { charges: [{ label: "Packing", amount: opts.additionalCharges }] }
      : {}),
  });
  return w.caller.invoice.updateStatus({ id: inv.id, status: "sent" });
}

/** Create a credit note / sales return / debit note / purchase return. */
export function addAdjustmentDoc(
  w: GoldenWorld,
  kind: "creditNote" | "salesReturn" | "debitNote" | "purchaseReturn",
  type: "sale" | "purchase",
  partyId: string,
  lines: Line[],
  opts: { date: string; referenceDocumentId?: string },
) {
  return w.caller[kind].create({
    partyId,
    type,
    invoiceDate: opts.date,
    referenceDocumentId: opts.referenceDocumentId,
    lineItems: toLineItems(lines),
  });
}

/** Record a payment (received from a customer or made to a supplier), optionally against one invoice. */
export function addPayment(
  w: GoldenWorld,
  p: {
    partyId: string;
    amount: string;
    mode: "cash" | "bank" | "upi";
    date: string;
    invoiceId?: string;
    bankAccountId?: string;
    /** Customer-withheld TDS. `amount` is the NET cash; the allocation is amount + tds.amount. */
    tds?: { amount: string; section: string; rate: string };
  },
) {
  const allocations = p.invoiceId
    ? [
        {
          invoiceId: p.invoiceId,
          amount: p.tds ? money.add(p.amount, p.tds.amount) : p.amount,
          tdsAmount: p.tds?.amount ?? "0",
          tdsSectionCode: p.tds?.section,
          tdsRate: p.tds?.rate,
        },
      ]
    : undefined;
  return w.caller.payment.create({
    partyId: p.partyId,
    amount: p.amount,
    mode: p.mode,
    paymentDate: p.date,
    bankAccountId: p.bankAccountId,
    allocations,
  });
}

export function addBankAccount(
  w: GoldenWorld,
  name: string,
  opts: { type?: "current" | "savings"; openingBalance?: string } = {},
) {
  return w.caller.bankAccount.create({
    accountName: name,
    accountType: opts.type ?? "current",
    openingBalance: opts.openingBalance ?? "0",
    isDefault: false,
  });
}

// ── Reading the books ────────────────────────────────────────────────────────

export interface Range {
  from: string;
  to: string;
}

/** Everything from the dawn of time to the far future: the cumulative book. */
export const ALL_TIME: Range = {
  from: "2000-01-01T00:00:00.000Z",
  to: "2099-12-31T23:59:59.999Z",
};

/** Indian financial year `startYear`-(startYear+1): 1 April to 31 March, UTC instants. */
export function fy(startYear: number): Range {
  return {
    from: `${startYear}-04-01T00:00:00.000Z`,
    to: `${startYear + 1}-03-31T23:59:59.999Z`,
  };
}

export async function book(w: GoldenWorld, range: Range = ALL_TIME) {
  const [tb, pl, bs] = await Promise.all([
    w.caller.reports.trialBalance({ fromDate: range.from, asOfDate: range.to }),
    w.caller.reports.profitAndLoss({ fromDate: range.from, toDate: range.to }),
    // The balance sheet is always cumulative to the end date (no closing entries).
    w.caller.reports.balanceSheet({ asOfDate: range.to }),
  ]);
  return { tb, pl, bs };
}
export type Book = Awaited<ReturnType<typeof book>>;

/** The cash-flow statement over a range. Only assert it where the classification is unambiguous. */
export function cashFlow(w: GoldenWorld, range: Range = ALL_TIME) {
  return w.caller.reports.cashFlowStatement({ fromDate: range.from, toDate: range.to });
}
export type CashFlow = Awaited<ReturnType<typeof cashFlow>>;

/**
 * The cash-flow statement must reconcile to the cash + bank ledgers: net cash flow
 * is the net debit movement of 1000 + 1010, it equals operating + investing +
 * financing, and closing = opening + net. `b` must cover the same range, starting
 * before the first transaction (so the opening cash balance is zero).
 */
export function expectCashFlowReconciles(cf: CashFlow, b: Book): void {
  expect(cf.openingCashBalance).toBe("0.00");
  expect(cf.netCashFlow).toBe(money.add(tbBalance(b, "1000"), tbBalance(b, "1010")));
  expect(cf.netCashFlow).toBe(
    money.sum([cf.operating.totalOperating, cf.investing.totalInvesting, cf.financing.totalFinancing]),
  );
  expect(cf.closingCashBalance).toBe(money.add(cf.openingCashBalance, cf.netCashFlow));
}

/** Trial balance as `[code, debit, credit]` rows (zero accounts are already omitted). */
export function tbRows(b: Book): Array<[string, string, string]> {
  return b.tb.accounts.map((a) => [a.accountCode, a.debit, a.credit]);
}

/** P&L flattened to `[code, amount]` rows plus the headline totals. */
export function plSummary(b: Book) {
  return {
    income: b.pl.income.map((a) => [a.accountCode, a.amount]),
    expenses: b.pl.expenses.map((a) => [a.accountCode, a.amount]),
    totalIncome: b.pl.totalIncome,
    totalExpenses: b.pl.totalExpenses,
    grossProfit: b.pl.grossProfit,
    netProfit: b.pl.netProfit,
  };
}

/** Balance sheet flattened to `[code, balance]` rows plus section totals. Equity includes the 9999 net-income line. */
export function bsSummary(b: Book) {
  const rows = (xs: Array<{ accountCode: string; balance: string }>) =>
    xs.map((a) => [a.accountCode, a.balance]);
  return {
    assets: rows(b.bs.assets),
    liabilities: rows(b.bs.liabilities),
    equity: rows(b.bs.equity),
    totalAssets: b.bs.totalAssets,
    totalLiabilities: b.bs.totalLiabilities,
    totalEquity: b.bs.totalEquity,
  };
}

/**
 * The invariants that must hold for ANY scenario:
 *   - trial balance: total debits == total credits (and each side is the sum of its rows)
 *   - balance sheet: Assets == Liabilities + Equity
 *   - Equity's "Net Income" line == all-time P&L net profit, i.e.
 *     Assets == Liabilities + (Equity excl. profit) + profit
 * Pass the book for ALL_TIME; the balance sheet is cumulative by construction.
 */
export function expectBooksBalance(b: Book): void {
  expect(b.tb.totalDebit).toBe(b.tb.totalCredit);
  expect(b.tb.totalDebit).toBe(money.sum(b.tb.accounts.map((a) => a.debit)));
  expect(b.tb.totalCredit).toBe(money.sum(b.tb.accounts.map((a) => a.credit)));

  expect(b.bs.totalAssets).toBe(money.add(b.bs.totalLiabilities, b.bs.totalEquity));

  const netIncomeLine = b.bs.equity.find((e) => e.accountCode === "9999");
  expect(netIncomeLine?.balance).toBe(b.pl.netProfit);
  const equityExProfit = money.sub(b.bs.totalEquity, b.pl.netProfit);
  expect(b.bs.totalAssets).toBe(
    money.add(money.add(b.bs.totalLiabilities, equityExProfit), b.pl.netProfit),
  );
}

/**
 * Aging-report total for one side (the report is invoice-based, not ledger-based).
 * Normalised to 2dp: an empty report reports "0" rather than "0.00".
 */
export async function outstandingTotal(
  w: GoldenWorld,
  side: "receivable" | "payable",
): Promise<string> {
  const r = await w.caller.reports.outstanding({ type: side });
  const section = side === "receivable" ? r.receivables : r.payables;
  return money.add(section?.summary.total ?? "0", "0");
}

/** Net balance (debit - credit) of one account in the trial balance, "0.00" when absent. */
export function tbBalance(b: Book, code: string): string {
  return b.tb.accounts.find((a) => a.accountCode === code)?.balance ?? "0.00";
}

/** Render a GSTR-3B/GSTR-1 JS number as a 2dp string so it can be compared with a literal. */
export const fixed2 = (n: number): string => n.toFixed(2);
