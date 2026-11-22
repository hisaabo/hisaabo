/**
 * The e-way bill payload (lib/invoice-to-ewb.ts): the document date is the IST calendar date.
 *
 * A date-only "1 April" typed in an Indian browser is stored as the browser's local midnight,
 * 2026-03-31T18:30:00.000Z, and the NIC wants DD/MM/YYYY. Reading the date in the server's time
 * zone gave 31/03/2026 on a UTC server (and a different day for every other zone).
 */
import { describe, it, expect } from "vitest";
import { mapInvoiceToEWB, type InvoiceForEWB, type LineItemForEWB, type TransportDetails } from "../lib/invoice-to-ewb.js";

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
