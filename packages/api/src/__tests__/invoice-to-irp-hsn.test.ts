/**
 * HSN on the IRP payload: a real code on every line, never a made-up "9999".
 *
 * Before 0.10.1 a line whose item had no HSN went to the IRP as HsnCd "9999". Now generation is
 * refused, per line, before anything is sent. The digit minimum follows the business's annual
 * turnover: 4 digits up to and including ₹5,00,00,000 (50000000.00), 6 digits above; an unknown
 * turnover is the 4-digit minimum. HSN comes from the live item (no snapshot on the invoice line
 * until 0.11.0).
 */
import { describe, it, expect } from "vitest";
import { mapInvoiceToIRP, EInvoiceNotEligibleError, type IRPBusiness, type IRPInvoice, type IRPLineItem } from "../lib/invoice-to-irp.js";
import { validateHsnForTurnover, isValidHsn } from "../lib/hsn-data.js";

const invoice: IRPInvoice = {
  invoiceNumber: "INV-1",
  invoiceDate: new Date("2026-01-15T10:00:00Z"),
  type: "sale",
  documentType: "invoice",
  subtotal: "3000.00",
  taxAmount: "540.00",
  discountAmount: null,
  additionalCharges: null,
  roundOff: null,
  totalAmount: "3540.00",
  isReverseCharge: false,
};

const line = (over: Partial<IRPLineItem> = {}): IRPLineItem => ({
  itemName: "Steel Rods",
  description: null,
  quantity: "3",
  unitPrice: "1000.00",
  taxPercent: "18",
  taxAmount: "540.00",
  discountPercent: "0",
  totalAmount: "3540.00",
  selectedUnit: "pcs",
  itemType: "product",
  itemHsn: "730890",
  ...over,
});

const seller = (annualTurnover?: string | null): IRPBusiness => ({
  gstin: "27AABCU9603R1ZM",
  legalName: "Acme",
  name: "Acme",
  address: "1 Road",
  city: "Mumbai",
  state: "Maharashtra",
  stateCode: "27",
  pincode: "400001",
  phone: null,
  email: null,
  annualTurnover,
});

const buyer = {
  gstin: "27AABCM0000R1ZM",
  name: "Buyer",
  billingAddress: null,
  city: null,
  state: "Maharashtra",
  stateCode: "27",
  pincode: null,
  phone: null,
  email: null,
};

const map = (lines: IRPLineItem[], annualTurnover?: string | null) =>
  mapInvoiceToIRP(invoice, lines, buyer, seller(annualTurnover));

describe("a missing HSN is refused, line by line", () => {
  it.each([null, undefined, "", "   "])("HSN %j: refused, naming the line and the item", (hsn) => {
    expect(() => map([line({ itemHsn: hsn })])).toThrow(EInvoiceNotEligibleError);
    expect(() => map([line({ itemHsn: hsn })])).toThrow("line 1 'Steel Rods' has no HSN code; add it on the item");
  });

  it("names the right line when only a later line is missing it", () => {
    expect(() => map([line(), line({ itemName: "Copper Wire", itemHsn: null })])).toThrow(
      "line 2 'Copper Wire' has no HSN code; add it on the item",
    );
  });

  it("lists every offending line in one message", () => {
    let message = "";
    try {
      map([line({ itemName: "A", itemHsn: null }), line({ itemName: "B" }), line({ itemName: "C", itemHsn: "" })]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("line 1 'A' has no HSN code; add it on the item");
    expect(message).toContain("line 3 'C' has no HSN code; add it on the item");
    expect(message).not.toContain("line 2");
  });

  it("never falls back to a made-up code", () => {
    const json = map([line({ itemHsn: "730890" })]);
    expect(json.ItemList[0]!.HsnCd).toBe("730890");
    expect(JSON.stringify(json)).not.toContain("9999");
  });
});

describe("a malformed HSN is refused", () => {
  it.each([
    ["ABCD", "ABCD"],
    ["730", "730"], // 3 digits
    ["123456789", "123456789"], // 9 digits: the IRP takes at most 8
    ["73-0A", "73-0A".replace(/-/g, "")],
  ])("%s", (hsn, shown) => {
    expect(() => map([line({ itemHsn: hsn })])).toThrow(`line 1 'Steel Rods' has HSN code '${shown}', which is not 4 to 8 digits`);
  });

  it("separators are dropped before sending: '7306 90' and '7306.90' go out as 730690", () => {
    expect(map([line({ itemHsn: "7306 90" })]).ItemList[0]!.HsnCd).toBe("730690");
    expect(map([line({ itemHsn: " 7306.90 " })]).ItemList[0]!.HsnCd).toBe("730690");
  });
});

describe("the digit minimum follows turnover: 4 digits up to ₹5 Cr, 6 above (exact in paise)", () => {
  const FOUR = "7306";
  const SIX = "730690";
  const EIGHT = "73069000";

  it.each([
    // turnover,         code,  accepted
    ["49999999.99", FOUR, true], // just below ₹5 Cr
    ["49999999.99", SIX, true],
    ["49999999.99", EIGHT, true],
    ["50000000.00", FOUR, true], // exactly ₹5 Cr is still the 4-digit band
    ["50000000.00", SIX, true],
    ["50000000.00", EIGHT, true],
    ["50000000.01", FOUR, false], // one paisa above
    ["50000000.01", SIX, true],
    ["50000000.01", EIGHT, true],
    ["750000000.00", FOUR, false], // ₹75 Cr
    ["750000000.00", SIX, true],
    [null, FOUR, true], // unknown turnover: the 4-digit minimum
    [undefined, FOUR, true],
    ["", FOUR, true],
    [null, SIX, true],
  ])("turnover %j, HSN %s -> accepted: %s", (turnover, code, accepted) => {
    if (accepted) {
      expect(map([line({ itemHsn: code })], turnover).ItemList[0]!.HsnCd).toBe(code);
    } else {
      expect(() => map([line({ itemHsn: code })], turnover)).toThrow(
        `line 1 'Steel Rods' has HSN code '${code}': Businesses with turnover above ₹5 Cr must use a minimum 6-digit HSN code. Provided code has 4 digits.`,
      );
    }
  });
});

describe("validateHsnForTurnover compares in paise, not floats", () => {
  it("boundary", () => {
    expect(validateHsnForTurnover("7306", "50000000")).toEqual({ valid: true });
    expect(validateHsnForTurnover("7306", "50000000.00")).toEqual({ valid: true });
    expect(validateHsnForTurnover("7306", "50000000.01").valid).toBe(false);
    expect(validateHsnForTurnover("730690", "50000000.01")).toEqual({ valid: true });
    expect(validateHsnForTurnover("730", "100.00").valid).toBe(false);
  });
});

describe("isValidHsn is an exact match against the master list, not a prefix match", () => {
  it("a listed code is valid; a longer code that only starts with a listed one is not", () => {
    expect(isValidHsn("0101")).toBe(true);
    expect(isValidHsn("010121")).toBe(true);
    expect(isValidHsn("01012100")).toBe(false); // starts with a listed code, is not itself listed
  });
});

describe("an all-zero HSN is not a real code (e-invoice, e-way bill and GSTR-1 agree)", () => {
  it.each(["0000", "000000", "00000000", "00 00", "0.000"])("%s is refused", (hsn) => {
    const code = hsn.replace(/[\s.-]/g, "");
    expect(() => map([line({ itemHsn: hsn })])).toThrow(
      `line 1 'Steel Rods' has HSN code '${code}', which is not a real HSN code (all zeros); correct it on the item`,
    );
  });

  it("a code that merely contains zeros is fine", () => {
    expect(map([line({ itemHsn: "0101" })]).ItemList[0]!.HsnCd).toBe("0101");
    expect(map([line({ itemHsn: "10000" })]).ItemList[0]!.HsnCd).toBe("10000");
  });
});

