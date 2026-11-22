/**
 * Scenario 16 — GST return periods are April-March, whatever the business's books year is.
 *
 * `businesses.financialYearStart` is the month the business's own accounting year starts
 * (default 4 = April). It moves the accounting reports only (trial balance, P&L, balance
 * sheet, dashboard). GSTR-1 / 3B are filed by calendar month, GSTR-9 for April to March, and
 * CMP-08 for the April-June, July-September, October-December and January-March quarters,
 * for EVERY business. The same eight sales are booked in three businesses whose books start
 * in April (4), January (1) and July (7); every GST figure must be identical in all three,
 * and only the accounting trial balance may differ.
 *
 * Eight B2B sales at 18% to a customer in the business's own state (Maharashtra, CGST + SGST):
 *
 *   date         qty x price      taxable    GST 18%   CGST     SGST     GST FY
 *   2025-05-12   7 x 1000.00      7000.00    1260.00   630.00   630.00   2025-26
 *   2025-08-10   1 x 100.50       100.50     18.09     9.05     9.04     2025-26   odd paisa -> CGST
 *   2025-12-15   1 x 1000.00      1000.00    180.00    90.00    90.00    2025-26
 *   2026-01-20   2 x 1000.00      2000.00    360.00    180.00   180.00   2025-26
 *   2026-03-31   3 x 1000.00      3000.00    540.00    270.00   270.00   2025-26   last day of FY
 *   2026-04-01   4 x 1000.00      4000.00    720.00    360.00   360.00   2026-27   first day of FY
 *   2026-06-10   5 x 1000.00      5000.00    900.00    450.00   450.00   2026-27
 *   2026-07-05   6 x 1000.00      6000.00    1080.00   540.00   540.00   2026-27
 *
 *   18.09 = 100.50 x 18%; split in half = 9.045 -> CGST 9.05 (round half up), SGST 9.04.
 *
 * GSTR-9 FY 2025-26 (Apr 2025 - Mar 2026): May, Aug, Dec, Jan, 31 Mar
 *     taxable 7000.00 + 100.50 + 1000.00 + 2000.00 + 3000.00      = 13100.50
 *     CGST    630.00 + 9.05 + 90.00 + 180.00 + 270.00             =  1179.05
 *     SGST    630.00 + 9.04 + 90.00 + 180.00 + 270.00             =  1179.04
 * GSTR-9 FY 2026-27 (Apr 2026 - Mar 2027): 1 Apr, Jun, Jul
 *     taxable 4000.00 + 5000.00 + 6000.00                         = 15000.00
 *     CGST    360.00 + 450.00 + 540.00                            =  1350.00     SGST the same
 *
 * CMP-08 (composition dealer, 1% of taxable value), FY 2025-26 then 2026-27:
 *     Q1 Apr-Jun 2025   7000.00            -> 70.00
 *     Q2 Jul-Sep 2025    100.50            ->  1.01     (1.005 rounds half up)
 *     Q3 Oct-Dec 2025   1000.00            -> 10.00
 *     Q4 Jan-Mar 2026   2000.00 + 3000.00  = 5000.00 -> 50.00   (31 Mar in, 1 Apr out)
 *     Q1 Apr-Jun 2026   4000.00 + 5000.00  = 9000.00 -> 90.00
 *     Q2 Jul-Sep 2026   6000.00            -> 60.00
 *     Q3 Oct-Dec 2026   nothing            ->  0.00
 *
 * Accounting trial balance as of 31 Mar 2026, from the start of the business's OWN year
 * (the only figures that depend on financialYearStart), credit on Sales (4000):
 *     April books  from 2025-04-01   13100.50
 *     January books from 2026-01-01   2000.00 + 3000.00 = 5000.00
 *     July books   from 2025-07-01   100.50 + 1000.00 + 2000.00 + 3000.00 = 6100.50
 */
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { businesses } from "@hisaabo/db";
import { getTenantTestDb } from "../../helpers/test-db.js";
import { useGoldenDb, createGoldenWorld, addInvoice, type GoldenWorld } from "./golden-helpers.js";

useGoldenDb();

const SALES: Array<{ date: string; qty: string; price: string }> = [
  { date: "2025-05-12T12:00:00.000Z", qty: "7", price: "1000.00" },
  { date: "2025-08-10T12:00:00.000Z", qty: "1", price: "100.50" },
  { date: "2025-12-15T12:00:00.000Z", qty: "1", price: "1000.00" },
  { date: "2026-01-20T12:00:00.000Z", qty: "2", price: "1000.00" },
  { date: "2026-03-31T12:00:00.000Z", qty: "3", price: "1000.00" },
  { date: "2026-04-01T12:00:00.000Z", qty: "4", price: "1000.00" },
  { date: "2026-06-10T12:00:00.000Z", qty: "5", price: "1000.00" },
  { date: "2026-07-05T12:00:00.000Z", qty: "6", price: "1000.00" },
];

describe.each([4, 1, 7] as const)("golden 16: GST return periods, books start in month %i (4 = April, 1 = January, 7 = July)", (fyStartMonth) => {
  let w: GoldenWorld;

  beforeAll(async () => {
    w = await createGoldenWorld();
    await getTenantTestDb().update(businesses).set({ financialYearStart: fyStartMonth }).where(eq(businesses.id, w.businessId));
    const buyer = await w.caller.party.create({
      type: "customer",
      name: "Registered Buyer",
      gstin: "27AABCM0000R1ZM",
      state: "Maharashtra",
      stateCode: "27",
      openingBalance: "0",
    });
    for (const s of SALES) {
      await addInvoice(w, "sale", buyer.id, [{ name: "Goods", qty: s.qty, price: s.price, tax: "18" }], { date: s.date });
    }
  });

  describe("GSTR-1 JSON: filing period and GST financial year follow the calendar month", () => {
    // fp = MMYYYY; the financial year runs April to March.
    it.each([
      [5, 2025, "052025", "2025-26", 7000],
      [12, 2025, "122025", "2025-26", 1000],
      [1, 2026, "012026", "2025-26", 2000], // January: still FY 2025-26, even for a January-start business
      [3, 2026, "032026", "2025-26", 3000], // 31 March
      [4, 2026, "042026", "2026-27", 4000], // 1 April
      [6, 2026, "062026", "2026-27", 5000], // April-June: FY 2026-27, even for a July-start business
      [7, 2026, "072026", "2026-27", 6000],
    ])("month %i/%i -> fp %s, FY %s, taxable %i", async (month, year, fp, fy, taxable) => {
      const r = await w.caller.gst.gstr1Json({ year, month });
      expect(r.financialYear).toBe(fy);
      const json = r.json as { fp: string; b2b: Array<{ inv: Array<{ itms: Array<{ itm_det: { txval: number } }> }> }> };
      expect(json.fp).toBe(fp);
      expect(json.b2b).toHaveLength(1);
      expect(json.b2b[0]!.inv).toHaveLength(1);
      expect(json.b2b[0]!.inv[0]!.itms[0]!.itm_det.txval).toBe(taxable);
    });
  });

  describe("GSTR-9 covers April to March", () => {
    it("FY 2025-26: Apr 2025 - Mar 2026, five sales", async () => {
      const r = await w.caller.gst.gstr9({ financialYear: 2025 });
      expect(r.financialYear).toBe("2025-26");
      expect(r.periodStart).toBe("Apr 2025");
      expect(r.periodEnd).toBe("Mar 2026");
      expect(r.table4.taxableSuppliesB2B.taxableValue.toFixed(2)).toBe("13100.50");
      expect(r.table4.taxableSuppliesB2B.cgst.toFixed(2)).toBe("1179.05");
      expect(r.table4.taxableSuppliesB2B.sgst.toFixed(2)).toBe("1179.04");
      expect(r.table4.taxableSuppliesB2B.igst).toBe(0);
    });

    it("FY 2026-27: Apr 2026 - Mar 2027, three sales (1 April is in, 31 March is not)", async () => {
      const r = await w.caller.gst.gstr9({ financialYear: 2026 });
      expect(r.financialYear).toBe("2026-27");
      expect(r.periodStart).toBe("Apr 2026");
      expect(r.periodEnd).toBe("Mar 2027");
      expect(r.table4.taxableSuppliesB2B.taxableValue.toFixed(2)).toBe("15000.00");
      expect(r.table4.taxableSuppliesB2B.cgst.toFixed(2)).toBe("1350.00");
      expect(r.table4.taxableSuppliesB2B.sgst.toFixed(2)).toBe("1350.00");
    });

    it("the portal JSON names the April-March year", async () => {
      const r = await w.caller.gst.gstr9Json({ financialYear: 2025 });
      expect(r.filename).toBe("GSTR9_FY2025_26_portal.json");
      expect((r.json as { fy: string }).fy).toBe("2025-26");
    });
  });

  describe("CMP-08 quarters are the GST quarters (year = start year of the financial year)", () => {
    it.each([
      [2025, 1, "7000.00", "70.00"],
      [2025, 2, "100.50", "1.01"], // 1% of 100.50 = 1.005 -> 1.01
      [2025, 3, "1000.00", "10.00"],
      [2025, 4, "5000.00", "50.00"], // Jan-Mar 2026
      [2026, 1, "9000.00", "90.00"], // Apr-Jun 2026
      [2026, 2, "6000.00", "60.00"],
      [2026, 3, "0.00", "0.00"],
    ])("FY %i Q%i: taxable %s, tax %s", async (year, quarter, taxable, tax) => {
      const r = await w.caller.gst.cmp08({ year, quarter });
      expect(r.taxableValue).toBe(taxable);
      expect(r.taxPayable).toBe(tax);
    });
  });

  describe("only the accounting reports follow the books year", () => {
    const expectedSales = { 4: "13100.50", 1: "5000.00", 7: "6100.50" } as const;
    it("the default trial balance starts at the business's own year start", async () => {
      const tb = await w.caller.reports.trialBalance({ asOfDate: "2026-03-31T23:00:00.000Z" });
      const sales = tb.accounts.find((a) => a.accountCode === "4000");
      expect(sales?.credit).toBe(expectedSales[fyStartMonth]);
    });
  });
});
