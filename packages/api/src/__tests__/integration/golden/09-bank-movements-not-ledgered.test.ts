/**
 * Scenario 9 — DOCUMENTED GAP: bank transfers and manual bank transactions do
 * not reach the ledger today.
 *
 * The virtual ledger (derive-ledger.ts) is built only from invoices, payments,
 * expenses, credit/debit notes and manual journals. `bank_transactions` rows
 * created by bankAccount.transfer / bankAccount.addTransaction are invisible to
 * it. This file pins what the books say TODAY.
 *
 * *** 0.12.0 WILL CHANGE THESE EXPECTATIONS. *** The posted general ledger is
 * expected to post these movements (a manual deposit described as interest
 * to 4100 Other Income, a manual withdrawal for charges to 5950 Bank Charges,
 * and transfers between per-bank-account ledger accounts). When it does, the
 * "documented gap" assertions below must be updated deliberately, with the
 * new literals reviewed by hand, not regenerated.
 *
 * Sequence (no GST, so the numbers stay easy to follow):
 *   Sale     50000.00 to a customer, received in full into HDFC Current -> ledgered
 *   Transfer 20000.00 HDFC Current -> SBI Savings                      -> NOT ledgered
 *   Deposit   1500.00 into SBI Savings, "Interest credited"           -> NOT ledgered
 *   Withdraw   250.00 from SBI Savings, "SMS charges"                  -> NOT ledgered
 *
 * Operational balances:  HDFC 50000 - 20000 = 30000.00
 *                        SBI  20000 + 1500 - 250 = 21250.00   (sum 51250.00)
 * Ledger 1010 Bank:      50000.00  -> differs from the bank accounts by 1250.00,
 *                        the interest income less the charges that never posted.
 * (The transfer alone would net to zero on a single 1010 account, which is why
 * it is invisible without being "wrong" - 0.12.0 changes the model, not the sum.)
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  addPayment,
  addBankAccount,
  book,
  tbRows,
  plSummary,
  bsSummary,
  expectBooksBalance,
  type GoldenWorld,
  type Book,
} from "./golden-helpers.js";

useGoldenDb();

describe("golden 09: bank transfer and manual deposit are not in the ledger (documented gap)", () => {
  let w: GoldenWorld;
  let hdfcId: string;
  let sbiId: string;
  let b: Book;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "MH");
    hdfcId = (await addBankAccount(w, "HDFC Current")).id;
    sbiId = (await addBankAccount(w, "SBI Savings", { type: "savings" })).id;

    const inv = await addInvoice(
      w,
      "sale",
      customer.id,
      [{ name: "Goods", qty: "1", price: "50000.00" }],
      { date: "2025-08-01T10:00:00.000Z" },
    );
    await addPayment(w, {
      partyId: customer.id,
      invoiceId: inv.id,
      amount: "50000.00",
      mode: "bank",
      bankAccountId: hdfcId,
      date: "2025-08-05T10:00:00.000Z",
    });

    await w.caller.bankAccount.transfer({
      fromAccountId: hdfcId,
      toAccountId: sbiId,
      amount: "20000.00",
      description: "Move surplus to savings",
      transactionDate: "2025-08-10T10:00:00.000Z",
    });
    await w.caller.bankAccount.addTransaction({
      bankAccountId: sbiId,
      type: "deposit",
      amount: "1500.00",
      description: "Interest credited",
      transactionDate: "2025-08-31T10:00:00.000Z",
    });
    await w.caller.bankAccount.addTransaction({
      bankAccountId: sbiId,
      type: "withdrawal",
      amount: "250.00",
      description: "SMS charges",
      transactionDate: "2025-08-31T11:00:00.000Z",
    });
    b = await book(w);
  });

  it("operational bank balances DO reflect every movement", async () => {
    expect((await w.caller.bankAccount.getById({ id: hdfcId }))?.currentBalance).toBe("30000.00");
    expect((await w.caller.bankAccount.getById({ id: sbiId }))?.currentBalance).toBe("21250.00");
    const s = await w.caller.bankAccount.summary();
    expect(s.bankBalance).toBe("51250.00");
    expect(s.cashInHand).toBe("0.00");
  });

  it("trial balance contains only the sale and the receipt (documented gap: no 4100, no 5950)", () => {
    expect(tbRows(b)).toEqual([
      ["1010", "50000.00", "0.00"], // the receipt only
      ["1100", "50000.00", "50000.00"],
      ["4000", "0.00", "50000.00"],
    ]);
    expect(b.tb.totalDebit).toBe("100000.00");
    expect(b.tb.totalCredit).toBe("100000.00");
  });

  it("P&L has no interest income and no bank charges (documented gap)", () => {
    expect(plSummary(b)).toEqual({
      income: [["4000", "50000.00"]], // would be 4000 50000 + 4100 1500 once interest posts
      expenses: [], // would include 5950 250 once charges post
      totalIncome: "50000.00",
      totalExpenses: "0.00",
      grossProfit: "50000.00",
      netProfit: "50000.00", // would be 51250.00
    });
  });

  it("balance sheet bank asset is 50000 while the bank accounts hold 51250 (documented gap)", () => {
    expect(bsSummary(b)).toEqual({
      assets: [["1010", "50000.00"]],
      liabilities: [],
      equity: [["9999", "50000.00"]],
      totalAssets: "50000.00",
      totalLiabilities: "0.00",
      totalEquity: "50000.00",
    });
    expectBooksBalance(b); // the books are internally consistent, just incomplete
  });

  it("the general ledger for 1010 lists only the customer receipt (documented gap)", async () => {
    const gl = await w.caller.reports.generalLedger({
      accountId: w.accounts["1010"]!,
      fromDate: "2025-08-01T00:00:00.000Z",
      toDate: "2025-08-31T23:59:59.999Z",
    });
    expect(gl.entries.map((e) => [e.sourceType, e.debit, e.credit])).toEqual([
      ["payment", "50000.00", "0.00"],
    ]);
    expect(gl.closingBalance).toBe("50000.00");
  });
});
