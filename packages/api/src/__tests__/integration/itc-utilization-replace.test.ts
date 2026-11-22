/**
 * itc.recordUtilization is idempotent per return period: recording a period
 * again REPLACES its system journal (reverse the old one, post the new one)
 * instead of posting the credit a second time. Hand-computed on the July 2025
 * book of golden scenario 08:
 *
 *   output  CGST 1800  SGST 1800  IGST 900   (S1 intra 20 x 1000 @18%, S2 inter 5 x 1000 @18%)
 *   input   CGST  900  SGST  900  IGST 1800  (P1 intra 10 x 1000 @18%, P2 inter 10 x 1000 @18%)
 *
 * Utilising everything the way golden 08 does leaves Input GST at 0 and
 * 400 CGST / 500 SGST to pay. Utilising only the CGST + SGST credit (900 + 900)
 * instead leaves Input CGST / SGST at 0, Input IGST at 1800 and output
 * CGST 900 / SGST 900 to pay.
 */
import { describe, it, expect } from "vitest";
import {
  useGoldenDb,
  createGoldenWorld,
  addParty,
  addInvoice,
  book,
  tbBalance,
  expectBooksBalance,
  type GoldenWorld,
} from "./golden/golden-helpers.js";

useGoldenDb();

const FULL = {
  returnPeriod: "2025-07",
  cgstUtilized: "900.00",
  sgstUtilized: "900.00",
  igstUtilizedAgainstIgst: "900.00",
  igstUtilizedAgainstCgst: "500.00",
  igstUtilizedAgainstSgst: "400.00",
};

async function seedJuly(w: GoldenWorld) {
  const [custMH, custKA, supMH, supKA] = await Promise.all([
    addParty(w, "customer", "MH"),
    addParty(w, "customer", "KA"),
    addParty(w, "supplier", "MH"),
    addParty(w, "supplier", "KA"),
  ]);
  const line = (qty: string) => [{ name: "Goods", qty, price: "1000.00", tax: "18" }];
  await addInvoice(w, "sale", custMH.id, line("20"), { date: "2025-07-04T10:00:00.000Z" });
  await addInvoice(w, "sale", custKA.id, line("5"), { date: "2025-07-06T10:00:00.000Z" });
  await addInvoice(w, "purchase", supMH.id, line("10"), { date: "2025-07-08T10:00:00.000Z" });
  await addInvoice(w, "purchase", supKA.id, line("10"), { date: "2025-07-10T10:00:00.000Z" });
}

describe("itc.recordUtilization replaces the period's journal", () => {
  it("recording twice leaves one live journal; the first is voided and reversed", async () => {
    const w = await createGoldenWorld();
    await seedJuly(w);
    await w.caller.itc.recordUtilization(FULL);
    await w.caller.itc.recordUtilization(FULL);

    const entries = await w.caller.journal.list({});
    expect(entries).toHaveLength(3); // original (void), its reversal, the new journal
    const live = entries.filter((e) => !e.isVoided && !e.narration?.startsWith("Void:"));
    expect(live).toHaveLength(1);
    expect(live[0]!.narration).toBe("ITC utilization for return period 2025-07");
    expect(live[0]!.totalAmount).toBe("3600.00");
    const voided = entries.filter((e) => e.isVoided);
    expect(voided).toHaveLength(1);
    const reversal = entries.find((e) => e.narration === `Void: reversal of ${voided[0]!.entryNumber}`);
    expect(reversal?.totalAmount).toBe("3600.00");
    expect(voided[0]!.voidedByEntryId).toBe(reversal?.id);
  });

  it("a second recording with DIFFERENT amounts replaces the first: only the second is in the books", async () => {
    const w = await createGoldenWorld();
    await seedJuly(w);
    await w.caller.itc.recordUtilization(FULL);
    await w.caller.itc.recordUtilization({
      returnPeriod: "2025-07",
      cgstUtilized: "900.00",
      sgstUtilized: "900.00",
    });

    const b = await book(w);
    expect(tbBalance(b, "1510")).toBe("0.00"); // CGST credit used
    expect(tbBalance(b, "1511")).toBe("0.00");
    expect(tbBalance(b, "1512")).toBe("1800.00"); // IGST credit NOT used any more
    expect(tbBalance(b, "2100")).toBe("-900.00"); // 1800 output - 900
    expect(tbBalance(b, "2101")).toBe("-900.00");
    expect(tbBalance(b, "2102")).toBe("-900.00"); // untouched
    expectBooksBalance(b);

    const stored = await w.caller.itc.recordUtilization({
      returnPeriod: "2025-07",
      cgstUtilized: "900.00",
      sgstUtilized: "900.00",
    });
    expect(stored.utilization).toMatchObject({ cgstUtilized: "900.00", igstUtilizedAgainstIgst: "0.00" });
  });

  it("recording zero amounts clears the period", async () => {
    const w = await createGoldenWorld();
    await seedJuly(w);
    await w.caller.itc.recordUtilization(FULL);
    const cleared = await w.caller.itc.recordUtilization({ returnPeriod: "2025-07" });
    expect(cleared.journalEntry).toBeNull();

    const b = await book(w);
    expect(tbBalance(b, "1510")).toBe("900.00");
    expect(tbBalance(b, "1511")).toBe("900.00");
    expect(tbBalance(b, "1512")).toBe("1800.00");
    expect(tbBalance(b, "2100")).toBe("-1800.00");
    expectBooksBalance(b);
  });

  it("another period's journal is left alone", async () => {
    const w = await createGoldenWorld();
    await seedJuly(w);
    // August: one purchase, so there is credit to use there as well.
    const sup = await addParty(w, "supplier", "MH");
    await addInvoice(w, "purchase", sup.id, [{ name: "Goods", qty: "1", price: "1000.00", tax: "18" }], {
      date: "2025-08-04T10:00:00.000Z",
    });
    await w.caller.itc.recordUtilization(FULL);
    await w.caller.itc.recordUtilization({ returnPeriod: "2025-08", cgstUtilized: "90.00", sgstUtilized: "90.00" });
    await w.caller.itc.recordUtilization(FULL); // July again

    const live = (await w.caller.journal.list({})).filter((e) => !e.isVoided && !e.narration?.startsWith("Void:"));
    expect(live.map((e) => e.narration).sort()).toEqual([
      "ITC utilization for return period 2025-07",
      "ITC utilization for return period 2025-08",
    ]);
    const b = await book(w);
    expectBooksBalance(b);
  });

  it("a journal the user voided by hand is replaced by a fresh one, not 'reversed again'", async () => {
    const w = await createGoldenWorld();
    await seedJuly(w);
    const first = await w.caller.itc.recordUtilization(FULL);
    await w.caller.journal.void({ id: first.journalEntry!.id });
    expect(tbBalance(await book(w), "1510")).toBe("900.00"); // utilisation undone

    await w.caller.itc.recordUtilization(FULL);
    const b = await book(w);
    expect(tbBalance(b, "1510")).toBe("0.00");
    expect(tbBalance(b, "2100")).toBe("-400.00");
    expectBooksBalance(b);
  });

  it("two concurrent re-records still leave exactly one live journal", async () => {
    const w = await createGoldenWorld();
    await seedJuly(w);
    await w.caller.itc.recordUtilization(FULL);
    await Promise.all([w.caller.itc.recordUtilization(FULL), w.caller.itc.recordUtilization(FULL)]);

    const live = (await w.caller.journal.list({})).filter((e) => !e.isVoided && !e.narration?.startsWith("Void:"));
    expect(live).toHaveLength(1);
    const b = await book(w);
    expect(tbBalance(b, "1510")).toBe("0.00");
    expectBooksBalance(b);
  });
});
