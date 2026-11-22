/**
 * Scenario 10 — DOCUMENTED GAP: opening balances on parties and bank accounts
 * are absent from the trial balance and balance sheet today.
 *
 * `parties.opening_balance` and `bank_accounts.opening_balance` are operational
 * fields: party balances, party ledgers and bank balances include them, but the
 * virtual ledger (derive-ledger.ts) never looks at them, so no account carries
 * them and the balance sheet has no matching capital / reserve either.
 *
 * *** 0.12.0 WILL CHANGE THESE EXPECTATIONS. *** The posted GL will carry
 * opening balances as an opening journal (receivable / payable / bank against
 * an opening-balance equity account). Update the "documented gap" literals
 * deliberately when that lands.
 *
 * Sign convention (the documented one, MCP / WebMCP / docs): a party balance is SIGNED,
 * positive = they owe you, negative = you owe them, for customers AND suppliers, and an
 * opening balance is entered that way.
 *
 * Setup (no GST):
 *   Customer opening balance  25000.00 (they owe us), then a sale of 10000.00
 *   Supplier opening balance -10000.00 (we owe them), then a purchase of 4000.00
 *   Bank account HDFC opening 75000.00
 *
 * Operational surfaces include the opening balances:
 *   customer balance =  25000 + 10000 =  35000.00
 *   supplier balance = -10000 -  4000 = -14000.00   (the purchase is a credit: we owe more)
 *   bank balance                       =  75000.00
 * The ledger has only the two documents:
 *   1100 Dr 10000, 2000 Cr 4000, 4000 Cr 10000, 5000 Dr 4000.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  addBankAccount,
  book,
  tbRows,
  plSummary,
  bsSummary,
  expectBooksBalance,
  outstandingTotal,
  type GoldenWorld,
  type Book,
} from "./golden-helpers.js";

useGoldenDb();

describe("golden 10: opening balances are not in the ledger (documented gap)", () => {
  let w: GoldenWorld;
  let customerId: string;
  let supplierId: string;
  let bankId: string;
  let b: Book;

  beforeAll(async () => {
    w = await createGoldenWorld();
    customerId = (await addParty(w, "customer", "MH", { openingBalance: "25000.00" })).id;
    supplierId = (await addParty(w, "supplier", "MH", { openingBalance: "-10000.00" })).id;
    bankId = (await addBankAccount(w, "HDFC Current", { openingBalance: "75000.00" })).id;

    await addInvoice(
      w,
      "sale",
      customerId,
      [{ name: "Goods", qty: "1", price: "10000.00" }],
      { date: "2025-05-05T10:00:00.000Z" },
    );
    await addInvoice(
      w,
      "purchase",
      supplierId,
      [{ name: "Stock", qty: "1", price: "4000.00" }],
      { date: "2025-05-07T10:00:00.000Z" },
    );
    b = await book(w);
  });

  it("operational balances include the opening balances", async () => {
    expect((await w.caller.party.getById({ id: customerId }))?.balance).toBe("35000.00");
    expect((await w.caller.party.getById({ id: supplierId }))?.balance).toBe("-14000.00");
    expect((await w.caller.bankAccount.getById({ id: bankId }))?.currentBalance).toBe("75000.00");
    expect((await w.caller.bankAccount.summary()).bankBalance).toBe("75000.00");

    const ledger = await w.caller.party.ledgerReport({ partyId: customerId });
    expect(ledger?.party.openingBalance).toBe("25000.00");
    expect(ledger?.summary.closingBalance).toBe("35000.00");
  });

  it("trial balance has only the two documents: no opening receivable, payable or bank (documented gap)", () => {
    expect(tbRows(b)).toEqual([
      ["1100", "10000.00", "0.00"], // would be 35000 with the 25000 opening
      ["2000", "0.00", "4000.00"], // would be 14000 with the 10000 opening
      ["4000", "0.00", "10000.00"],
      ["5000", "4000.00", "0.00"],
      // no 1010: the 75000 bank opening is nowhere
    ]);
    expect(b.tb.totalDebit).toBe("14000.00");
    expect(b.tb.totalCredit).toBe("14000.00");
  });

  it("P&L is unaffected: sales 10000 - purchases 4000", () => {
    expect(plSummary(b)).toEqual({
      income: [["4000", "10000.00"]],
      expenses: [["5000", "4000.00"]],
      totalIncome: "10000.00",
      totalExpenses: "4000.00",
      grossProfit: "6000.00",
      netProfit: "6000.00",
    });
  });

  it("balance sheet has no bank, no opening receivable/payable, no capital (documented gap)", () => {
    expect(bsSummary(b)).toEqual({
      assets: [["1100", "10000.00"]],
      liabilities: [["2000", "4000.00"]],
      equity: [["9999", "6000.00"]],
      totalAssets: "10000.00",
      totalLiabilities: "4000.00",
      totalEquity: "6000.00",
    });
    expectBooksBalance(b); // balanced only because the openings are missing on BOTH sides
  });

  it("the aging reports are invoice-based and also omit the openings (documented gap)", async () => {
    expect(await outstandingTotal(w, "receivable")).toBe("10000.00");
    expect(await outstandingTotal(w, "payable")).toBe("4000.00");
  });

  // Both surfaces are debit minus credit with the opening balance as stored: the supplier we
  // owe is -10000 (opening) - 4000 (purchase, a credit) = -14000 on party.getById and on the
  // ledger. (The ledger used to start from the opening with the opposite sign, closing at
  // 10000 - 4000 = 6000, while getById added the purchase to the opening.)
  it("supplier closing balance agrees between party.getById and party.ledgerReport (-14000.00)", async () => {
    const ledger = await w.caller.party.ledgerReport({ partyId: supplierId });
    expect(ledger?.summary.closingBalance).toBe("-14000.00");
    expect((await w.caller.party.getById({ id: supplierId }))?.balance).toBe("-14000.00");
  });
});
