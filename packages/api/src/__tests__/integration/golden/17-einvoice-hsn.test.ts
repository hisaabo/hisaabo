/**
 * Scenario 17 — HSN on the IRP payload: a real code on every line, 4 or 6 digits by turnover.
 *
 * Before 0.10.1 a line whose item had no HSN was sent to the IRP as HsnCd "9999". Now the
 * e-invoice is refused BEFORE the IRP is called and before the invoice's state changes, with a
 * message per line ("line N 'Item' has no HSN code; add it on the item"). The digit minimum
 * follows the business's annual turnover: 4 digits up to and including ₹5,00,00,000
 * (50000000.00), 6 digits above, in exact paise. Unknown turnover = the 4-digit minimum.
 * HSN comes from the live item (invoice lines carry no HSN snapshot until 0.11.0).
 *
 * The IRP client is mocked; the payload handed to generateIRN is the thing under test.
 * One customer in the business's own state (Maharashtra, CGST + SGST), 18% GST.
 *
 *   X  two lines: Steel Rods 1 x 1000.00 (HSN 730890), Copper Wire 1 x 2000.00 (no HSN yet)
 *        refused: "line 2 'Copper Wire' has no HSN code; add it on the item"; nothing sent, nothing written.
 *        After Copper Wire gets HSN 7408 it goes out:
 *          line 1  taxable 1000.00  GST 180.00 = CGST 90.00 + SGST 90.00
 *          line 2  taxable 2000.00  GST 360.00 = CGST 180.00 + SGST 180.00
 *          totals  AssVal 3000.00, CGST 270.00, SGST 270.00, invoice 3540.00
 *          HsnCd "730890" then "7408" (the item codes, never "9999")
 *   T  one line each of 1 x 1000.00 of a 4-digit (5208), 6-digit (730890) or 8-digit (73069000) item:
 *        turnover 49999999.99   4-digit OK                       (just below ₹5 Cr)
 *        turnover 50000000.00   4-digit OK                       (exactly ₹5 Cr)
 *        turnover 50000000.01   4-digit REFUSED, 6-digit OK, 8-digit OK   (one paisa above)
 *        turnover unknown       4-digit OK
 *   A  the automatic submission after invoice.create with a missing HSN records the refusal on
 *        the invoice (failed, with the message) and never calls the IRP.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { businesses, invoices } from "@hisaabo/db";
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

const IRP_OK = {
  irn: "B".repeat(64),
  ackNo: "112010000000002",
  ackDt: new Date("2026-01-15T10:00:00Z"),
  signedQrCode: "QR",
  signedInvoice: "SIGNED",
};

async function irpMock() {
  const m = (await import("../../../lib/irp-client.js")) as unknown as {
    __mockGenerateIRN: ReturnType<typeof vi.fn>;
  };
  return m.__mockGenerateIRN;
}

const NO_HSN_MESSAGE = "line 2 'Copper Wire' has no HSN code; add it on the item";
const ABOVE_5CR_4_DIGITS =
  "line 1 'Cotton' has HSN code '5208': Businesses with turnover above ₹5 Cr must use a minimum 6-digit HSN code. Provided code has 4 digits.";

describe("golden 17: HSN on the IRP payload", () => {
  let w: GoldenWorld;
  const item: Record<"steel6" | "cotton4" | "bar8" | "copper", string> = {} as never;
  const inv: Record<string, string> = {};

  const setTurnover = (annualTurnover: string | null) =>
    getTenantTestDb().update(businesses).set({ annualTurnover }).where(eq(businesses.id, w.businessId));

  beforeAll(async () => {
    w = await createGoldenWorld();
    item.steel6 = (await w.caller.item.create({ name: "Steel Rods", hsn: "730890", unit: "pcs", taxPercent: "18" })).id;
    item.cotton4 = (await w.caller.item.create({ name: "Cotton", hsn: "5208", unit: "pcs", taxPercent: "18" })).id;
    item.bar8 = (await w.caller.item.create({ name: "Bar", hsn: "73069000", unit: "pcs", taxPercent: "18" })).id;
    item.copper = (await w.caller.item.create({ name: "Copper Wire", unit: "pcs", taxPercent: "18" })).id; // no HSN

    const buyer = await w.caller.party.create({
      type: "customer",
      name: "Registered Buyer",
      gstin: "27AABCM0000R1ZM",
      state: "Maharashtra",
      stateCode: "27",
      openingBalance: "0",
    });
    const date = "2026-01-15T10:00:00.000Z";
    const sale = async (lines: Array<{ name: string; itemId: string; price: string }>) =>
      (await addInvoice(w, "sale", buyer.id, lines.map((l) => ({ name: l.name, qty: "1", price: l.price, tax: "18", itemId: l.itemId, unit: "pcs" })), { date })).id;

    inv.X = await sale([
      { name: "Steel Rods", itemId: item.steel6, price: "1000.00" },
      { name: "Copper Wire", itemId: item.copper, price: "2000.00" },
    ]);
    inv.below = await sale([{ name: "Cotton", itemId: item.cotton4, price: "1000.00" }]);
    inv.exact = await sale([{ name: "Cotton", itemId: item.cotton4, price: "1000.00" }]);
    inv.above4 = await sale([{ name: "Cotton", itemId: item.cotton4, price: "1000.00" }]);
    inv.above6 = await sale([{ name: "Steel Rods", itemId: item.steel6, price: "1000.00" }]);
    inv.above8 = await sale([{ name: "Bar", itemId: item.bar8, price: "1000.00" }]);
    inv.unknown = await sale([{ name: "Cotton", itemId: item.cotton4, price: "1000.00" }]);

    // Enable e-invoicing only after those invoices exist: invoice.create submits on its own once it is on.
    await w.caller.eInvoice.configure({
      gstin: "27AABCU9603R1ZM",
      clientId: "id",
      clientSecret: "secret",
      username: "user",
      password: "password",
      isSandbox: true,
      isEnabled: true,
      thresholdCrore: "5",
    });
  });

  beforeEach(async () => {
    const m = await irpMock();
    m.mockReset();
    m.mockResolvedValue(IRP_OK);
  });

  async function row(id: string) {
    const [r] = await getTenantTestDb().select().from(invoices).where(eq(invoices.id, id));
    return r!;
  }

  async function payloadFor(invoiceId: string) {
    await w.caller.eInvoice.generate({ invoiceId });
    const m = await irpMock();
    expect(m).toHaveBeenCalledTimes(1);
    return m.mock.calls[0]![0] as {
      ItemList: Array<Record<string, unknown>>;
      ValDtls: Record<string, unknown>;
    };
  }

  async function expectRefused(invoiceId: string, message: string) {
    const before = await row(invoiceId);
    await expect(w.caller.eInvoice.generate({ invoiceId })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining(message) });
    expect(await irpMock()).not.toHaveBeenCalled();
    const after = await row(invoiceId);
    expect(after.eInvoiceStatus).toBe(before.eInvoiceStatus);
    expect(after.eInvoiceError).toBeNull();
    expect(after.eInvoiceRetryCount ?? 0).toBe(before.eInvoiceRetryCount ?? 0);
    expect(after.irn).toBeNull();
  }

  it("X: a line with no HSN is refused before the IRP, naming the line, leaving the invoice untouched", async () => {
    await expectRefused(inv.X!, NO_HSN_MESSAGE);
  });

  it("X: once the item has an HSN the e-invoice goes out with the item codes", async () => {
    await w.caller.item.update({ id: item.copper, data: { hsn: "7408" } });
    const p = await payloadFor(inv.X!);
    expect(p.ItemList.map((l) => l.HsnCd)).toEqual(["730890", "7408"]);
    expect(p.ItemList[0]).toMatchObject({ AssAmt: 1000, CgstAmt: 90, SgstAmt: 90, IgstAmt: 0, TotItemVal: 1180 });
    expect(p.ItemList[1]).toMatchObject({ AssAmt: 2000, CgstAmt: 180, SgstAmt: 180, IgstAmt: 0, TotItemVal: 2360 });
    expect(p.ValDtls).toMatchObject({ AssVal: 3000, CgstVal: 270, SgstVal: 270, IgstVal: 0, TotInvVal: 3540 });
    expect(JSON.stringify(p)).not.toContain("9999");
    expect((await row(inv.X!)).eInvoiceStatus).toBe("generated");
  });

  describe("the digit minimum follows turnover, exactly (4 digits up to ₹5 Cr, 6 above)", () => {
    it("turnover 49999999.99, just below: a 4-digit HSN is accepted", async () => {
      await setTurnover("49999999.99");
      const p = await payloadFor(inv.below!);
      expect(p.ItemList[0]!.HsnCd).toBe("5208");
    });

    it("turnover exactly 50000000.00: a 4-digit HSN is still accepted", async () => {
      await setTurnover("50000000.00");
      const p = await payloadFor(inv.exact!);
      expect(p.ItemList[0]!.HsnCd).toBe("5208");
    });

    it("turnover 50000000.01, one paisa above: a 4-digit HSN is refused", async () => {
      await setTurnover("50000000.01");
      await expectRefused(inv.above4!, ABOVE_5CR_4_DIGITS);
    });

    it("turnover 50000000.01: 6-digit and 8-digit HSNs are accepted", async () => {
      await setTurnover("50000000.01");
      expect((await payloadFor(inv.above6!)).ItemList[0]!.HsnCd).toBe("730890");
      const m = await irpMock();
      m.mockReset();
      m.mockResolvedValue(IRP_OK);
      expect((await payloadFor(inv.above8!)).ItemList[0]!.HsnCd).toBe("73069000");
    });

    it("turnover unknown: the 4-digit minimum applies", async () => {
      await setTurnover(null);
      const p = await payloadFor(inv.unknown!);
      expect(p.ItemList[0]!.HsnCd).toBe("5208");
    });
  });

  it("A: the automatic submission after invoice.create records the refusal on the invoice and never calls the IRP", async () => {
    await setTurnover(null);
    const buyer = await w.caller.party.create({
      type: "customer",
      name: "Auto Buyer",
      gstin: "27AABCA0000R1ZM",
      state: "Maharashtra",
      stateCode: "27",
      openingBalance: "0",
    });
    const noHsnItem = await w.caller.item.create({ name: "No HSN Item", unit: "pcs", taxPercent: "18" });
    const created = await w.caller.invoice.create({
      partyId: buyer.id,
      type: "sale",
      lineItems: [{ itemId: noHsnItem.id, itemName: "No HSN Item", quantity: "1", unitPrice: "500.00", taxPercent: "18.00" }],
    });
    await vi.waitFor(async () => {
      expect((await row(created.id)).eInvoiceStatus).toBe("failed");
    }, { timeout: 5000, interval: 50 });
    const after = await row(created.id);
    expect(after.eInvoiceError).toBe("Cannot generate the e-invoice: line 1 'No HSN Item' has no HSN code; add it on the item.");
    expect(await irpMock()).not.toHaveBeenCalled();
  });
});
