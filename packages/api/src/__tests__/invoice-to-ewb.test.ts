/**
 * The e-way bill payload (lib/invoice-to-ewb.ts): the document date is the IST calendar date.
 *
 * A date-only "1 April" typed in an Indian browser is stored as the browser's local midnight,
 * 2026-03-31T18:30:00.000Z, and the NIC wants DD/MM/YYYY. Reading the date in the server's time
 * zone gave 31/03/2026 on a UTC server (and a different day for every other zone).
 */
import { describe, it, expect } from "vitest";
import { mapInvoiceToEWB, EwayBillNotEligibleError, type InvoiceForEWB, type LineItemForEWB, type TransportDetails } from "../lib/invoice-to-ewb.js";

const invoice = (invoiceDate: string): InvoiceForEWB => ({
  id: "inv-1",
  invoiceNumber: "INV-1",
  invoiceDate: new Date(invoiceDate),
  type: "sale",
  documentType: "invoice",
  subtotal: "1000.00",
  taxAmount: "180.00",
  totalAmount: "1180.00",
  isReverseCharge: false,
  partyGstin: "27AABCM0000R1ZM",
  partyName: "Buyer",
  partyAddress: "2 Road",
  partyCity: "Pune",
  partyPincode: "411001",
  partyStateCode: "27",
  businessGstin: "27AABCU9603R1ZM",
  businessName: "Seller",
  businessAddress: "1 Road",
  businessCity: "Mumbai",
  businessPincode: "400001",
  businessStateCode: "27",
});

const line: LineItemForEWB = {
  itemName: "Steel Rods",
  description: null,
  quantity: "1",
  unitPrice: "1000.00",
  taxPercent: "18",
  taxAmount: "180.00",
  totalAmount: "1180.00",
  hsn: "730890",
  unit: "pcs",
  itemType: "product",
};

const transport: TransportDetails = {
  vehicleNumber: "MH12AB1234",
  vehicleType: "regular",
  transportMode: "road",
  distance: 120,
};

describe("e-way bill document date is the IST date", () => {
  it.each([
    ["2026-03-31T18:29:59.999Z", "31/03/2026"], // the last millisecond of 31 March in IST
    ["2026-03-31T18:30:00.000Z", "01/04/2026"], // 1 April 00:00:00.000 IST
    ["2025-12-31T18:30:00.000Z", "01/01/2026"],
    ["2026-01-15T10:00:00.000Z", "15/01/2026"],
  ])("%s -> %s", (iso, docDate) => {
    expect(mapInvoiceToEWB(invoice(iso), [line], transport).docDate).toBe(docDate);
  });
});

// ── HSN: a real code on every line ─────────────────────────────────────────────

describe("e-way bill HSN: refused per line, same rule as the e-invoice", () => {
  const map = (lines: LineItemForEWB[], annualTurnover?: string | null) =>
    mapInvoiceToEWB({ ...invoice("2026-01-15T10:00:00.000Z"), businessAnnualTurnover: annualTurnover }, lines, transport);

  it.each([null, "", "   "])("HSN %j: refused, naming the line and the item", (hsn) => {
    expect(() => map([{ ...line, hsn }])).toThrow(EwayBillNotEligibleError);
    expect(() => map([{ ...line, hsn }])).toThrow(
      "Cannot generate the e-way bill: line 1 'Steel Rods' has no HSN code; add it on the item.",
    );
  });

  it("names the right line, and lists every offending line", () => {
    let message = "";
    try {
      map([{ ...line, itemName: "A", hsn: null }, { ...line, itemName: "B" }, { ...line, itemName: "C", hsn: "" }]);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("line 1 'A' has no HSN code; add it on the item");
    expect(message).toContain("line 3 'C' has no HSN code; add it on the item");
    expect(message).not.toContain("line 2");
  });

  it("the payload carries the real code (separators dropped), never an empty string", () => {
    expect(map([{ ...line, hsn: "7306 90" }]).itemList[0]!.hsnCode).toBe("730690");
    expect(map([line]).itemList[0]!.hsnCode).toBe("730890");
  });

  it.each([
    ["730", "730"],
    ["ABCD", "ABCD"],
    ["123456789", "123456789"],
  ])("a malformed HSN (%s) is refused", (hsn, shown) => {
    expect(() => map([{ ...line, hsn }])).toThrow(`line 1 'Steel Rods' has HSN code '${shown}', which is not 4 to 8 digits`);
  });

  it.each([
    // turnover, code, accepted
    ["49999999.99", "7306", true], // just below ₹5 Cr
    ["50000000.00", "7306", true], // exactly ₹5 Cr: still the 4-digit band
    ["50000000.00", "73069000", true],
    ["50000000.01", "7306", false], // one paisa above: 6 digits
    ["50000000.01", "730690", true],
    ["50000000.01", "73069000", true],
    [null, "7306", true], // unknown turnover: the 4-digit minimum
    [undefined, "7306", true],
  ])("turnover %j, HSN %s -> accepted: %s", (turnover, code, accepted) => {
    if (accepted) {
      expect(map([{ ...line, hsn: code }], turnover).itemList[0]!.hsnCode).toBe(code);
    } else {
      expect(() => map([{ ...line, hsn: code }], turnover)).toThrow(
        `line 1 'Steel Rods' has HSN code '${code}': Businesses with turnover above ₹5 Cr must use a minimum 6-digit HSN code. Provided code has 4 digits.`,
      );
    }
  });
});
