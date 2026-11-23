/**
 * Scenario 20 — HSN on the e-way bill payload: a real code on every line, 4 or 6 digits by turnover.
 *
 * Before 0.10.1 a line whose item had no HSN went to the NIC as hsnCode "". Now the e-way bill is
 * refused BEFORE the NIC is called and before anything is written, with the same per-line message
 * as the e-invoice ("line N 'Item' has no HSN code; add it on the item") and the same digit
 * minimum: 4 digits up to and including ₹5,00,00,000 (50000000.00), 6 above, exact in paise;
 * unknown turnover = the 4-digit minimum. HSN comes from the live item.
 *
 * The NIC client is mocked; the payload handed to generateEWB is the thing under test.
 * One customer in the business's own state (Maharashtra, CGST + SGST). Items: Steel Rods (HSN 730890,
 * kg), Cotton (HSN 5208, m), Copper Wire (no HSN yet).
 *
 *   X  Steel Rods 600 kg x 100.00 @ 18% + Copper Wire 1 x 1000.00 @ 18%
 *        taxable 60000.00 + 1000.00 = 61000.00; GST 10800.00 + 180.00 = 10980.00
 *        refused: "line 2 'Copper Wire' has no HSN code; add it on the item"; nothing sent, no e-way bill row.
 *        After Copper Wire gets HSN 7408 it goes out:
 *          itemList hsnCode "730890" then "7408" (never ""), totalValue 61000.00,
 *          CGST 5490.00 = 5400.00 + 90.00, SGST 5490.00, IGST 0
 *   T  Cotton 700 m x 100.00 @ 12% (taxable 70000.00, total 78400.00 > ₹50,000), 4-digit HSN 5208
 *        turnover 50000000.00   OK         (exactly ₹5 Cr)
 *        turnover 50000000.01   REFUSED    (one paisa above; needs 6 digits)
 *      Steel Rods 600 kg x 100.00 @ 18% (6-digit HSN) at turnover 50000000.01   OK
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { businesses, ewayBills } from "@hisaabo/db";
import { getTenantTestDb } from "../../helpers/test-db.js";
import { useGoldenDb, createGoldenWorld, addInvoice, type GoldenWorld } from "./golden-helpers.js";

vi.mock("../../../lib/ewb-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/ewb-client.js")>();
  const mockGenerateEWB = vi.fn();
  class MockEWBClient {
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
    }
    generateEWB = mockGenerateEWB;
  }
  return { ...actual, EWBClient: MockEWBClient, __mockGenerateEWB: mockGenerateEWB };
});

process.env.NIC_EWB_CLIENT_ID = "TEST_CLIENT_ID";
process.env.NIC_EWB_CLIENT_SECRET = "TEST_CLIENT_SECRET";
process.env.NIC_EWB_USERNAME = "test@nic.in";
process.env.NIC_EWB_PASSWORD = "TestPassword123";
process.env.NIC_EWB_SANDBOX = "true";

useGoldenDb();

async function ewbMock() {
  const m = (await import("../../../lib/ewb-client.js")) as unknown as { __mockGenerateEWB: ReturnType<typeof vi.fn> };
  return m.__mockGenerateEWB;
}

const TRANSPORT = { vehicleNumber: "MH12AB1234", vehicleType: "regular", transportMode: "road", distance: 250 } as const;

describe("golden 20: HSN on the e-way bill payload", () => {
  let w: GoldenWorld;
  const item: Record<"steel6" | "cotton4" | "copper", string> = {} as never;
  const inv: Record<"X" | "exact" | "above4" | "above6", string> = {} as never;

  const setTurnover = (annualTurnover: string | null) =>
    getTenantTestDb().update(businesses).set({ annualTurnover }).where(eq(businesses.id, w.businessId));

  beforeAll(async () => {
    w = await createGoldenWorld();
    item.steel6 = (await w.caller.item.create({ name: "Steel Rods", hsn: "730890", unit: "kg", taxPercent: "18" })).id;
    item.cotton4 = (await w.caller.item.create({ name: "Cotton", hsn: "5208", unit: "m", taxPercent: "12" })).id;
    item.copper = (await w.caller.item.create({ name: "Copper Wire", unit: "pcs", taxPercent: "18" })).id; // no HSN

    const buyer = (await w.caller.party.create({
      type: "customer", name: "Registered Buyer", gstin: "27AABCM0000R1ZM", state: "Maharashtra", stateCode: "27", pincode: "411001", openingBalance: "0",
    })).id;
    const date = "2026-01-15T10:00:00.000Z";
    const sale = async (lines: Array<{ name: string; itemId: string; qty: string; price: string; tax: string }>) =>
      (await addInvoice(w, "sale", buyer, lines, { date })).id;

    inv.X = await sale([
      { name: "Steel Rods", itemId: item.steel6, qty: "600", price: "100.00", tax: "18" },
      { name: "Copper Wire", itemId: item.copper, qty: "1", price: "1000.00", tax: "18" },
    ]);
    inv.exact = await sale([{ name: "Cotton", itemId: item.cotton4, qty: "700", price: "100.00", tax: "12" }]);
    inv.above4 = await sale([{ name: "Cotton", itemId: item.cotton4, qty: "700", price: "100.00", tax: "12" }]);
    inv.above6 = await sale([{ name: "Steel Rods", itemId: item.steel6, qty: "600", price: "100.00", tax: "18" }]);
  });

  beforeEach(async () => {
    const m = await ewbMock();
    m.mockReset();
    m.mockResolvedValue({ ewayBillNo: "121600005025", ewayBillDate: "15/01/2026 10:30:00 AM", validUpto: "16/01/2026 10:30:00 AM" });
  });

  const rowsFor = (invoiceId: string) =>
    getTenantTestDb().select().from(ewayBills).where(eq(ewayBills.invoiceId, invoiceId));

  async function expectRefused(invoiceId: string, message: string) {
    await expect(w.caller.ewayBill.generate({ invoiceId, ...TRANSPORT })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining(message),
    });
    expect(await ewbMock()).not.toHaveBeenCalled();
    expect(await rowsFor(invoiceId)).toHaveLength(0);
  }

  async function payloadFor(invoiceId: string) {
    await w.caller.ewayBill.generate({ invoiceId, ...TRANSPORT });
    const m = await ewbMock();
    expect(m).toHaveBeenCalledTimes(1);
    return m.mock.calls[0]![1] as {
      docDate: string;
      totalValue: number;
      cgstValue: number;
      sgstValue: number;
      igstValue: number;
      itemList: Array<{ hsnCode: string; taxableAmount: number }>;
    };
  }

  it("X: a line with no HSN is refused before the NIC, naming the line, with nothing written", async () => {
    await expectRefused(inv.X, "Cannot generate the e-way bill: line 2 'Copper Wire' has no HSN code; add it on the item.");
  });

  it("X: once the item has an HSN the e-way bill goes out with the item codes", async () => {
    await w.caller.item.update({ id: item.copper, data: { hsn: "7408" } });
    const p = await payloadFor(inv.X);
    expect(p.itemList.map((l) => [l.hsnCode, l.taxableAmount])).toEqual([["730890", 60000], ["7408", 1000]]);
    expect([p.totalValue, p.cgstValue, p.sgstValue, p.igstValue]).toEqual([61000, 5490, 5490, 0]);
    expect(p.docDate).toBe("15/01/2026");
    expect(await rowsFor(inv.X)).toHaveLength(1);
  });

  describe("the digit minimum follows turnover, exactly", () => {
    it("turnover exactly 50000000.00: a 4-digit HSN is accepted", async () => {
      await setTurnover("50000000.00");
      const p = await payloadFor(inv.exact);
      expect(p.itemList[0]!.hsnCode).toBe("5208");
    });

    it("turnover 50000000.01, one paisa above: a 4-digit HSN is refused", async () => {
      await setTurnover("50000000.01");
      await expectRefused(
        inv.above4,
        "line 1 'Cotton' has HSN code '5208': Businesses with turnover above ₹5 Cr must use a minimum 6-digit HSN code. Provided code has 4 digits.",
      );
    });

    it("turnover 50000000.01: a 6-digit HSN is accepted", async () => {
      await setTurnover("50000000.01");
      const p = await payloadFor(inv.above6);
      expect(p.itemList[0]!.hsnCode).toBe("730890");
    });
  });
});
