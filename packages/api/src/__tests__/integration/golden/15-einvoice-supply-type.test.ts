/**
 * Scenario 15 — The IRP payload for domestic B2B sales (supply type, tax split, place of supply).
 *
 * The IRP (e-invoice) takes TranDtls.SupTyp in {B2B, SEZWP, SEZWOP, EXPWP, EXPWOP, DEXP}.
 * Hisaabo has no export / SEZ fields until 0.11.0, so EVERY invoice it e-invoices is a
 * domestic B2B supply: SupTyp = "B2B" whether the sale is intra- or inter-state. Intra- vs
 * inter-state shows only in the tax split (CGST + SGST vs IGST) and the place of supply
 * (BuyerDtls.Pos = the buyer's state). The business is in Maharashtra (27).
 * Before 0.10.1 every inter-state sale was sent as "EXPWP" (export with payment).
 *
 * The IRP client is mocked; the payload handed to generateIRN is the thing under test.
 *
 *   A  inter-state, customer in Karnataka (29)   10 x 1000.00 @ 18%
 *        taxable 10 x 1000.00                = 10000.00
 *        IGST    10000.00 x 18%              =  1800.00   (CGST 0, SGST 0)
 *        total   10000.00 + 1800.00          = 11800.00
 *        SupTyp B2B, Pos 29, IgstOnIntra N
 *   B  intra-state, customer in Maharashtra (27)  10 x 1000.00 @ 18%
 *        CGST 900.00 + SGST 900.00, IGST 0, total 11800.00; SupTyp B2B, Pos 27
 *   C  inter-state, customer with a GSTIN but NO state code on file (the rest of the
 *        books treat "cannot compare" as IGST). The state is read from the GSTIN (29...),
 *        so it is inter-state: IGST, Pos 29. (Before 0.10.1 the missing state was taken
 *        to be the seller's: CGST + SGST and Pos 27.)
 *   D  paise: 1 x 5.80 @ 5% = 0.29 of tax
 *        inter-state: IGST 0.29
 *        intra-state: CGST 0.15 (odd paisa) + SGST 0.14
 *   E  exports are refused, before the IRP is called and without touching the invoice:
 *        customer state code 96 ("other country"); customer GSTIN "URP".
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, parties } from "@hisaabo/db";
import { getTenantTestDb } from "../../helpers/test-db.js";
import {
  useGoldenDb,
  createGoldenWorld,
  addInvoice,
  type GoldenWorld,
} from "./golden-helpers.js";

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
  irn: "A".repeat(64),
  ackNo: "112010000000001",
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

describe("golden 15: IRP payload for domestic B2B sales", () => {
  let w: GoldenWorld;
  let itemId: string;
  const invoiceIds: Record<"A" | "B" | "C" | "D_inter" | "D_intra" | "E_96" | "E_urp", string> = {} as never;
  const partyIds: Record<string, string> = {};

  beforeAll(async () => {
    w = await createGoldenWorld();
    // 6-digit HSN: valid at any turnover.
    itemId = (await w.caller.item.create({ name: "Steel Rods", hsn: "730890", unit: "pcs", taxPercent: "18" })).id;

    const mkParty = async (key: string, p: { name: string; gstin: string; state?: string; stateCode?: string }) => {
      partyIds[key] = (await w.caller.party.create({ type: "customer", openingBalance: "0", ...p })).id;
    };
    await mkParty("KA", { name: "Karnataka Buyer", gstin: "29AABCG0000R1ZM", state: "Karnataka", stateCode: "29" });
    await mkParty("MH", { name: "Maharashtra Buyer", gstin: "27AABCM0000R1ZM", state: "Maharashtra", stateCode: "27" });
    await mkParty("NOSTATE", { name: "Buyer No State", gstin: "29AABCN0000R1ZM" });
    await mkParty("CODE96", { name: "Foreign Buyer", gstin: "29AABCF0000R1ZM", state: "Other Country", stateCode: "96" });
    await mkParty("URP", { name: "URP Buyer", gstin: "29AABCU1111R1ZM", state: "Karnataka", stateCode: "29" });
    // "URP" is not a GSTIN the party validator accepts, so it reaches a party only via an import / the database.
    await getTenantTestDb().update(parties).set({ gstin: "URP" }).where(eq(parties.id, partyIds.URP!));

    const date = "2026-01-15T10:00:00.000Z";
    const sale = async (partyKey: string, qty: string, price: string, tax: string) =>
      (await addInvoice(w, "sale", partyIds[partyKey]!, [{ name: "Steel Rods", qty, price, tax, itemId, unit: "pcs" }], { date })).id;
    invoiceIds.A = await sale("KA", "10", "1000.00", "18");
    invoiceIds.B = await sale("MH", "10", "1000.00", "18");
    invoiceIds.C = await sale("NOSTATE", "10", "1000.00", "18");
    invoiceIds.D_inter = await sale("KA", "1", "5.80", "5");
    invoiceIds.D_intra = await sale("MH", "1", "5.80", "5");
    invoiceIds.E_96 = await sale("CODE96", "10", "1000.00", "18");
    invoiceIds.E_urp = await sale("URP", "10", "1000.00", "18");

    // Enable e-invoicing only after the invoices exist: invoice.create submits on its own once it is on.
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

  async function payloadFor(invoiceId: string) {
    await w.caller.eInvoice.generate({ invoiceId });
    const m = await irpMock();
    expect(m).toHaveBeenCalledTimes(1);
    return m.mock.calls[0]![0] as {
      TranDtls: Record<string, unknown>;
      SellerDtls: { Stcd: string };
      BuyerDtls: { Pos: string; Stcd: string };
      ItemList: Array<Record<string, unknown>>;
      ValDtls: Record<string, unknown>;
    };
  }

  it("A: inter-state sale is B2B with IGST and Pos 29 (not EXPWP)", async () => {
    const p = await payloadFor(invoiceIds.A);
    expect(p.TranDtls).toEqual({ TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" });
    expect(p.SellerDtls.Stcd).toBe("27");
    expect(p.BuyerDtls.Stcd).toBe("29");
    expect(p.BuyerDtls.Pos).toBe("29");
    expect(p.ItemList).toHaveLength(1);
    expect(p.ItemList[0]).toMatchObject({
      AssAmt: 10000, // 10 x 1000.00
      GstRt: 18,
      IgstAmt: 1800, // 10000.00 x 18%
      CgstAmt: 0,
      SgstAmt: 0,
      TotItemVal: 11800,
    });
    expect(p.ValDtls).toMatchObject({ AssVal: 10000, IgstVal: 1800, CgstVal: 0, SgstVal: 0, TotInvVal: 11800 });
  });

  it("B: intra-state sale is B2B with CGST + SGST and Pos 27", async () => {
    const p = await payloadFor(invoiceIds.B);
    expect(p.TranDtls).toEqual({ TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" });
    expect(p.BuyerDtls.Stcd).toBe("27");
    expect(p.BuyerDtls.Pos).toBe("27");
    expect(p.ItemList[0]).toMatchObject({ AssAmt: 10000, IgstAmt: 0, CgstAmt: 900, SgstAmt: 900, TotItemVal: 11800 });
    expect(p.ValDtls).toMatchObject({ AssVal: 10000, IgstVal: 0, CgstVal: 900, SgstVal: 900, TotInvVal: 11800 });
  });

  it("C: a customer with no state code on file takes its state from its GSTIN (29 -> inter-state)", async () => {
    const p = await payloadFor(invoiceIds.C);
    expect(p.TranDtls.SupTyp).toBe("B2B");
    expect(p.BuyerDtls.Stcd).toBe("29");
    expect(p.BuyerDtls.Pos).toBe("29");
    expect(p.ItemList[0]).toMatchObject({ IgstAmt: 1800, CgstAmt: 0, SgstAmt: 0 });
    expect(p.ValDtls).toMatchObject({ IgstVal: 1800, CgstVal: 0, SgstVal: 0, TotInvVal: 11800 });
  });

  it("D: paise. 5.80 @ 5% = 0.29: IGST 0.29 inter-state; CGST 0.15 + SGST 0.14 intra-state", async () => {
    const inter = await payloadFor(invoiceIds.D_inter);
    expect(inter.ItemList[0]).toMatchObject({ AssAmt: 5.8, IgstAmt: 0.29, CgstAmt: 0, SgstAmt: 0, TotItemVal: 6.09 });
    expect(inter.ValDtls).toMatchObject({ IgstVal: 0.29, TotInvVal: 6.09 });

    const m = await irpMock();
    m.mockReset();
    m.mockResolvedValue(IRP_OK);
    const intra = await payloadFor(invoiceIds.D_intra);
    expect(intra.ItemList[0]).toMatchObject({ AssAmt: 5.8, IgstAmt: 0, CgstAmt: 0.15, SgstAmt: 0.14, TotItemVal: 6.09 });
    expect(intra.ValDtls).toMatchObject({ CgstVal: 0.15, SgstVal: 0.14, TotInvVal: 6.09 });
  });

  it.each([
    ["E_96", "state code 96 (other country)"],
    ["E_urp", 'GSTIN "URP"'],
  ] as const)("E: an export (%s) is refused before the IRP, leaving the invoice untouched", async (key, why) => {
    const db = getTenantTestDb();
    const [before] = await db.select().from(invoices).where(eq(invoices.id, invoiceIds[key]));

    await expect(w.caller.eInvoice.generate({ invoiceId: invoiceIds[key] })).rejects.toThrow(
      "Exports aren't supported in e-invoicing yet; available in 0.11",
    );
    await expect(w.caller.eInvoice.generate({ invoiceId: invoiceIds[key] })).rejects.toThrow(why);

    expect(await irpMock()).not.toHaveBeenCalled();
    const [after] = await db.select().from(invoices).where(eq(invoices.id, invoiceIds[key]));
    expect(after!.eInvoiceStatus).toBe(before!.eInvoiceStatus);
    expect(after!.eInvoiceError).toBeNull();
    expect(after!.eInvoiceRetryCount ?? 0).toBe(before!.eInvoiceRetryCount ?? 0);
    expect(after!.irn).toBeNull();
  });
});
