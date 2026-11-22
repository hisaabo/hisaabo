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

  it("GSTR-3B CGST + SGST equals the invoice GST exactly (102.59)", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 10 });
    expect(fixed2(r.taxPayable.cgst + r.taxPayable.sgst)).toBe("102.59");
    // The odd paisa goes to SGST, as on the invoice's ledger entry (2100 = 51.29, 2101 = 51.30).
    expect(fixed2(r.taxPayable.cgst)).toBe("51.29");
    expect(fixed2(r.taxPayable.sgst)).toBe("51.30");
  });

  it("GSTR-1 splits the same way: totals, B2CS row and HSN row all add up to 102.59", async () => {
    const r = await w.caller.gst.gstr1({ year: 2025, month: 10 });
    expect(fixed2(r.totalCgst)).toBe("51.29");
    expect(fixed2(r.totalSgst)).toBe("51.30");
    expect(fixed2(r.totalTax)).toBe("102.59");
    // Unregistered customer, intra-state: B2CS rows by rate. Their tax adds up to the invoice's.
    const b2csTax = r.b2cSmall.reduce((acc, row) => acc + Math.round((row.cgst + row.sgst) * 100), 0);
    expect(b2csTax).toBe(10259);
    const hsnTax = r.hsn.reduce((acc, row) => acc + Math.round((row.cgst + row.sgst) * 100), 0);
    expect(hsnTax).toBe(10259);
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

  it("GSTR-3B ITC CGST + SGST equals the purchase GST exactly (102.59)", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 10 });
    expect(fixed2(r.itc.cgst + r.itc.sgst)).toBe("102.59");
    expect(fixed2(r.itc.cgst)).toBe("51.29");
    expect(fixed2(r.itc.sgst)).toBe("51.30");
  });
});

describe("golden 12D: invoice-level round-off, discount and charges", () => {
  // The invoice total is subtotal + GST - invoice discount + additional charges + round-off,
  // so the receivable (at the total) only balances if each adjustment posts to an account of
  // its own: Round Off (5030), Discount Allowed (5020), Other Charges (4020).

  it("round-off -0.55 (total 762.00) keeps the trial balance balanced", async () => {
    const w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "MH");
    const inv = await addInvoice(w, "sale", customer.id, LINES, { date: DATE, roundOff: "-0.55" });
    expect(inv.totalAmount).toBe("762.00"); // 659.96 + 102.59 - 0.55
    const b = await book(w);
    expect(b.tb.totalDebit).toBe(b.tb.totalCredit);
    expect(tbRows(b)).toEqual([
      ["1100", "762.00", "0.00"],
      ["2100", "0.00", "51.29"],
      ["2101", "0.00", "51.30"],
      ["4000", "0.00", "659.96"],
      ["5030", "0.55", "0.00"], // the 0.55 the customer does not pay is a cost
    ]);
    expect(b.tb.totalDebit).toBe("762.55"); // 762.00 + 0.55
    expect(b.tb.totalCredit).toBe("762.55"); // 659.96 + 51.29 + 51.30
    expect(plSummary(b).netProfit).toBe("659.41"); // 659.96 - 0.55
    expectBooksBalance(b);
  });

  it("a positive round-off of +0.45 (total 763.00) is income", async () => {
    const w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "MH");
    const inv = await addInvoice(w, "sale", customer.id, LINES, { date: DATE, roundOff: "0.45" });
    expect(inv.totalAmount).toBe("763.00"); // 659.96 + 102.59 + 0.45
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1100", "763.00", "0.00"],
      ["2100", "0.00", "51.29"],
      ["2101", "0.00", "51.30"],
      ["4000", "0.00", "659.96"],
      ["5030", "0.00", "0.45"],
    ]);
    expect(b.tb.totalDebit).toBe("763.00");
    expect(b.tb.totalCredit).toBe("763.00");
    expectBooksBalance(b);
  });

  it("an invoice-level discount of 50.00 (total 712.55) keeps the trial balance balanced", async () => {
    const w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "MH");
    const inv = await addInvoice(w, "sale", customer.id, LINES, {
      date: DATE,
      invoiceDiscount: "50.00",
    });
    expect(inv.totalAmount).toBe("712.55"); // 659.96 + 102.59 - 50.00
    const b = await book(w);
    expect(b.tb.totalDebit).toBe(b.tb.totalCredit);
    expect(tbRows(b)).toEqual([
      ["1100", "712.55", "0.00"],
      ["2100", "0.00", "51.29"], // GST stays on the pre-discount value: the discount is given after tax
      ["2101", "0.00", "51.30"],
      ["4000", "0.00", "659.96"],
      ["5020", "50.00", "0.00"], // Discount Allowed
    ]);
    expect(b.tb.totalDebit).toBe("762.55"); // 712.55 + 50.00
    expect(b.tb.totalCredit).toBe("762.55");
    expect(plSummary(b).netProfit).toBe("609.96"); // 659.96 - 50.00
    expectBooksBalance(b);
  });

  it("an additional charge of 25.00 (total 787.55) keeps the trial balance balanced", async () => {
    const w = await createGoldenWorld();
    const customer = await addParty(w, "customer", "MH");
    const inv = await addInvoice(w, "sale", customer.id, LINES, {
      date: DATE,
      additionalCharges: "25.00",
    });
    expect(inv.totalAmount).toBe("787.55"); // 659.96 + 102.59 + 25.00
    const b = await book(w);
    expect(b.tb.totalDebit).toBe(b.tb.totalCredit);
    expect(tbRows(b)).toEqual([
      ["1100", "787.55", "0.00"],
      ["2100", "0.00", "51.29"],
      ["2101", "0.00", "51.30"],
      ["4000", "0.00", "659.96"],
      ["4020", "0.00", "25.00"], // Other Charges
    ]);
    expect(b.tb.totalDebit).toBe("787.55");
    expect(b.tb.totalCredit).toBe("787.55");
    expect(plSummary(b).netProfit).toBe("684.96"); // 659.96 + 25.00
    expectBooksBalance(b);
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

  it("a settled round-off invoice leaves a zero receivable in the ledger too", async () => {
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
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1000", "762.00", "0.00"],
      ["1100", "762.00", "762.00"], // fully collected
      ["2100", "0.00", "51.29"],
      ["2101", "0.00", "51.30"],
      ["4000", "0.00", "659.96"],
      ["5030", "0.55", "0.00"],
    ]);
    expectBooksBalance(b);
  });
});

describe("golden 12E: the same adjustments on a purchase", () => {
  it("discount 50.00 + charge 25.00 + round-off 0.45 (total 738.00) balance on the payable", async () => {
    const w = await createGoldenWorld();
    const supplier = await addParty(w, "supplier", "MH");
    const inv = await w.caller.invoice.create({
      partyId: supplier.id,
      type: "purchase",
      invoiceDate: DATE,
      lineItems: LINES.map((l) => ({
        itemName: l.name,
        quantity: l.qty,
        unitPrice: l.price,
        taxPercent: l.tax ?? "0",
        discountPercent: l.discount ?? "0",
      })),
      invoiceDiscount: "50.00",
      roundOff: "0.45",
      charges: [{ label: "Freight", amount: "25.00" }],
    });
    expect(inv.totalAmount).toBe("738.00"); // 659.96 + 102.59 - 50.00 + 25.00 + 0.45
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1510", "51.29", "0.00"],
      ["1511", "51.30", "0.00"],
      ["2000", "0.00", "738.00"],
      ["4200", "0.00", "50.00"], // Discount Received
      ["5000", "659.96", "0.00"],
      ["5030", "0.45", "0.00"], // Round Off: a higher payable is a cost
      ["5100", "25.00", "0.00"], // freight inward is a direct cost
    ]);
    // Debits 51.29 + 51.30 + 659.96 + 25.00 + 0.45 = 788.00; credits 738.00 + 50.00 = 788.00.
    expect(b.tb.totalDebit).toBe("788.00");
    expect(b.tb.totalCredit).toBe("788.00");
    expectBooksBalance(b);
  });
});
