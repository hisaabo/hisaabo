/**
 * Scenario 30 — A tax-inclusive shelf price does not always bill to the paisa; the invoice round-off does.
 *
 * A bill line is tax-exclusive: rate = round(price x 100 / (100 + t)) and the server takes
 * GST = round(rate x t / 100) on it, so the line is rate + GST. That is NOT always the shelf price, even for
 * ONE unit (shared/inclusive-price.ts). The forms (web, mobile) therefore fill the invoice's round-off with the
 * difference (shared `inclusiveTieOut` + `autoRoundOff`) so the customer pays the shelf price. This scenario
 * pins what the SERVER then books for such a bill, with hand-computed literals.
 *
 * ── 30A  ₹10.00 incl. 18%, qty 1 ─────────────────────────────────────────────────────────────────────
 *   rate  1000 x 100 / 118 = 847.46 -> 847                      = 8.47
 *   GST   847 x 18 / 100   = 152.46 -> 152                      = 1.52   [CGST 0.76 / SGST 0.76]
 *   line  8.47 + 1.52 = 9.99                      (one paisa short of the shelf price)
 *   round-off +0.01  ->  total 10.00
 *   Ledger: Dr 1100 10.00 / Cr 4000 8.47, Cr 2100 0.76, Cr 2101 0.76, Cr 5030 0.01        (8.47 + 1.52 + 0.01 = 10.00)
 *
 * ── 30B  ₹41.00 incl. 18%, qty 1  (the bill is a paisa OVER) ─────────────────────────────────────────
 *   rate  4100 x 100 / 118 = 3474.58 -> 3475                    = 34.75
 *   GST   3475 x 18 / 100  = 625.5   -> 626 (half up)           = 6.26   [CGST 3.13 / SGST 3.13]
 *   line  34.75 + 6.26 = 41.01
 *   round-off -0.01  ->  total 41.00
 *   Ledger: Dr 1100 41.00, Dr 5030 0.01 / Cr 4000 34.75, Cr 2100 3.13, Cr 2101 3.13       (41.01 on each side)
 *
 * ── 30C  Three lines that are each a paisa short: the round-off is their sum ─────────────────────────
 *   ₹10.00 -> 8.47 + 1.52 = 9.99 ;  ₹2.00 -> 169 / 0.30 (1.69 x 18% = 30.42 -> 30) = 1.99 ;
 *   ₹6.00 -> 600 x 100 / 118 = 508.47 -> 508, GST 508 x 18 / 100 = 91.44 -> 91 = 5.08 + 0.91 = 5.99
 *   taxable 8.47 + 1.69 + 5.08 = 15.24    GST 1.52 + 0.30 + 0.91 = 2.73    raw total 17.97 (shelf 10.00 + 2.00 + 6.00 = 18.00)
 *   round-off +0.03 -> total 18.00
 *   CGST 76 + 15 + 46 = 137 = 1.37    SGST 76 + 15 + 45 = 136 = 1.36    (the odd paisa of 0.91 goes to CGST)
 *   Ledger: Dr 1100 18.00 / Cr 4000 15.24, Cr 2100 1.37, Cr 2101 1.36, Cr 5030 0.03       (15.24 + 1.37 + 1.36 + 0.03 = 18.00)
 *
 * ── 30D  3 x ₹99.00 incl. 18% ────────────────────────────────────────────────────────────────────────
 *   rate  9900 x 100 / 118 = 8389.83 -> 8390 = 83.90      taxable 3 x 83.90 = 251.70
 *   GST   25170 x 18 / 100 = 4530.6 -> 4531 = 45.31 [CGST 22.66 / SGST 22.65]   raw total 297.01 (shelf 3 x 99.00 = 297.00)
 *   round-off -0.01 -> total 297.00
 *   Ledger: Dr 1100 297.00, Dr 5030 0.01 / Cr 4000 251.70, Cr 2100 22.66, Cr 2101 22.65
 *
 * In every case the amount the customer owes is the SHELF price x quantity, on the invoice, the party ledger,
 * the trial balance and GSTR-3B; and the amounts the client sends as the round-off are the ones the shared helper
 * computes (checked against the same literals here).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { autoRoundOff, billRateFromItemPrice, calcInvoiceTotals, inclusiveTieOut } from "@hisaabo/shared";
import { useGoldenDb, createGoldenWorld, addParty, book, tbRows, expectBooksBalance, fixed2, type GoldenWorld } from "./golden-helpers.js";

useGoldenDb();

const DATE = "2025-06-10T10:00:00.000Z";

interface Shelf {
  name: string;
  price: string;
  tax: string;
  qty: string;
}

/** Bill the lines the way the forms do: tax-exclusive rate from the shelf price, round-off from the shared helper. */
async function billShelfItems(w: GoldenWorld, partyId: string, shelf: Shelf[], expectedRoundOff: string) {
  const lines = [];
  const tieLines = [];
  for (const s of shelf) {
    const item = await w.caller.item.create({
      name: s.name, itemType: "product", itemMode: "simple", unit: "pcs",
      salePrice: s.price, taxPercent: s.tax, taxInclusive: true, stockQuantity: "1000",
    } as never);
    const { rate, inclusivePrice } = billRateFromItemPrice({ price: s.price, inclusive: true, taxPercent: s.tax });
    lines.push({ itemId: item.id, itemName: s.name, quantity: s.qty, unitPrice: rate, taxPercent: s.tax, discountPercent: "0" });
    tieLines.push({ unitPrice: rate, inclusivePrice: inclusivePrice ?? undefined, taxPercent: s.tax, quantity: s.qty, discountPercent: "0" });
  }
  // what the form puts in the round-off field, from the same lines (only an INPUT here: it is asserted against a literal)
  const raw = calcInvoiceTotals({
    lineItems: lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, taxPercent: l.taxPercent, discountPercent: "0" })),
  }).total;
  const roundOff = autoRoundOff(raw, inclusiveTieOut(tieLines), false);
  expect(roundOff, "the round-off the client computes").toBe(expectedRoundOff);
  const inv = await w.caller.invoice.create({ partyId, type: "sale", invoiceDate: DATE, lineItems: lines, roundOff });
  return w.caller.invoice.updateStatus({ id: inv.id, status: "sent" });
}

describe("golden 30A: ₹10.00 incl. 18% x 1 bills 9.99; the round-off +0.01 makes it 10.00", () => {
  let w: GoldenWorld;
  let invoiceId: string;
  beforeAll(async () => {
    w = await createGoldenWorld();
    const party = await addParty(w, "customer", "MH");
    invoiceId = (await billShelfItems(w, party.id, [{ name: "Tea", price: "10.00", tax: "18", qty: "1" }], "0.01")).id;
  });

  it("the invoice: rate 8.47, GST 1.52, line 9.99, round-off 0.01, total 10.00", async () => {
    const inv = await w.caller.invoice.getById({ id: invoiceId });
    expect(inv?.lineItems.map((l) => [l.unitPrice, l.taxAmount, l.totalAmount])).toEqual([["8.47", "1.52", "9.99"]]);
    expect(inv?.subtotal).toBe("8.47");
    expect(inv?.taxAmount).toBe("1.52");
    expect(inv?.roundOff).toBe("0.01");
    expect(inv?.totalAmount).toBe("10.00"); // 8.47 + 1.52 + 0.01
  });

  it("ledger: Dr receivable 10.00 / Cr sales 8.47, CGST 0.76, SGST 0.76, round-off 0.01", async () => {
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1100", "10.00", "0.00"],
      ["2100", "0.00", "0.76"],
      ["2101", "0.00", "0.76"],
      ["4000", "0.00", "8.47"],
      ["5030", "0.00", "0.01"],
    ]);
    expect(b.tb.totalDebit).toBe("10.00");
    expect(b.tb.totalCredit).toBe("10.00"); // 8.47 + 0.76 + 0.76 + 0.01
    expectBooksBalance(b);
  });

  it("GSTR-3B: taxable 8.47, CGST 0.76, SGST 0.76; the customer owes the shelf price", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 6 });
    expect(fixed2(r.outwardSupplies.taxable.taxableValue)).toBe("8.47");
    expect(fixed2(r.taxPayable.cgst)).toBe("0.76");
    expect(fixed2(r.taxPayable.sgst)).toBe("0.76");
    const inv = await w.caller.invoice.getById({ id: invoiceId });
    expect((await w.caller.party.getById({ id: inv!.partyId }))?.balance).toBe("10.00");
  });
});

describe("golden 30B: ₹41.00 incl. 18% x 1 bills 41.01; the round-off -0.01 makes it 41.00", () => {
  let w: GoldenWorld;
  let invoiceId: string;
  beforeAll(async () => {
    w = await createGoldenWorld();
    const party = await addParty(w, "customer", "MH");
    invoiceId = (await billShelfItems(w, party.id, [{ name: "Biscuits", price: "41.00", tax: "18", qty: "1" }], "-0.01")).id;
  });

  it("the invoice: rate 34.75, GST 6.26 (625.5 rounds half up), line 41.01, round-off -0.01, total 41.00", async () => {
    const inv = await w.caller.invoice.getById({ id: invoiceId });
    expect(inv?.lineItems.map((l) => [l.unitPrice, l.taxAmount, l.totalAmount])).toEqual([["34.75", "6.26", "41.01"]]);
    expect(inv?.roundOff).toBe("-0.01");
    expect(inv?.totalAmount).toBe("41.00"); // 34.75 + 6.26 - 0.01
  });

  it("ledger: Dr receivable 41.00 and round-off 0.01 / Cr sales 34.75, CGST 3.13, SGST 3.13", async () => {
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1100", "41.00", "0.00"],
      ["2100", "0.00", "3.13"],
      ["2101", "0.00", "3.13"],
      ["4000", "0.00", "34.75"],
      ["5030", "0.01", "0.00"],
    ]);
    expect(b.tb.totalDebit).toBe("41.01");
    expect(b.tb.totalCredit).toBe("41.01"); // 34.75 + 3.13 + 3.13
    expectBooksBalance(b);
  });
});

describe("golden 30C: three lines a paisa short each: the round-off is their sum, +0.03", () => {
  let w: GoldenWorld;
  let invoiceId: string;
  beforeAll(async () => {
    w = await createGoldenWorld();
    const party = await addParty(w, "customer", "MH");
    invoiceId = (
      await billShelfItems(
        w,
        party.id,
        [
          { name: "Item ten", price: "10.00", tax: "18", qty: "1" },
          { name: "Item two", price: "2.00", tax: "18", qty: "1" },
          { name: "Item six", price: "6.00", tax: "18", qty: "1" },
        ],
        "0.03",
      )
    ).id;
  });

  it("lines 9.99 + 1.99 + 5.99 = 17.97, round-off 0.03, total 18.00 (the shelf prices)", async () => {
    const inv = await w.caller.invoice.getById({ id: invoiceId });
    expect(inv?.lineItems.map((l) => [l.unitPrice, l.taxAmount, l.totalAmount])).toEqual([
      ["8.47", "1.52", "9.99"],
      ["1.69", "0.30", "1.99"],
      ["5.08", "0.91", "5.99"],
    ]);
    expect(inv?.subtotal).toBe("15.24"); // 8.47 + 1.69 + 5.08
    expect(inv?.taxAmount).toBe("2.73"); // 1.52 + 0.30 + 0.91
    expect(inv?.roundOff).toBe("0.03");
    expect(inv?.totalAmount).toBe("18.00"); // 15.24 + 2.73 + 0.03
  });

  it("ledger: Dr receivable 18.00 / Cr sales 15.24, CGST 1.37, SGST 1.36 (odd paisa of 0.91 to CGST), round-off 0.03", async () => {
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1100", "18.00", "0.00"],
      ["2100", "0.00", "1.37"], // 0.76 + 0.15 + 0.46
      ["2101", "0.00", "1.36"], // 0.76 + 0.15 + 0.45
      ["4000", "0.00", "15.24"],
      ["5030", "0.00", "0.03"],
    ]);
    expect(b.tb.totalCredit).toBe("18.00"); // 15.24 + 1.37 + 1.36 + 0.03
    expectBooksBalance(b);
  });

  it("GSTR-3B: taxable 15.24, CGST 1.37, SGST 1.36", async () => {
    const r = await w.caller.gst.gstr3b({ year: 2025, month: 6 });
    expect(fixed2(r.outwardSupplies.taxable.taxableValue)).toBe("15.24");
    expect(fixed2(r.taxPayable.cgst)).toBe("1.37");
    expect(fixed2(r.taxPayable.sgst)).toBe("1.36");
  });
});

describe("golden 30D: 3 x ₹99.00 incl. 18% bills 297.01; the round-off -0.01 makes it 297.00", () => {
  let w: GoldenWorld;
  let invoiceId: string;
  beforeAll(async () => {
    w = await createGoldenWorld();
    const party = await addParty(w, "customer", "MH");
    invoiceId = (await billShelfItems(w, party.id, [{ name: "Notebook", price: "99.00", tax: "18", qty: "3" }], "-0.01")).id;
  });

  it("the invoice: 3 x 83.90 = 251.70 + GST 45.31 = 297.01, round-off -0.01, total 297.00", async () => {
    const inv = await w.caller.invoice.getById({ id: invoiceId });
    expect(inv?.lineItems.map((l) => [l.unitPrice, l.taxAmount, l.totalAmount])).toEqual([["83.90", "45.31", "297.01"]]);
    expect(inv?.roundOff).toBe("-0.01");
    expect(inv?.totalAmount).toBe("297.00");
  });

  it("ledger: Dr receivable 297.00 and round-off 0.01 / Cr sales 251.70, CGST 22.66, SGST 22.65", async () => {
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1100", "297.00", "0.00"],
      ["2100", "0.00", "22.66"],
      ["2101", "0.00", "22.65"],
      ["4000", "0.00", "251.70"],
      ["5030", "0.01", "0.00"],
    ]);
    expect(b.tb.totalDebit).toBe("297.01");
    expect(b.tb.totalCredit).toBe("297.01"); // 251.70 + 22.66 + 22.65
    expectBooksBalance(b);
  });
});
