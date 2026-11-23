/**
 * ONE unit -> UQC map for the GSTR-1 HSN summary, the e-invoice (IRP) and the e-way bill (NIC).
 *
 * The IRP and e-way bill each had their own map with codes that are not on the GST UQC list ("CMT", "FT",
 * "INH", "DZN", "PAR", "JAR" in the IRP; "FT", "INH", "PAR", "PKT", "TNE", "JAR" in the e-way bill), which the
 * portals reject as an invalid unit, and the e-way bill sent "BDL" (bundles) for a bunch. Every unit Hisaabo
 * offers now maps to a code that IS on the list, and the three outputs agree.
 */
import { describe, it, expect } from "vitest";
import { units, UQC_CODES, unitToUqc } from "@hisaabo/shared";
import { mapInvoiceToIRP, type IRPBusiness, type IRPInvoice, type IRPLineItem } from "../lib/invoice-to-irp.js";
import { mapInvoiceToEWB, type InvoiceForEWB, type LineItemForEWB } from "../lib/invoice-to-ewb.js";
import { toUqc } from "../lib/gst-reports.js";

const irpInvoice: IRPInvoice = {
  invoiceNumber: "INV-1", invoiceDate: new Date("2026-01-15T10:00:00Z"), type: "sale", documentType: "invoice",
  subtotal: "100.00", taxAmount: "5.00", discountAmount: null, additionalCharges: null, roundOff: null,
  totalAmount: "105.00", isReverseCharge: false,
};
const irpLine = (unit: string | null): IRPLineItem => ({
  itemName: "Thing", description: null, quantity: "1", unitPrice: "100.00", taxPercent: "5", taxAmount: "5.00",
  discountPercent: "0", totalAmount: "105.00", selectedUnit: unit, itemType: "product", itemHsn: "730890",
});
const seller: IRPBusiness = {
  gstin: "27AABCU9603R1ZM", legalName: "Acme", name: "Acme", address: "1 Road", city: "Mumbai", state: "Maharashtra",
  stateCode: "27", pincode: "400001", phone: null, email: null,
};
const buyer = {
  gstin: "27AABCM0000R1ZM", name: "Buyer", billingAddress: null, city: null, state: "Maharashtra", stateCode: "27",
  pincode: null, phone: null, email: null,
};
const irpUnit = (unit: string) => mapInvoiceToIRP(irpInvoice, [irpLine(unit)], buyer, seller).ItemList[0]!.Unit;

const ewbInvoice: InvoiceForEWB = {
  id: "inv-1", invoiceNumber: "INV-1", invoiceDate: new Date("2026-01-15T10:00:00Z"), type: "sale", documentType: "invoice",
  subtotal: "100.00", taxAmount: "5.00", totalAmount: "105.00", isReverseCharge: false,
  partyGstin: "27AABCM0000R1ZM", partyName: "Buyer", partyAddress: "2 Road", partyCity: "Pune", partyPincode: "411001", partyStateCode: "27",
  businessGstin: "27AABCU9603R1ZM", businessName: "Seller", businessAddress: "1 Road", businessCity: "Mumbai", businessPincode: "400001", businessStateCode: "27",
};
const ewbLine = (unit: string): LineItemForEWB => ({
  itemName: "Thing", description: null, quantity: "1", unitPrice: "100.00", taxPercent: "5", taxAmount: "5.00", totalAmount: "105.00",
  hsn: "730890", unit, itemType: "product",
});
const ewbUnit = (unit: string) =>
  mapInvoiceToEWB(ewbInvoice, [ewbLine(unit)], { vehicleNumber: "MH12AB1234", vehicleType: "regular", transportMode: "road", distance: 100 }).itemList[0]!.qtyUnit;

describe("every unit Hisaabo offers maps to a code on the GST UQC list, in all three outputs", () => {
  it.each(units.map((u) => [u]))("%s", (unit) => {
    const list: readonly string[] = UQC_CODES;
    expect(list).toContain(unitToUqc(unit));
    expect(list).toContain(toUqc(unit));
    expect(list).toContain(irpUnit(unit));
    expect(list).toContain(ewbUnit(unit));
  });

  it("the units that used to be invalid codes", () => {
    // [unit, IRP, e-way bill]; GSTR-1 equals the e-way bill column
    const expected: Array<[string, string, string]> = [
      ["cm", "CMS", "CMS"], // IRP "CMT"
      ["ft", "OTH", "OTH"], // "FT"
      ["in", "OTH", "OTH"], // "INH"
      ["dozen", "DOZ", "DOZ"], // IRP "DZN"
      ["pair", "PRS", "PRS"], // "PAR"
      ["pkt", "PAC", "PAC"], // e-way bill "PKT"
      ["ton", "TON", "TON"], // e-way bill "TNE"
      ["jar", "OTH", "OTH"], // "JAR"
      ["pouch", "OTH", "OTH"], // IRP "BAG"
      ["bun", "BUN", "BUN"], // e-way bill "BDL": a bunch is BUN, bundles are BDL
    ];
    for (const [unit, irp, ewb] of expected) {
      expect([unit, irpUnit(unit), ewbUnit(unit), toUqc(unit)]).toEqual([unit, irp, ewb, ewb]);
    }
  });

  it("pieces stay PCS on the IRP (what every IRN carries) and NOS on the other two (both are on the list)", () => {
    expect([irpUnit("pcs"), ewbUnit("pcs"), toUqc("pcs")]).toEqual(["PCS", "NOS", "NOS"]);
  });

  it("bundle(s) is BDL, bunch(es) BUN; an unknown unit is OTH on the IRP and e-way bill and NOS in GSTR-1 (unchanged)", () => {
    expect(["bundle", "bundles"].map(unitToUqc)).toEqual(["BDL", "BDL"]);
    expect(["bunch", "bunches", "bun"].map(unitToUqc)).toEqual(["BUN", "BUN", "BUN"]);
    expect(unitToUqc("carton")).toBeNull();
    expect([irpUnit("carton"), ewbUnit("carton"), toUqc("carton")]).toEqual(["OTH", "OTH", "NOS"]);
  });
});
