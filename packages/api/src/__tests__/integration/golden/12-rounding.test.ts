/**
 * Scenario 12 — Rounding: a 7-line invoice where nearly every line rounds a
 * fractional paisa, and every total still has to tie to the paisa.
 *
 * Rounding rule (shared/money.ts): amounts are integer paise; a product or a
 * percentage is rounded half-up to the nearest paisa PER LINE, then lines are
 * summed. Hand computation (paise in brackets where it matters):
 *
 *   #  qty  price  disc  tax   base          discount   after      tax         line total
 *   1  3    33.33  -     5%    99.99         -          99.99      5.00 [499.95]   104.99
 *   2  7    12.35  -     12%   86.45         -          86.45      10.37 [1037.4]   96.82
 *   3  1.5  99.99  -     18%   149.99 [14998.5] -       149.99     27.00 [2699.82]  176.99
 *   4  11   9.99   10%   18%   109.89        10.99 [1098.9] 98.90  17.80 [1780.2]   116.70
 *   5  13   7.77   -     28%   101.01        -          101.01     28.28 [2828.28] 129.29
 *   6  2.5  45.45  -     12%   113.63 [11362.5] -       113.63     13.64 [1363.56] 127.27
 *   7  9    1.11   -     5%    9.99          -          9.99       0.50 [49.95]     10.49
 *
 *   subtotal (sum of "after")  99.99 + 86.45 + 149.99 + 98.90 + 101.01 + 113.63 + 9.99 = 659.96
 *   GST      (sum of tax)       5.00 + 10.37 + 27.00 + 17.80 + 28.28 + 13.64 + 0.50   = 102.59  (odd paisa)
 *   total    659.96 + 102.59 = 762.55 = sum of the line totals
 *
 *   Intra-state the odd paisa is split 51.29 CGST + 51.30 SGST (derive-ledger:
 *   floor half to CGST, remainder to SGST); inter-state it is a single IGST 102.59.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  addPayment,
  book,
  tbRows,
  plSummary,
  bsSummary,
  expectBooksBalance,
  fixed2,
  type GoldenWorld,
  type Book,
  type Line,
} from "./golden-helpers.js";

useGoldenDb();

const LINES: Line[] = [
  { name: "Line 1", qty: "3", price: "33.33", tax: "5" },
  { name: "Line 2", qty: "7", price: "12.35", tax: "12" },
  { name: "Line 3", qty: "1.5", price: "99.99", tax: "18" },
  { name: "Line 4", qty: "11", price: "9.99", tax: "18", discount: "10" },
  { name: "Line 5", qty: "13", price: "7.77", tax: "28" },
  { name: "Line 6", qty: "2.5", price: "45.45", tax: "12" },
  { name: "Line 7", qty: "9", price: "1.11", tax: "5" },
];

/** [taxAmount, totalAmount] per line, from the table above. */
const EXPECTED_LINES = [
  ["5.00", "104.99"],
  ["10.37", "96.82"],
  ["27.00", "176.99"],
  ["17.80", "116.70"],
  ["28.28", "129.29"],
  ["13.64", "127.27"],
  ["0.50", "10.49"],
];

const DATE = "2025-10-15T10:00:00.000Z";

describe("golden 12A: many-line intra-state sale ties to the paisa", () => {
  let w: GoldenWorld;
  let invoiceId: string;
  let b: Book;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "MH");
    invoiceId = (await addInvoice(w, "sale", customer.id, LINES, { date: DATE })).id;
    b = await book(w);
  });

  it("each line rounds half-up per line and the invoice totals are the sum of the lines", async () => {
    const inv = await w.caller.invoice.getById({ id: invoiceId });
    expect(inv?.lineItems.map((l) => [l.taxAmount, l.totalAmount])).toEqual(EXPECTED_LINES);
    expect(inv?.subtotal).toBe("659.96");
    expect(inv?.taxAmount).toBe("102.59");
    expect(inv?.totalAmount).toBe("762.55");
    // The line totals themselves add up to the invoice total: 104.99 + 96.82 + 176.99
    // + 116.70 + 129.29 + 127.27 + 10.49 = 762.55.
  });

  it("trial balance: the odd paisa of GST splits 51.29 / 51.30 and debits == credits exactly", () => {
    expect(tbRows(b)).toEqual([
      ["1100", "762.55", "0.00"],
      ["2100", "0.00", "51.29"], // floor(10259 / 2) paise
      ["2101", "0.00", "51.30"], // the remaining paisa goes to SGST
      ["4000", "0.00", "659.96"],
    ]);
    // Credits 51.29 + 51.30 + 659.96 = 762.55 = the receivable.
    expect(b.tb.totalDebit).toBe("762.55");
    expect(b.tb.totalCredit).toBe("762.55");
  });

  it("P&L and balance sheet", () => {
    expect(plSummary(b)).toEqual({
      income: [["4000", "659.96"]],
      expenses: [],
      totalIncome: "659.96",
      totalExpenses: "0.00",
      grossProfit: "659.96",
      netProfit: "659.96",
    });
    expect(bsSummary(b)).toEqual({
      assets: [["1100", "762.55"]],
      liabilities: [
        ["2100", "51.29"],
        ["2101", "51.30"],
      ],
      equity: [["9999", "659.96"]],
      totalAssets: "762.55",
      totalLiabilities: "102.59",
      totalEquity: "659.96",
    });
    expectBooksBalance(b);
  });

  // BUG: gst-reports.ts splitTax(amount) rounds the half-paisa UP for BOTH CGST and
  // SGST (Math.round(amount * 100 / 2)), so an odd-paisa tax is overstated by one
  // paisa: 51.30 + 51.30 = 102.60 instead of the invoice's 102.59 / the ledger's
  // 51.29 + 51.30.
  it.fails("GSTR-3B CGST + SGST equals the invoice GST exactly (102.59)", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 10 });
    expect(fixed2(r.taxPayable.cgst + r.taxPayable.sgst)).toBe("102.59");
  });
});

describe("golden 12B: the same invoice inter-state carries one IGST amount", () => {
  it("trial balance: IGST 102.59 is not split", async () => {
    const w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "KA");
    await addInvoice(w, "sale", customer.id, LINES, { date: DATE });
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1100", "762.55", "0.00"],
      ["2102", "0.00", "102.59"],
      ["4000", "0.00", "659.96"],
    ]);
    expect(b.tb.totalDebit).toBe("762.55");
    expect(b.tb.totalCredit).toBe("762.55");
    expectBooksBalance(b);
  });
});

describe("golden 12C: the same lines on a purchase", () => {
  let w: GoldenWorld;
  let b: Book;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const supplier = await addParty(w, "supplier", "MH");
    await addInvoice(w, "purchase", supplier.id, LINES, { date: DATE });
    b = await book(w);
  });

  it("trial balance: input GST splits 51.29 / 51.30, payable is the invoice total", () => {
    expect(tbRows(b)).toEqual([
      ["1510", "51.29", "0.00"],
      ["1511", "51.30", "0.00"],
      ["2000", "0.00", "762.55"],
      ["5000", "659.96", "0.00"],
    ]);
    // Debits 51.29 + 51.30 + 659.96 = 762.55 = credits.
    expect(b.tb.totalDebit).toBe("762.55");
    expect(b.tb.totalCredit).toBe("762.55");
    expectBooksBalance(b);
  });

  it("the ITC ledger splits the paisa the same way as the general ledger", async () => {
    const dash = await w.caller.itc.dashboard({ returnPeriod: "2025-10" });
    expect(dash.summary.available).toMatchObject({ cgst: "51.29", sgst: "51.30", igst: "0.00" });
  });

  // BUG: same splitTax rounding as 12A, on the ITC side: 51.30 + 51.30.
  it.fails("GSTR-3B ITC CGST + SGST equals the purchase GST exactly (102.59)", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 10 });
    expect(fixed2(r.itc.cgst + r.itc.sgst)).toBe("102.59");
  });
});

describe("golden 12D: invoice-level round-off, discount and charges", () => {
  // BUG: invoice.create stores subtotal/tax from the LINES but total_amount also
  // includes round-off, charges and the invoice-level discount, and derive-ledger
  // posts Dr Receivable = total, Cr Sales = subtotal, Cr GST = tax. Any invoice with
  // a round-off (the web default is ON), extra charge or invoice discount therefore
  // produces an UNBALANCED derived entry, and the trial balance and balance sheet
  // stop balancing. The expectation below is the correct one (books balance).

  it.fails("round-off -0.55 (total 762.00) keeps the trial balance balanced", async () => {
    const w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "MH");
    const inv = await addInvoice(w, "sale", customer.id, LINES, { date: DATE, roundOff: "-0.55" });
    expect(inv.totalAmount).toBe("762.00"); // 659.96 + 102.59 - 0.55
    const b = await book(w);
    expect(b.tb.totalDebit).toBe(b.tb.totalCredit); // today: 762.00 vs 762.55
  });

  it.fails("an invoice-level discount of 50.00 (total 712.55) keeps the trial balance balanced", async () => {
    const w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "MH");
    const inv = await addInvoice(w, "sale", customer.id, LINES, {
      date: DATE,
      invoiceDiscount: "50.00",
    });
    expect(inv.totalAmount).toBe("712.55"); // 659.96 + 102.59 - 50.00
    const b = await book(w);
    expect(b.tb.totalDebit).toBe(b.tb.totalCredit); // today: 712.55 vs 762.55
  });

  it.fails("an additional charge of 25.00 (total 787.55) keeps the trial balance balanced", async () => {
    const w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "MH");
    const inv = await addInvoice(w, "sale", customer.id, LINES, {
      date: DATE,
      additionalCharges: "25.00",
    });
    expect(inv.totalAmount).toBe("787.55"); // 659.96 + 102.59 + 25.00
    const b = await book(w);
    expect(b.tb.totalDebit).toBe(b.tb.totalCredit); // today: 787.55 vs 762.55
  });

  it("the round-off invoice can still be settled in full at its stored total (operational side is fine)", async () => {
    const w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "MH");
    const inv = await addInvoice(w, "sale", customer.id, LINES, { date: DATE, roundOff: "-0.55" });
    await addPayment(w, {
      partyId: customer.id,
      invoiceId: inv.id,
      amount: "762.00",
      mode: "cash",
      date: "2025-10-20T10:00:00.000Z",
    });
    expect((await w.caller.invoice.getById({ id: inv.id }))?.status).toBe("paid");
    expect((await w.caller.party.getById({ id: customer.id }))?.balance).toBe("0.00");
  });
});
