/**
 * Scenario 26 — ONE intra / inter-state decision everywhere.
 *
 * Whether a sale is CGST + SGST or IGST was decided by four different rules: the GST returns compared
 * state codes then names and otherwise said IGST; the ledger said "cannot tell, so CGST + SGST"; the
 * e-invoice took the state from the GSTIN; the e-way bill compared raw codes. So a customer who had a
 * GSTIN but no state on file was IGST in GSTR-1 / GSTR-3B and CGST + SGST in the ledger and the
 * e-invoice: the books, the return and the IRP disagreed for the same invoice.
 *
 * Now every one of them asks `isIntraStateSupply` (@hisaabo/shared gst-state): the GSTIN's state first,
 * then the stored state code, then the state name; legacy codes mapped (28 -> 37); a stored code that is
 * not a real state code ("50") ignored; the IRP and the e-way bill refuse a stored code that disagrees
 * with the GSTIN. The stored tax split of existing invoices is never rewritten.
 *
 * Every scenario is one sale of 10 x 10000.00 @ 18% on 15 Jan 2026 (taxable 100000.00; tax 18000.00;
 * total 118000.00), in its own world. Intra-state it is CGST 9000.00 + SGST 9000.00; inter-state IGST 18000.00.
 * The business is in Maharashtra (27) unless the scenario says otherwise. Each scenario is read through
 * GSTR-1, GSTR-3B 3.1(a), the ledger (2100 CGST / 2101 SGST / 2102 IGST), the IRP payload and the e-way
 * bill payload, and they must all agree.
 *
 *   S1 same state, a GSTIN (27...) and NO state on file         intra everywhere (GSTR-1 / 3B used to say IGST)
 *   S2 other state, a GSTIN (29...) and NO state on file        inter everywhere (the ledger used to say CGST + SGST)
 *   S3 stored state code 27 but the GSTIN says 29               the GSTIN wins: IGST in returns and ledger;
 *                                                               the IRP and the e-way bill REFUSE the mismatch
 *   S4 Andhra Pradesh business (37), customer with the legacy code 28 and a 28... GSTIN: one state, intra
 *                                                               (the raw 28 is what the IRP receives)
 *   S5 an invalid stored code "50" and the name "Maharashtra", no GSTIN: the name decides (intra); "50" is not compared
 *   S6 undecidable (nothing on the customer, e.g. the POS walk-in party): the supplier's own state, so
 *                                                               intra everywhere. GSTR-1 / 3B (and the PDF) used to say IGST for
 *                                                               it while the ledger booked CGST + SGST.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { businesses, parties } from "@hisaabo/db";
import { getTenantTestDb } from "../../helpers/test-db.js";
import { useGoldenDb, createGoldenWorld, addInvoice, book, tbRows, type GoldenWorld } from "./golden-helpers.js";

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

const IRP_OK = {
  irn: "A".repeat(64),
  ackNo: "112010000000001",
  ackDt: new Date("2026-01-15T10:00:00Z"),
  signedQrCode: "QR",
  signedInvoice: "SIGNED",
};
const EWB_OK = { ewayBillNo: "121600005025", ewayBillDate: "15/01/2026 10:30:00 AM", validUpto: "16/01/2026 10:30:00 AM" };
const TRANSPORT = { vehicleNumber: "MH12AB1234", vehicleType: "regular", transportMode: "road", distance: 250 } as const;

async function irpMock() {
  return ((await import("../../../lib/irp-client.js")) as unknown as { __mockGenerateIRN: ReturnType<typeof vi.fn> }).__mockGenerateIRN;
}
async function ewbMock() {
  return ((await import("../../../lib/ewb-client.js")) as unknown as { __mockGenerateEWB: ReturnType<typeof vi.fn> }).__mockGenerateEWB;
}

beforeEach(async () => {
  (await irpMock()).mockReset();
  (await irpMock()).mockResolvedValue(IRP_OK);
  (await ewbMock()).mockReset();
  (await ewbMock()).mockResolvedValue(EWB_OK);
});

interface Scenario {
  w: GoldenWorld;
  invoiceId: string;
  /** [taxable, cgst, sgst, igst] of the month's GSTR-1 (the report's own totals). */
  gstr1: number[];
  /** GSTR-3B 3.1(a) [taxable, cgst, sgst, igst]. */
  gstr3b: number[];
  /** The ledger's GST accounts: [2100 CGST, 2101 SGST, 2102 IGST] credits. */
  ledger: string[];
}

const heads = (x: { taxableValue: number; cgst: number; sgst: number; igst: number }) => [x.taxableValue, x.cgst, x.sgst, x.igst];

async function scenario(opts: {
  business?: { gstin: string; state: string; stateCode: string };
  party?: { gstin?: string; state?: string; stateCode?: string };
  /** columns the party validator would refuse (an invalid code), written straight to the database */
  rawParty?: { stateCode?: string; state?: string };
}): Promise<Scenario> {
  const w = await createGoldenWorld();
  const db = getTenantTestDb();
  if (opts.business) await db.update(businesses).set(opts.business).where(eq(businesses.id, w.businessId));
  const item = (await w.caller.item.create({ name: "Steel Rods", hsn: "730890", unit: "pcs", taxPercent: "18" })).id;
  const party = await w.caller.party.create({ type: "customer", name: "Customer", openingBalance: "0", ...opts.party });
  if (opts.rawParty) await db.update(parties).set(opts.rawParty).where(eq(parties.id, party.id));
  const inv = await addInvoice(
    w,
    "sale",
    party.id,
    [{ name: "Steel Rods", itemId: item, qty: "10", price: "10000.00", tax: "18", unit: "pcs" }],
    { date: "2026-01-15T10:00:00.000Z" },
  );
  const g1 = await w.caller.gst.gstr1({ year: 2026, month: 1 });
  const g3 = await w.caller.gst.gstr3b({ year: 2026, month: 1 });
  const tb = tbRows(await book(w));
  const credit = (code: string) => tb.find((r) => r[0] === code)?.[2] ?? "0.00";
  return {
    w,
    invoiceId: inv.id,
    gstr1: [g1.totalTaxableValue, g1.totalCgst, g1.totalSgst, g1.totalIgst],
    gstr3b: heads(g3.outwardSupplies.taxable),
    ledger: [credit("2100"), credit("2101"), credit("2102")],
  };
}

async function irpPayload(s: Scenario, gstin: string) {
  await s.w.caller.eInvoice.configure({
    gstin,
    clientId: "id",
    clientSecret: "secret",
    username: "user",
    password: "password",
    isSandbox: true,
    isEnabled: true,
    thresholdCrore: "5",
  });
  await s.w.caller.eInvoice.generate({ invoiceId: s.invoiceId });
  const m = await irpMock();
  expect(m).toHaveBeenCalledTimes(1);
  return m.mock.calls[0]![0] as {
    SellerDtls: { Stcd: string };
    BuyerDtls: { Pos: string; Stcd: string };
    ValDtls: { AssVal: number; CgstVal: number; SgstVal: number; IgstVal: number; TotInvVal: number };
  };
}

async function ewbPayload(s: Scenario) {
  await s.w.caller.ewayBill.generate({ invoiceId: s.invoiceId, ...TRANSPORT });
  const m = await ewbMock();
  expect(m).toHaveBeenCalledTimes(1);
  return m.mock.calls[0]![1] as { fromStateCode: number; toStateCode: number; cgstValue: number; sgstValue: number; igstValue: number };
}

const INTRA = { gst: [100000, 9000, 9000, 0], ledger: ["9000.00", "9000.00", "0.00"] };
const INTER = { gst: [100000, 0, 0, 18000], ledger: ["0.00", "0.00", "18000.00"] };

describe("golden 26: one intra / inter-state decision in GSTR-1, GSTR-3B, the ledger, the IRP and the e-way bill", () => {
  it("S1: a Maharashtra GSTIN and no state on file is intra-state everywhere (GSTR-1 / 3B used to say IGST)", async () => {
    const s = await scenario({ party: { gstin: "27AABCM0000R1ZM" } });
    expect(s.gstr1).toEqual(INTRA.gst);
    expect(s.gstr3b).toEqual(INTRA.gst);
    expect(s.ledger).toEqual(INTRA.ledger);

    const irp = await irpPayload(s, "27AABCU9603R1ZM");
    expect([irp.SellerDtls.Stcd, irp.BuyerDtls.Stcd, irp.BuyerDtls.Pos]).toEqual(["27", "27", "27"]);
    expect([irp.ValDtls.AssVal, irp.ValDtls.CgstVal, irp.ValDtls.SgstVal, irp.ValDtls.IgstVal, irp.ValDtls.TotInvVal]).toEqual([100000, 9000, 9000, 0, 118000]);

    const ewb = await ewbPayload(s);
    expect([ewb.fromStateCode, ewb.toStateCode, ewb.cgstValue, ewb.sgstValue, ewb.igstValue]).toEqual([27, 27, 9000, 9000, 0]);
  });

  it("S2: a Karnataka GSTIN and no state on file is inter-state everywhere (the ledger used to say CGST + SGST)", async () => {
    const s = await scenario({ party: { gstin: "29AABCG0000R1ZM" } });
    expect(s.gstr1).toEqual(INTER.gst);
    expect(s.gstr3b).toEqual(INTER.gst);
    expect(s.ledger).toEqual(INTER.ledger);

    const irp = await irpPayload(s, "27AABCU9603R1ZM");
    expect([irp.SellerDtls.Stcd, irp.BuyerDtls.Stcd, irp.BuyerDtls.Pos]).toEqual(["27", "29", "29"]);
    expect([irp.ValDtls.CgstVal, irp.ValDtls.SgstVal, irp.ValDtls.IgstVal, irp.ValDtls.TotInvVal]).toEqual([0, 0, 18000, 118000]);

    const ewb = await ewbPayload(s);
    expect([ewb.fromStateCode, ewb.toStateCode, ewb.cgstValue, ewb.sgstValue, ewb.igstValue]).toEqual([27, 29, 0, 0, 18000]);
  });

  it("S3: a stored state code 27 on a customer whose GSTIN says 29: the GSTIN wins in the returns and the ledger; the IRP and e-way bill refuse the mismatch", async () => {
    const s = await scenario({ party: { gstin: "29AABCG0000R1ZM", state: "Maharashtra", stateCode: "27" } });
    expect(s.gstr1).toEqual(INTER.gst);
    expect(s.gstr3b).toEqual(INTER.gst);
    expect(s.ledger).toEqual(INTER.ledger);

    await s.w.caller.eInvoice.configure({
      gstin: "27AABCU9603R1ZM", clientId: "id", clientSecret: "secret", username: "user", password: "password",
      isSandbox: true, isEnabled: true, thresholdCrore: "5",
    });
    await expect(s.w.caller.eInvoice.generate({ invoiceId: s.invoiceId })).rejects.toThrow(
      'Customer "Customer" has state code 27 but its GSTIN starts with 29 (Karnataka); correct one of them before generating an e-invoice.',
    );
    await expect(s.w.caller.ewayBill.generate({ invoiceId: s.invoiceId, ...TRANSPORT })).rejects.toThrow(
      '"Customer" has state code 27 but its GSTIN starts with 29; correct one of them before generating the e-way bill.',
    );
    expect(await irpMock()).not.toHaveBeenCalled();
    expect(await ewbMock()).not.toHaveBeenCalled();
  });

  it("S4: Andhra Pradesh: a business in 37 and a customer on the legacy code 28 are one state (CGST + SGST); the IRP gets the 28 the GSTIN carries", async () => {
    const s = await scenario({
      business: { gstin: "37AABCU9603R1ZM", state: "Andhra Pradesh", stateCode: "37" },
      party: { gstin: "28AABCP0000R1ZM", state: "Andhra Pradesh", stateCode: "28" },
    });
    expect(s.gstr1).toEqual(INTRA.gst);
    expect(s.gstr3b).toEqual(INTRA.gst);
    expect(s.ledger).toEqual(INTRA.ledger);

    const irp = await irpPayload(s, "37AABCU9603R1ZM");
    expect([irp.SellerDtls.Stcd, irp.BuyerDtls.Stcd, irp.BuyerDtls.Pos]).toEqual(["37", "28", "28"]);
    expect([irp.ValDtls.CgstVal, irp.ValDtls.SgstVal, irp.ValDtls.IgstVal]).toEqual([9000, 9000, 0]);

    const ewb = await ewbPayload(s);
    expect([ewb.fromStateCode, ewb.toStateCode, ewb.cgstValue, ewb.sgstValue, ewb.igstValue]).toEqual([37, 28, 9000, 9000, 0]);
  });

  it("S4b: and Telangana (36) is a different state from Andhra Pradesh (37): IGST", async () => {
    const s = await scenario({
      business: { gstin: "37AABCU9603R1ZM", state: "Andhra Pradesh", stateCode: "37" },
      party: { gstin: "36AABCT0000R1ZM", state: "Telangana", stateCode: "36" },
    });
    expect(s.gstr1).toEqual(INTER.gst);
    expect(s.gstr3b).toEqual(INTER.gst);
    expect(s.ledger).toEqual(INTER.ledger);
  });

  it("S5: an invalid stored code (50) is not compared: the state name decides (Maharashtra is intra-state)", async () => {
    const s = await scenario({ rawParty: { stateCode: "50", state: "Maharashtra" } });
    expect(s.gstr1).toEqual(INTRA.gst);
    expect(s.gstr3b).toEqual(INTRA.gst);
    expect(s.ledger).toEqual(INTRA.ledger);
  });

  it("S5b: the same invalid code with a Karnataka name is inter-state", async () => {
    const s = await scenario({ rawParty: { stateCode: "50", state: "Karnataka" } });
    expect(s.gstr1).toEqual(INTER.gst);
    expect(s.gstr3b).toEqual(INTER.gst);
    expect(s.ledger).toEqual(INTER.ledger);
  });

  it("S6: a customer with nothing on file (the POS walk-in) is the supplier's own state: CGST + SGST in the returns and the ledger (GSTR-1 / 3B used to say IGST)", async () => {
    const s = await scenario({});
    expect(s.gstr1).toEqual(INTRA.gst);
    expect(s.gstr3b).toEqual(INTRA.gst);
    expect(s.ledger).toEqual(INTRA.ledger);
  });
});
