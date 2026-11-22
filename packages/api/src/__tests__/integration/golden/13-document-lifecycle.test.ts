/**
 * Scenario 13 (extra) — Which documents are in the books, and how they leave.
 *
 * The virtual ledger is a pure function of the operational rows, so "reversal"
 * is just a row disappearing from the query:
 *   - a DRAFT invoice is already in the books (only cancelled invoices are excluded);
 *   - quotations, proformas and delivery challans never post;
 *   - cancelling an invoice (no payments) removes its entry;
 *   - deleting a payment (soft delete) removes its entry and re-opens the invoice.
 * A posted general ledger will need explicit reversals for the last two, and may
 * choose not to post drafts; this file pins the numbers the migration must match
 * or consciously change.
 *
 *   inv1  sale 1 x 10000.00 @ 18%  sent        11800.00 (later cancelled)
 *   inv2  sale 1 x  5000.00        sent         5000.00, receipt 5000.00 cash (later deleted)
 *   inv3  sale 1 x  2000.00        DRAFT        2000.00
 *   quo   quotation 1 x 99999.00                (never posts)
 *
 * Bug documented here (it.fails): party.getById's balance includes the quotation.
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
  expectBooksBalance,
  type GoldenWorld,
  type Book,
} from "./golden-helpers.js";

useGoldenDb();

describe("golden 13: drafts post, quotations do not, cancel and payment delete reverse", () => {
  let w: GoldenWorld;
  let partyId: string;
  let inv1Id: string;
  let inv2Id: string;
  let paymentId: string;
  let before: Book;
  let afterCancel: Book;
  let afterDelete: Book;

  beforeAll(async () => {
    w = await createGoldenWorld();
    partyId = (await addParty(w, "customer", "MH")).id;

    inv1Id = (
      await addInvoice(w, "sale", partyId, [{ name: "A", qty: "1", price: "10000.00", tax: "18" }], {
        date: "2025-11-03T10:00:00.000Z",
      })
    ).id;
    inv2Id = (
      await addInvoice(w, "sale", partyId, [{ name: "B", qty: "1", price: "5000.00" }], {
        date: "2025-11-04T10:00:00.000Z",
      })
    ).id;
    paymentId = (
      await addPayment(w, {
        partyId,
        invoiceId: inv2Id,
        amount: "5000.00",
        mode: "cash",
        date: "2025-11-06T10:00:00.000Z",
      })
    ).id;
    // inv3 stays a draft: created through the router, never moved to "sent".
    await w.caller.invoice.create({
      partyId,
      type: "sale",
      invoiceDate: "2025-11-05T10:00:00.000Z",
      lineItems: [{ itemName: "C", quantity: "1", unitPrice: "2000.00", taxPercent: "0", discountPercent: "0" }],
    });
    await w.caller.quotation.create({
      partyId,
      type: "sale",
      invoiceDate: "2025-11-05T10:00:00.000Z",
      lineItems: [{ itemName: "Q", quantity: "1", unitPrice: "99999.00", taxPercent: "0", discountPercent: "0" }],
    });
    before = await book(w);

    await w.caller.invoice.updateStatus({ id: inv1Id, status: "cancelled" });
    afterCancel = await book(w);

    await w.caller.payment.delete({ id: paymentId });
    afterDelete = await book(w);
  });

  it("before: inv1 + inv2 + its receipt + the draft inv3 are posted; the quotation is not", () => {
    expect(tbRows(before)).toEqual([
      ["1000", "5000.00", "0.00"],
      ["1100", "18800.00", "5000.00"], // 11800 + 5000 + 2000 draft ; receipt 5000
      ["2100", "0.00", "900.00"],
      ["2101", "0.00", "900.00"],
      ["4000", "0.00", "17000.00"], // 10000 + 5000 + 2000
    ]);
    // Debits 5000 + 18800 = 23800; credits 5000 + 900 + 900 + 17000 = 23800.
    expect(before.tb.totalDebit).toBe("23800.00");
    expect(before.tb.totalCredit).toBe("23800.00");
    expectBooksBalance(before);
  });

  it("cancelling inv1 removes its sale and its GST from the books", () => {
    expect(tbRows(afterCancel)).toEqual([
      ["1000", "5000.00", "0.00"],
      ["1100", "7000.00", "5000.00"], // 5000 + 2000 ; receipt 5000
      ["4000", "0.00", "7000.00"],
    ]);
    expect(afterCancel.tb.totalDebit).toBe("12000.00");
    expect(afterCancel.tb.totalCredit).toBe("12000.00");
    expectBooksBalance(afterCancel);
  });

  it("deleting the receipt removes its cash and receivable legs and re-opens inv2", async () => {
    expect(tbRows(afterDelete)).toEqual([
      ["1100", "7000.00", "0.00"], // inv2 5000 + draft inv3 2000, nothing collected
      ["4000", "0.00", "7000.00"],
    ]);
    expect(afterDelete.tb.totalDebit).toBe("7000.00");
    expect(afterDelete.tb.totalCredit).toBe("7000.00");
    expectBooksBalance(afterDelete);

    const inv2 = await w.caller.invoice.getById({ id: inv2Id });
    expect(inv2?.status).toBe("sent");
    expect(inv2?.amountPaid).toBe("0.00");
    expect((await w.caller.party.ledgerReport({ partyId }))?.summary.closingBalance).toBe("7000.00");
  });

  // BUG: party.getById (and party.list's balance) sum EVERY non-cancelled invoices-table
  // row for the party, including quotations, proformas and delivery challans, so the
  // 99999.00 quotation inflates the customer's balance: actual today is 106999.00.
  // party.ledgerReport filters by documentType and correctly shows 7000.00.
  it.fails("party balance equals the ledger receivable (7000.00); quotations do not count", async () => {
    expect((await w.caller.party.getById({ id: partyId }))?.balance).toBe("7000.00");
  });
});
