/**
 * The IRP supply type (TranDtls.SupTyp) and place of supply for a domestic B2B e-invoice.
 *
 * The IRP's SupTyp values are B2B, SEZWP, SEZWOP, EXPWP, EXPWOP and DEXP. Until 0.11.0 Hisaabo has
 * no export / SEZ fields, so everything it maps is a domestic B2B supply: SupTyp "B2B", intra- or
 * inter-state. (Before 0.10.1 an inter-state sale was sent as "EXPWP", export with payment.)
 * A party that looks foreign is refused instead of being mis-filed.
 */
import { describe, it, expect } from "vitest";
import {
  mapInvoiceToIRP,
  foreignPartyReason,
  EInvoiceNotEligibleError,
  type IRPBusiness,
  type IRPInvoice,
  type IRPLineItem,
  type IRPParty,
} from "../lib/invoice-to-irp.js";

const invoice: IRPInvoice = {
  invoiceNumber: "INV-1",
  invoiceDate: new Date("2026-01-15T10:00:00Z"),
  type: "sale",
  documentType: "invoice",
  subtotal: "10000.00",
  taxAmount: "1800.00",
  discountAmount: null,
  additionalCharges: null,
  roundOff: null,
  totalAmount: "11800.00",
  isReverseCharge: false,
};

// 10 x 1000.00 @ 18%: taxable 10000.00, GST 1800.00 (IGST 1800.00, or CGST 900.00 + SGST 900.00).
const line: IRPLineItem = {
  itemName: "Steel Rods",
  description: null,
  quantity: "10",
  unitPrice: "1000.00",
  taxPercent: "18",
  taxAmount: "1800.00",
  discountPercent: "0",
  totalAmount: "11800.00",
  selectedUnit: "pcs",
  itemType: "product",
  itemHsn: "730890",
};

const seller: IRPBusiness = {
  gstin: "27AABCU9603R1ZM",
  legalName: "Acme Trading Co",
  name: "Acme Trading Co",
  address: "1 MG Road",
  city: "Mumbai",
  state: "Maharashtra",
  stateCode: "27",
  pincode: "400001",
  phone: null,
  email: null,
};

const buyer = (over: Partial<IRPParty> = {}): IRPParty => ({
  gstin: "29AABCG0000R1ZM",
  name: "Buyer",
  billingAddress: "2 Road",
  city: "Bengaluru",
  state: "Karnataka",
  stateCode: "29",
  pincode: "560001",
  phone: null,
  email: null,
  ...over,
});

const map = (party: IRPParty, business: IRPBusiness = seller) => mapInvoiceToIRP(invoice, [line], party, business);

describe("SupTyp is B2B for every domestic supply", () => {
  it("intra-state (27 -> 27): B2B, CGST 900.00 + SGST 900.00, Pos 27", () => {
    const json = map(buyer({ gstin: "27AABCM0000R1ZM", state: "Maharashtra", stateCode: "27" }));
    expect(json.TranDtls.SupTyp).toBe("B2B");
    expect(json.TranDtls.IgstOnIntra).toBe("N");
    expect(json.BuyerDtls.Pos).toBe("27");
    expect(json.ItemList[0]).toMatchObject({ IgstAmt: 0, CgstAmt: 900, SgstAmt: 900 });
    expect(json.ValDtls).toMatchObject({ IgstVal: 0, CgstVal: 900, SgstVal: 900, TotInvVal: 11800 });
  });

  it("inter-state (27 -> 29): still B2B (never EXPWP), IGST 1800.00, Pos 29", () => {
    const json = map(buyer());
    expect(json.TranDtls.SupTyp).toBe("B2B");
    expect(json.TranDtls.IgstOnIntra).toBe("N");
    expect(json.BuyerDtls.Pos).toBe("29");
    expect(json.BuyerDtls.Stcd).toBe("29");
    expect(json.ItemList[0]).toMatchObject({ IgstAmt: 1800, CgstAmt: 0, SgstAmt: 0 });
    expect(json.ValDtls).toMatchObject({ IgstVal: 1800, CgstVal: 0, SgstVal: 0, TotInvVal: 11800 });
  });

  it("never emits an export / SEZ supply type, whatever the states", () => {
    for (const code of ["01", "07", "19", "24", "27", "29", "33", "36", "97"]) {
      const json = map(buyer({ stateCode: code, gstin: `${code}AABCG0000R1ZM` }));
      expect(json.TranDtls.SupTyp).toBe("B2B");
    }
  });

  it("the seller's state, when none is on file, is the one in its GSTIN (never an invented '00')", () => {
    const json = map(buyer(), { ...seller, stateCode: null });
    expect(json.SellerDtls.Stcd).toBe("27");
    expect(json.ItemList[0]).toMatchObject({ IgstAmt: 1800 }); // 27 -> 29
  });
});

describe("place of supply when the party has no state code on file", () => {
  it("is read from the party's GSTIN (29), so the sale is inter-state: IGST, Pos 29", () => {
    const json = map(buyer({ stateCode: null, state: null }));
    expect(json.BuyerDtls.Stcd).toBe("29");
    expect(json.BuyerDtls.Pos).toBe("29");
    expect(json.ItemList[0]).toMatchObject({ IgstAmt: 1800, CgstAmt: 0, SgstAmt: 0 });
  });

  it("a GSTIN in the seller's own state gives an intra-state sale", () => {
    const json = map(buyer({ gstin: "27AABCM0000R1ZM", stateCode: "", state: null }));
    expect(json.BuyerDtls.Pos).toBe("27");
    expect(json.ItemList[0]).toMatchObject({ IgstAmt: 0, CgstAmt: 900, SgstAmt: 900 });
  });

  it("is refused when neither the party's state code nor its GSTIN gives one", () => {
    expect(() => map(buyer({ stateCode: null, gstin: "ABCDE1234F" }))).toThrow(EInvoiceNotEligibleError);
  });

  it("the business needs a state too", () => {
    expect(() => map(buyer(), { ...seller, stateCode: null, gstin: "XXAABCU9603R1ZM" })).toThrow(
      /business has no state code/,
    );
  });
});

describe("exports are refused, not mis-filed", () => {
  const message = "Exports aren't supported in e-invoicing yet; available in 0.11";

  it.each([
    ["GSTIN URP", { gstin: "URP", stateCode: "96" }],
    ["GSTIN urp, any case, padded", { gstin: " urp ", stateCode: "29" }],
    ["state code 96", { gstin: "29AABCG0000R1ZM", stateCode: "96" }],
    ["no state code but a GSTIN that starts with 96", { gstin: "96AABCG0000R1ZM", stateCode: null }],
  ])("%s", (_name, over) => {
    expect(() => map(buyer(over))).toThrow(EInvoiceNotEligibleError);
    expect(() => map(buyer(over))).toThrow(message);
  });

  it("a domestic party, and other territories (97), are not flagged", () => {
    expect(foreignPartyReason({ gstin: "29AABCG0000R1ZM", stateCode: "29" })).toBeNull();
    expect(foreignPartyReason({ gstin: "97AABCG0000R1ZM", stateCode: "97" })).toBeNull();
    expect(foreignPartyReason({ gstin: "27AABCM0000R1ZM", stateCode: null })).toBeNull();
  });

  it("still requires a GSTIN at all", () => {
    expect(() => map(buyer({ gstin: null }))).toThrow("Party GSTIN is required");
  });
});
