/**
 * A document whose stored total is MORE than a round-off away from what its columns
 * explain (a legacy import, hand-edited data) is parked in Suspense / Unreconciled
 * (2900), not hidden in Round Off, the books still balance, and the ledger warns with
 * the document id. Up to 1.00 it is a round-off. Hand-computed:
 *
 *   sale 1 x 1000.00 @ 18% intra-state = 1000.00 + 90 + 90 = 1180.00; the stored total is then
 *   changed to 1193.00 (13.00 nobody can explain), or 1180.75 (0.75: a round-off).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { invoices } from "@hisaabo/db";
import { getTenantTestDb } from "../helpers/test-db.js";
import { logger } from "../../lib/logger.js";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  book,
  tbRows,
  expectBooksBalance,
} from "./golden/golden-helpers.js";

useGoldenDb();

afterEach(() => vi.restoreAllMocks());

async function saleWithTotal(total: string) {
  const w = await createGoldenWorld();
  const customer = await addParty(w, "customer", "MH");
  const inv = await addInvoice(w, "sale", customer.id, [{ name: "Goods", qty: "1", price: "1000.00", tax: "18" }], {
    date: "2025-10-15T10:00:00.000Z",
  });
  await getTenantTestDb().update(invoices).set({ totalAmount: total }).where(eq(invoices.id, inv.id));
  return { w, invoiceId: inv.id };
}

describe("unexplained differences between a document total and its parts", () => {
  it("13.00 goes to Suspense (2900), the books balance and the ledger warns with the document id", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { w, invoiceId } = await saleWithTotal("1193.00");
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1100", "1193.00", "0.00"],
      ["2100", "0.00", "90.00"],
      ["2101", "0.00", "90.00"],
      ["2900", "0.00", "13.00"],
      ["4000", "0.00", "1000.00"],
    ]);
    expect(b.tb.totalDebit).toBe("1193.00");
    expect(b.tb.totalCredit).toBe("1193.00");
    expectBooksBalance(b);
    // Not in the profit: income 1000, no round-off expense.
    expect(b.pl.netProfit).toBe("1000.00");
    const warned = warn.mock.calls.find((c) => (c[0] as { documentId?: string }).documentId === invoiceId);
    expect(warned?.[0]).toMatchObject({ documentId: invoiceId, unexplained: "13.00" });
  });

  it("0.75 is a round-off (5030): in the profit, no warning", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { w, invoiceId } = await saleWithTotal("1180.75");
    const b = await book(w);
    expect(tbRows(b)).toEqual([
      ["1100", "1180.75", "0.00"],
      ["2100", "0.00", "90.00"],
      ["2101", "0.00", "90.00"],
      ["4000", "0.00", "1000.00"],
      ["5030", "0.00", "0.75"],
    ]);
    expectBooksBalance(b);
    expect(warn.mock.calls.some((c) => (c[0] as { documentId?: string }).documentId === invoiceId)).toBe(false);
  });
});
