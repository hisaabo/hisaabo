/**
 * Scenario 19 — A GST period is a half-open window on the IST calendar:
 * [00:00 IST on day 1 of the month, 00:00 IST on day 1 of the next month).
 *
 * Before 0.10.1 a month was `new Date(year, month - 1, 1)` to `new Date(year, month, 0, 23, 59, 59)`
 * in the SERVER's time zone: a document stamped in the last second of the month, after
 * 23:59:59.000, was in no month; and on a UTC server a date-only "1 April" typed in an Indian
 * browser (stored as the browser's local midnight, 2026-03-31T18:30:00.000Z) fell into MARCH.
 * The same windows decide GSTR-1, GSTR-3B (output and ITC), GSTR-9, GSTR-2B "missing in 2B",
 * CMP-08, the ITC return period of a purchase, the IRP / e-way bill document date, and the
 * dashboard's month comparison. India has no daylight saving: IST is UTC+05:30 all year.
 *
 * Instants used (IST in brackets):
 *   Jan/Feb  2026-01-31T18:29:59.500Z [31 Jan 23:59:59.500]   2026-01-31T18:30:00.000Z [ 1 Feb 00:00:00.000]
 *   Feb/Mar  2026-02-28T18:29:59.999Z [28 Feb 23:59:59.999]   2026-02-28T18:30:00.000Z [ 1 Mar 00:00:00.000]
 *   Mar/Apr  2026-03-31T18:29:59.999Z [31 Mar 23:59:59.999]   2026-03-31T18:30:00.000Z [ 1 Apr 00:00:00.000]
 * The two instants of a pair are one millisecond apart and belong to different months; the
 * Mar/Apr pair is also the FY 2025-26 / 2026-27 boundary.
 *
 * Sales (B2B, Maharashtra buyer, 1 x price @ 18%, CGST + SGST):
 *   S1 Jan 31 [Jan]  1000.00   S2 Feb 1 [Feb] 2000.00   S3 Feb 28 [Feb] 3000.00
 *   S4 Mar 1  [Mar]  4000.00   S5 Mar 31 [Mar] 5000.00  S6 Apr 1 [Apr]  6000.00
 *   GST 18%: 180.00, 360.00, 540.00, 720.00, 900.00, 1080.00 (half each to CGST and SGST)
 *   GSTR-1  Jan  taxable 1000.00 (1 invoice)  CGST 90.00
 *           Feb  taxable 2000.00 + 3000.00 = 5000.00 (2)  CGST 180.00 + 270.00 = 450.00
 *           Mar  taxable 4000.00 + 5000.00 = 9000.00 (2)  CGST 360.00 + 450.00 = 810.00
 *           Apr  taxable 6000.00 (1)                      CGST 540.00
 *   GSTR-9 FY 2025-26 = S1..S5: taxable 15000.00, CGST 90 + 180 + 270 + 360 + 450 = 1350.00
 *          FY 2026-27 = S6: taxable 6000.00, CGST 540.00
 *   CMP-08 FY 2025 Q4 (Jan-Mar 2026) 15000.00 -> 150.00 ; FY 2026 Q1 (Apr-Jun 2026) 6000.00 -> 60.00
 *
 * Purchases (Maharashtra supplier, 1 x price @ 18%):
 *   P1 Jan 31 [Jan] 500.00   P2 Feb 1 [Feb] 100.00   P3 Mar 31 [Mar] 1000.00   P4 Apr 1 [Apr] 2000.00
 *   input GST 90.00 -> 45.00 + 45.00 (Jan), 18.00 -> 9.00 + 9.00 (Feb), 180.00 -> 90.00 + 90.00 (Mar),
 *   360.00 -> 180.00 + 180.00 (Apr). Each purchase writes its ITC entry to the return period of
 *   its IST month. GSTR-2B "missing in 2B" for March lists P3 only, for April P4 only.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { itcLedgerEntries, invoices } from "@hisaabo/db";
import { getTenantTestDb } from "../../helpers/test-db.js";
import { useGoldenDb, createGoldenWorld, addInvoice, type GoldenWorld } from "./golden-helpers.js";

vi.mock("../../../lib/irp-client.js", () => {
  const mockGenerateIRN = vi.fn();
  class MockIRPClient {
    authenticate = vi.fn().mockResolvedValue(undefined);
    generateIRN = mockGenerateIRN;
    cancelIRN = vi.fn();
    isIRNCancelled = vi.fn().mockResolvedValue(false);
  }
  class IRPError extends Error {
    get isRetryable() {
      return false;
    }
  }
  return { IRPClient: MockIRPClient, IRPError, __mockGenerateIRN: mockGenerateIRN };
});

useGoldenDb();

const JAN_LAST = "2026-01-31T18:29:59.500Z"; // 31 Jan 23:59:59.500 IST
const FEB_FIRST = "2026-01-31T18:30:00.000Z"; // 1 Feb 00:00:00.000 IST
const FEB_LAST = "2026-02-28T18:29:59.999Z"; // 28 Feb 23:59:59.999 IST
const MAR_FIRST = "2026-02-28T18:30:00.000Z"; // 1 Mar 00:00:00.000 IST
const MAR_LAST = "2026-03-31T18:29:59.999Z"; // 31 Mar 23:59:59.999 IST
const APR_FIRST = "2026-03-31T18:30:00.000Z"; // 1 Apr 00:00:00.000 IST

describe("golden 19: GST period windows are half-open on the IST calendar", () => {
  let w: GoldenWorld;
  const sale: Record<"S1" | "S2" | "S3" | "S4" | "S5" | "S6", { id: string; invoiceNumber: string }> = {} as never;
  const purchase: Record<"P1" | "P2" | "P3" | "P4", { id: string; invoiceNumber: string }> = {} as never;

  beforeAll(async () => {
    w = await createGoldenWorld();
    const item = (await w.caller.item.create({ name: "Steel Rods", hsn: "730890", unit: "pcs", taxPercent: "18" })).id;
    const customer = (await w.caller.party.create({
      type: "customer", name: "Registered Buyer", gstin: "27AABCM0000R1ZM", state: "Maharashtra", stateCode: "27", openingBalance: "0",
    })).id;
    const supplier = (await w.caller.party.create({
      type: "supplier", name: "Registered Supplier", gstin: "27AABCS0000R1ZM", state: "Maharashtra", stateCode: "27", openingBalance: "0",
    })).id;

    const sell = async (date: string, price: string) => {
      const inv = await addInvoice(w, "sale", customer, [{ name: "Steel Rods", itemId: item, qty: "1", price, tax: "18", unit: "pcs" }], { date });
      return { id: inv.id, invoiceNumber: inv.invoiceNumber };
    };
    const buy = async (date: string, price: string) => {
      const inv = await addInvoice(w, "purchase", supplier, [{ name: "Raw steel", qty: "1", price, tax: "18" }], { date });
      return { id: inv.id, invoiceNumber: inv.invoiceNumber };
    };
    sale.S1 = await sell(JAN_LAST, "1000.00");
    sale.S2 = await sell(FEB_FIRST, "2000.00");
    sale.S3 = await sell(FEB_LAST, "3000.00");
    sale.S4 = await sell(MAR_FIRST, "4000.00");
    sale.S5 = await sell(MAR_LAST, "5000.00");
    sale.S6 = await sell(APR_FIRST, "6000.00");
    purchase.P1 = await buy(JAN_LAST, "500.00");
    purchase.P2 = await buy(FEB_FIRST, "100.00");
    purchase.P3 = await buy(MAR_LAST, "1000.00");
    purchase.P4 = await buy(APR_FIRST, "2000.00");
  });

  describe("GSTR-1: each document is in exactly one month", () => {
    it.each([
      [1, 1000, 1, 90],
      [2, 5000, 2, 450],
      [3, 9000, 2, 810],
      [4, 6000, 1, 540],
    ])("2026-%i: taxable %i, %i invoice(s), CGST %i", async (month, taxable, count, cgst) => {
      const r = await w.caller.gst.gstr1({ year: 2026, month });
      expect([r.totalTaxableValue, r.invoiceCount, r.totalCgst]).toEqual([taxable, count, cgst]);
    });

    it("the six sales are in the six slots with no gap and no overlap (Jan..Apr add up to all of them)", async () => {
      const months = await Promise.all([1, 2, 3, 4].map((month) => w.caller.gst.gstr1({ year: 2026, month })));
      const names = months.map((r) => r.b2b.map((x) => x.invoiceNumber));
      expect(names).toEqual([
        [sale.S1.invoiceNumber],
        [sale.S2.invoiceNumber, sale.S3.invoiceNumber],
        [sale.S4.invoiceNumber, sale.S5.invoiceNumber],
        [sale.S6.invoiceNumber],
      ]);
    });
  });

  describe("the 31 March / 1 April financial-year boundary", () => {
    it("GSTR-9 FY 2025-26 ends with the last millisecond of 31 March; FY 2026-27 starts at 1 April 00:00 IST", async () => {
      const a = await w.caller.gst.gstr9({ financialYear: 2025 });
      expect([a.table4.taxableSuppliesB2B.taxableValue, a.table4.taxableSuppliesB2B.cgst]).toEqual([15000, 1350]);
      const b = await w.caller.gst.gstr9({ financialYear: 2026 });
      expect([b.table4.taxableSuppliesB2B.taxableValue, b.table4.taxableSuppliesB2B.cgst]).toEqual([6000, 540]);
    });

    it("CMP-08 Q4 of FY 2025-26 and Q1 of FY 2026-27, with the exact window", async () => {
      const q4 = await w.caller.gst.cmp08({ year: 2025, quarter: 4 });
      expect([q4.taxableValue, q4.taxPayable]).toEqual(["15000.00", "150.00"]);
      expect(q4.quarterStart).toBe("2025-12-31T18:30:00.000Z"); // 1 Jan 2026 00:00 IST
      expect(q4.quarterEnd).toBe("2026-03-31T18:29:59.999Z"); // 31 Mar 2026 23:59:59.999 IST
      const q1 = await w.caller.gst.cmp08({ year: 2026, quarter: 1 });
      expect([q1.taxableValue, q1.taxPayable]).toEqual(["6000.00", "60.00"]);
      expect(q1.quarterStart).toBe("2026-03-31T18:30:00.000Z"); // 1 Apr 2026 00:00 IST
    });
  });

  describe("GSTR-3B input tax credit uses the same months", () => {
    it.each([
      [1, 45, 45, 90],
      [2, 9, 9, 18],
      [3, 90, 90, 180],
      [4, 180, 180, 360],
    ])("2026-%i: ITC CGST %i + SGST %i = %i", async (month, cgst, sgst, total) => {
      const b = await w.caller.gst.gstr3b({ year: 2026, month });
      expect(b.itc).toEqual({ igst: 0, cgst, sgst, total });
    });
  });

  describe("the ITC return period of a purchase is its IST month", () => {
    it("P1 2026-01, P2 2026-02, P3 2026-03, P4 2026-04", async () => {
      const rows = await getTenantTestDb().select().from(itcLedgerEntries).where(eq(itcLedgerEntries.businessId, w.businessId));
      const periodOf = (id: string) => rows.find((r) => r.invoiceId === id)?.returnPeriod;
      expect([purchase.P1, purchase.P2, purchase.P3, purchase.P4].map((p) => periodOf(p.id))).toEqual([
        "2026-01", "2026-02", "2026-03", "2026-04",
      ]);
    });
  });

  describe("GSTR-2B: purchases of the period that are not in the file", () => {
    const upload = (returnPeriod: string) =>
      w.caller.gstr2b.upload({
        returnPeriod,
        fileName: `gstr2b_${returnPeriod}.json`,
        format: "json",
        // one record that matches none of our purchases, so every purchase of the period is "missing in 2B"
        content: JSON.stringify({
          gstin: "27AABCU9603R1ZM",
          ret_period: returnPeriod.slice(5) + returnPeriod.slice(0, 4),
          docdata: { b2b: [{ ctin: "29AABCZ0000R1ZM", trdnm: "Other", inv: [{ inum: "OTHER-1", dt: "05-03-2026", val: 118, pos: "27", itcavl: "Y", rev: "N", typ: "R", items: [{ num: 1, rt: 18, txval: 100, cgst: 0, sgst: 0, igst: 18, cess: 0 }] }] }] },
        }),
      });

    it("March lists the purchase of 31 March 23:59:59.999 IST only; April lists the one of 1 April 00:00 IST only", async () => {
      await upload("2026-03");
      await upload("2026-04");
      const march = await w.caller.gstr2b.missingIn2B({ returnPeriod: "2026-03", page: 1, limit: 50 });
      expect(march.records.map((r) => r.invoiceNumber)).toEqual([purchase.P3.invoiceNumber]);
      const april = await w.caller.gstr2b.missingIn2B({ returnPeriod: "2026-04", page: 1, limit: 50 });
      expect(april.records.map((r) => r.invoiceNumber)).toEqual([purchase.P4.invoiceNumber]);
    });
  });

  describe("the document date on the e-invoice is the IST date", () => {
    beforeEach(async () => {
      const m = (await import("../../../lib/irp-client.js")) as unknown as { __mockGenerateIRN: ReturnType<typeof vi.fn> };
      m.__mockGenerateIRN.mockReset();
      m.__mockGenerateIRN.mockResolvedValue({ irn: "C".repeat(64), ackNo: "1", ackDt: new Date("2026-04-02T00:00:00Z"), signedQrCode: "QR", signedInvoice: "SIGNED" });
    });

    it("1 April 00:00 IST (stored 31 March 18:30 UTC) is 01/04/2026; the millisecond before is 31/03/2026", async () => {
      await w.caller.eInvoice.configure({
        gstin: "27AABCU9603R1ZM", clientId: "id", clientSecret: "secret", username: "user", password: "password",
        isSandbox: true, isEnabled: true, thresholdCrore: "5",
      });
      const m = (await import("../../../lib/irp-client.js")) as unknown as { __mockGenerateIRN: ReturnType<typeof vi.fn> };
      await w.caller.eInvoice.generate({ invoiceId: sale.S6.id });
      expect(m.__mockGenerateIRN.mock.calls[0]![0].DocDtls.Dt).toBe("01/04/2026");
      await w.caller.eInvoice.generate({ invoiceId: sale.S5.id });
      expect(m.__mockGenerateIRN.mock.calls[1]![0].DocDtls.Dt).toBe("31/03/2026");
      const [row] = await getTenantTestDb().select().from(invoices).where(eq(invoices.id, sale.S6.id));
      expect(row!.eInvoiceStatus).toBe("generated");
    });
  });

  describe("the dashboard's this-month / last-month comparison", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("at 00:30 IST on 1 April, 'this month' is April (S6 + P4) and 'last month' is March (S4 + S5 + P3)", async () => {
      vi.setSystemTime(new Date("2026-03-31T19:00:00.000Z")); // 1 Apr 2026 00:30 IST, still 31 March in UTC
      const r = await w.caller.dashboard.monthlyComparison();
      expect([r.currMonth, r.prevMonth]).toEqual(["Apr 26", "Mar 26"]);
      // sales totals include GST: S6 6000 x 1.18 = 7080 ; S4 4000 x 1.18 + S5 5000 x 1.18 = 4720 + 5900 = 10620
      expect([r.sales.curr, r.sales.prev]).toEqual(["7080.00", "10620.00"]);
      // purchases: P4 2000 x 1.18 = 2360 ; P3 1000 x 1.18 = 1180
      expect([r.purchases.curr, r.purchases.prev]).toEqual(["2360.00", "1180.00"]);
    });
  });
});
