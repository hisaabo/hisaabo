/**
 * Scenario 18 — The e-invoice (IRP) and e-way bill payloads of invoices the REAL routers stored.
 *
 * The mappers read the stored line amounts (taxable = total - tax, tax, total) and the stored header (subtotal, tax,
 * invoice-level discount, charges, round-off, total). This scenario creates invoices through `invoice.create`, reads
 * them back and checks that the payload adds up to the invoice the server stored, with hand-computed literals:
 *
 *   NIC IRP:  TotInvVal = AssVal + CgstVal + SgstVal + IgstVal + OthChrg - Discount + RndOffAmt   (Discount = INVOICE-level only)
 *   NIC EWB:  totInvValue = totalValue + cgstValue + sgstValue + igstValue + cessValue + otherValue
 *             (otherValue = charges + round-off - invoice discount)
 *
 *   L1  3 x 99.99 @ 12%, 10% line discount:  gross 299.97, discount 29.997 -> 30.00, taxable 269.97, GST 32.3964 -> 32.40, total 302.37
 *   L2  2 x 500.00 @ 18%:                    taxable 1000.00, GST 180.00, total 1180.00
 *
 *   18A  L1 only:                  subtotal 269.97, GST 32.40, total 302.37                        (a line discount, nothing else)
 *   18B  L2, invoice discount 50:  subtotal 1000.00, GST 180.00, total 1000.00 + 180.00 - 50.00 = 1130.00
 *   18C  L1 + L2, 10% invoice discount, packing 50.00, round-off -0.37:
 *          subtotal 1269.97, GST 212.40, discount 10% of 1269.97 = 126.997 -> 127.00
 *          total 1269.97 + 212.40 - 127.00 + 50.00 - 0.37 = 1405.00
 *          intra-state: CGST 16.20 + 90.00 = 106.20, SGST 106.20; inter-state: IGST 212.40
 *   18D  the online-store 3 x 99.00 incl. 18% order (stored through priceStoreOrderLines):
 *          rate 83.90, taxable 251.69, GST 45.31 (22.66 + 22.65), total 297.00; the item shows Discount 0.01 (251.70 - 251.69)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { invoices, invoiceItems } from "@hisaabo/db";
import { getTenantTestDb } from "../../helpers/test-db.js";
import { mapInvoiceToIRP, type IRPBusiness, type IRPParty } from "../../../lib/invoice-to-irp.js";
import { mapInvoiceToEWB, type TransportDetails } from "../../../lib/invoice-to-ewb.js";
import { priceStoreOrderLines } from "../../../lib/store-order-pricing.js";
import { useGoldenDb, createGoldenWorld, addParty, type GoldenWorld } from "./golden-helpers.js";

useGoldenDb();

const DATE = "2025-06-10T10:00:00.000Z";
const business: IRPBusiness = {
  gstin: "27AAAAA0000A1Z5", legalName: "Golden Traders", name: "Golden Traders", address: "1 Road", city: "Mumbai", state: "Maharashtra",
  stateCode: "27", pincode: "400001", phone: null, email: null,
};
const buyer = (stateCode: string): IRPParty => ({
  gstin: stateCode === "27" ? "27BBBBB1111B1Z5" : "29CCCCC2222C1Z5", name: "Buyer", billingAddress: "2 Lane", city: "City", state: "State", stateCode, pincode: "411001", phone: null, email: null,
});
const transport: TransportDetails = { vehicleNumber: "MH12AB1234", vehicleType: "regular", transportMode: "road", distance: 20 };

const L1 = { itemName: "Gadget", quantity: "3", unitPrice: "99.99", taxPercent: "12", discountPercent: "10" };
const L2 = { itemName: "Cable", quantity: "2", unitPrice: "500.00", taxPercent: "18", discountPercent: "0" };

/** The invoice and its lines exactly as stored, mapped to both payloads for the buyer's state. */
async function payloads(w: GoldenWorld, invoiceId: string, stateCode: string) {
  const inv = (await w.caller.invoice.getById({ id: invoiceId }))!;
  const header = {
    subtotal: inv.subtotal, taxAmount: inv.taxAmount, discountAmount: inv.discountAmount, additionalCharges: inv.additionalCharges,
    roundOff: inv.roundOff, totalAmount: inv.totalAmount,
  };
  const lines = inv.lineItems.map((l) => ({
    itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice, taxPercent: l.taxPercent, taxAmount: l.taxAmount,
    discountPercent: l.discountPercent, totalAmount: l.totalAmount,
  }));
  const irp = mapInvoiceToIRP(
    { invoiceNumber: inv.invoiceNumber, invoiceDate: new Date(DATE), type: "sale", documentType: "invoice", isReverseCharge: false, ...header },
    lines.map((l) => ({ description: null, selectedUnit: null, ...l })),
    buyer(stateCode),
    business,
  );
  const ewb = mapInvoiceToEWB(
    {
      id: inv.id, invoiceNumber: inv.invoiceNumber, invoiceDate: new Date(DATE), type: "sale", documentType: "invoice", isReverseCharge: false, ...header,
      partyGstin: buyer(stateCode).gstin, partyName: "Buyer", partyAddress: "2 Lane", partyCity: "City", partyPincode: "411001", partyStateCode: stateCode,
      businessGstin: business.gstin, businessName: business.name, businessAddress: "1 Road", businessCity: "Mumbai", businessPincode: "400001", businessStateCode: "27",
    },
    lines.map((l) => ({ itemName: l.itemName, description: null, quantity: l.quantity, unitPrice: l.unitPrice, taxPercent: l.taxPercent, taxAmount: l.taxAmount, totalAmount: l.totalAmount, hsn: "8517", unit: "pcs", itemType: "product" as const })),
    transport,
  );
  return { inv, irp, ewb };
}

describe("golden 18A: a line discount only", () => {
  let w: GoldenWorld;
  let id: string;
  beforeAll(async () => {
    w = await createGoldenWorld();
    const party = await addParty(w, "customer", "MH");
    id = (await w.caller.invoice.create({ partyId: party.id, type: "sale", invoiceDate: DATE, lineItems: [L1] } as never)).id;
  });

  it("the server stored 269.97 + 32.40 = 302.37", async () => {
    const { inv } = await payloads(w, id, "27");
    expect([inv.subtotal, inv.taxAmount, inv.discountAmount, inv.totalAmount]).toEqual(["269.97", "32.40", "0.00", "302.37"]);
  });

  it("IRP: item TotAmt 299.97, Discount 30.00, AssAmt 269.97; header Discount 0 (not 30.00), TotInvVal 302.37", async () => {
    const { irp, ewb } = await payloads(w, id, "27");
    expect(irp.ItemList[0]).toMatchObject({ TotAmt: 299.97, Discount: 30, AssAmt: 269.97, CgstAmt: 16.2, SgstAmt: 16.2, TotItemVal: 302.37 });
    expect(irp.ValDtls).toMatchObject({ AssVal: 269.97, CgstVal: 16.2, SgstVal: 16.2, IgstVal: 0, Discount: 0, TotInvVal: 302.37 });
    expect([ewb.totalValue, ewb.otherValue, ewb.totInvValue]).toEqual([269.97, 0, 302.37]);
  });
});

describe("golden 18B: an invoice-level discount only", () => {
  it("stored 1130.00; IRP Discount 50.00, TotInvVal 1130.00; EWB otherValue -50.00, totInvValue 1130.00", async () => {
    const w = await createGoldenWorld();
    const party = await addParty(w, "customer", "MH");
    const { id } = await w.caller.invoice.create({ partyId: party.id, type: "sale", invoiceDate: DATE, lineItems: [L2], invoiceDiscount: "50.00", invoiceDiscountType: "amount" } as never);
    const { inv, irp, ewb } = await payloads(w, id, "27");
    expect([inv.subtotal, inv.taxAmount, inv.discountAmount, inv.totalAmount]).toEqual(["1000.00", "180.00", "50.00", "1130.00"]); // 1000.00 + 180.00 - 50.00
    expect(irp.ValDtls).toMatchObject({ AssVal: 1000, CgstVal: 90, SgstVal: 90, Discount: 50, TotInvVal: 1130 });
    expect([ewb.totalValue, ewb.cgstValue, ewb.sgstValue, ewb.otherValue, ewb.totInvValue]).toEqual([1000, 90, 90, -50, 1130]);
  });
});

describe("golden 18C: line discount + 10% invoice discount + packing charge + round-off", () => {
  let w: GoldenWorld;
  let id: string;
  beforeAll(async () => {
    w = await createGoldenWorld();
    const party = await addParty(w, "customer", "MH");
    id = (
      await w.caller.invoice.create({
        partyId: party.id, type: "sale", invoiceDate: DATE, lineItems: [L1, L2],
        invoiceDiscount: "10", invoiceDiscountType: "percent",
        charges: [{ label: "Packing", amount: "50.00" }], roundOff: "-0.37",
      } as never)
    ).id;
  });

  it("the server stored subtotal 1269.97, GST 212.40, discount 127.00, charges 50.00, round-off -0.37, total 1405.00", async () => {
    const { inv } = await payloads(w, id, "27");
    expect([inv.subtotal, inv.taxAmount, inv.discountAmount, inv.additionalCharges, inv.roundOff, inv.totalAmount]).toEqual(["1269.97", "212.40", "127.00", "50.00", "-0.37", "1405.00"]);
  });

  it("IRP intra-state: CGST 106.20 + SGST 106.20, Discount 127, OthChrg 50, RndOffAmt -0.37, TotInvVal 1405.00", async () => {
    const { irp } = await payloads(w, id, "27");
    expect(irp.ValDtls).toMatchObject({ AssVal: 1269.97, CgstVal: 106.2, SgstVal: 106.2, IgstVal: 0, Discount: 127, OthChrg: 50, RndOffAmt: -0.37, TotInvVal: 1405 });
    // 1269.97 + 212.40 + 50.00 - 127.00 - 0.37 = 1405.00
  });

  it("IRP inter-state: IGST 212.40", async () => {
    const { irp } = await payloads(w, id, "29");
    expect(irp.ValDtls).toMatchObject({ AssVal: 1269.97, CgstVal: 0, SgstVal: 0, IgstVal: 212.4, Discount: 127, OthChrg: 50, RndOffAmt: -0.37, TotInvVal: 1405 });
  });

  it("EWB: totalValue 1269.97, otherValue -77.37 (50.00 - 0.37 - 127.00), totInvValue 1405.00", async () => {
    const { ewb } = await payloads(w, id, "27");
    expect([ewb.totalValue, ewb.cgstValue, ewb.sgstValue, ewb.igstValue, ewb.otherValue, ewb.totInvValue]).toEqual([1269.97, 106.2, 106.2, 0, -77.37, 1405]);
  });
});

describe("golden 18D: the online-store order of 3 x 99.00 incl. 18%", () => {
  it("stored rate 83.90 / GST 45.31 / total 297.00: IRP item Discount 0.01, header Discount 0, TotInvVal 297.00; EWB totalValue 251.69", async () => {
    const w = await createGoldenWorld();
    const party = await addParty(w, "customer", "MH");
    const priced = priceStoreOrderLines([{ itemId: "n", name: "Notebook", quantity: "3", unitPrice: "99.00", taxPercent: "18.00", taxInclusive: true, discountPercent: "0" }]);
    // what the store handler writes: the invoice header from the totals, the line from the row
    const db = getTenantTestDb();
    const [inv] = await db.insert(invoices).values({
      businessId: w.businessId, partyId: party.id, type: "sale", documentType: "invoice", invoiceNumber: "STORE-1", invoiceDate: new Date(DATE),
      status: "sent", subtotal: priced.totals.subtotal, taxAmount: priced.totals.taxTotal, discountAmount: priced.totals.invoiceDiscountAmount,
      additionalCharges: priced.totals.chargesTotal, roundOff: "0.00", totalAmount: priced.totals.total,
    } as never).returning();
    await db.insert(invoiceItems).values(priced.rows.map((r, i) => ({ ...r, itemId: null, invoiceId: inv!.id, sortOrder: i })) as never);
    const { irp, ewb } = await payloads(w, inv!.id, "27");
    expect(irp.ItemList[0]).toMatchObject({ UnitPrice: 83.9, Qty: 3, TotAmt: 251.7, Discount: 0.01, AssAmt: 251.69, CgstAmt: 22.66, SgstAmt: 22.65, TotItemVal: 297 });
    expect(irp.ValDtls).toMatchObject({ AssVal: 251.69, CgstVal: 22.66, SgstVal: 22.65, Discount: 0, TotInvVal: 297 });
    expect([ewb.totalValue, ewb.cgstValue, ewb.sgstValue, ewb.otherValue, ewb.totInvValue]).toEqual([251.69, 22.66, 22.65, 0, 297]);
  });
});
