/**
 * Pure tests for the one CGST / SGST rule (shared money.splitHalf / splitDocumentGst and
 * lib/gst-split.ts): per line, CGST = round-half-up(tax / 2), SGST = the remainder: the
 * e-invoice (IRP) rule. No database.
 */
import { describe, it, expect } from "vitest";
import { splitDocumentGst } from "@hisaabo/shared";
import { documentGstSplit } from "../lib/gst-split.js";
import { mapInvoiceToIRP } from "../lib/invoice-to-irp.js";

describe("splitDocumentGst", () => {
  it("sums each line's split when the lines add up to the tax", () => {
    expect(splitDocumentGst("0.02", ["0.01", "0.01"])).toEqual(["0.02", "0.00"]);
    expect(splitDocumentGst("102.59", ["5.00", "10.37", "27.00", "17.80", "28.28", "13.64", "0.50"])).toEqual(["51.30", "51.29"]);
  });

  it("splits the tax as one amount when there are no lines or they do not add up", () => {
    expect(splitDocumentGst("0.02", [])).toEqual(["0.01", "0.01"]);
    expect(splitDocumentGst("0.02", ["0.01", "0.02"])).toEqual(["0.01", "0.01"]);
  });
});

describe("documentGstSplit (grouped line sums from SQL)", () => {
  it("uses the sums when they match the document tax", () => {
    expect(documentGstSplit("102.59", { taxPaise: 10259, cgstPaise: 5130 })).toEqual(["51.30", "51.29"]);
    expect(documentGstSplit("0.02", { taxPaise: 2, cgstPaise: 2 })).toEqual(["0.02", "0.00"]);
  });

  it("falls back to one split when absent or inconsistent", () => {
    expect(documentGstSplit("0.02", undefined)).toEqual(["0.01", "0.01"]);
    expect(documentGstSplit("0.02", { taxPaise: 5, cgstPaise: 3 })).toEqual(["0.01", "0.01"]);
  });
});

describe("the IRP payload uses the same rule (no floating-point rounding)", () => {
  const business = {
    gstin: "27AABCU9603R1ZM", name: "Seller", address: "1 Road", city: "Mumbai", state: "Maharashtra",
    stateCode: "27", pincode: "400001",
  };
  const party = {
    gstin: "27AAPFU0939F1ZV", name: "Buyer", billingAddress: "2 Road", city: "Pune", state: "Maharashtra",
    stateCode: "27", pincode: "411001",
  };

  function irpLineSplit(unitPrice: string, taxPercent: string) {
    const json = mapInvoiceToIRP(
      {
        invoiceNumber: "INV-1", invoiceDate: new Date("2025-10-01T00:00:00Z"), type: "sale", documentType: "invoice",
        subtotal: unitPrice, taxAmount: "0", discountAmount: "0", additionalCharges: "0", roundOff: "0", totalAmount: unitPrice,
        isReverseCharge: false,
      } as never,
      [{ itemName: "X", quantity: "1", unitPrice, taxPercent, discountPercent: "0", itemHsn: "1234", itemType: "product", selectedUnit: null } as never],
      party as never,
      business as never,
    );
    const item = json.ItemList[0]!;
    return [item.CgstAmt, item.SgstAmt, item.IgstAmt];
  }

  it("an odd-paisa line tax gives the odd paisa to CGST, including where floating-point halving rounds down", () => {
    // 5.80 @ 5% = 0.29 of tax. 0.29 / 2 = 0.145 is 0.14499... in floating point, which the old
    // round2(tax / 2) turned into 0.14; the rule is round-half-up: CGST 0.15, SGST 0.14.
    expect(irpLineSplit("5.80", "5")).toEqual([0.15, 0.14, 0]);
    // 1.00 @ 5% = 0.05 -> CGST 0.03, SGST 0.02
    expect(irpLineSplit("1.00", "5")).toEqual([0.03, 0.02, 0]);
    // even tax: 2.00 @ 5% = 0.10 -> 0.05 / 0.05
    expect(irpLineSplit("2.00", "5")).toEqual([0.05, 0.05, 0]);
  });
});
