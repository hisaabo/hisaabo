/**
 * invoice-to-irp.ts — Transform Hisaabo invoice to IRP JSON Schema v1.1.
 *
 * WHY THIS FILE EXISTS:
 * The NIC IRP has a specific JSON schema that differs from Hisaabo's internal
 * data model. This module handles all field mapping, UQC code translation,
 * GST split (CGST/SGST for intra-state, IGST for inter-state), and
 * document type mapping (invoice → INV, credit_note → CRN, debit_note → DBN).
 *
 * Money: all internal amounts are strings (NUMERIC(15,2)), IRP requires numbers.
 * We parse only at the boundary here — never accumulate JS floats.
 */

import type { IRPInvoiceJson } from "./irp-client.js";

// ── Types (subset of what we need from DB rows) ────────────────────────────────

export interface IRPBusiness {
  gstin: string | null;
  legalName: string | null;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
}

export interface IRPParty {
  gstin: string | null;
  name: string;
  billingAddress: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
}

export interface IRPInvoice {
  invoiceNumber: string;
  invoiceDate: Date;
  type: string; // "sale" | "purchase"
  documentType: string; // "invoice" | "credit_note" | "debit_note" etc.
  subtotal: string;
  taxAmount: string;
  discountAmount: string | null;
  additionalCharges: string | null;
  roundOff: string | null;
  totalAmount: string;
  isReverseCharge: boolean;
}

export interface IRPLineItem {
  /** Required snapshot of the item name at billing time. */
  itemName: string;
  /** Optional free-text line notes (from invoice_items.description). */
  description: string | null;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
  taxAmount: string;
  discountPercent: string;
  totalAmount: string;
  selectedUnit: string | null;
  itemType?: string | null; // "product" | "service"
  itemHsn?: string | null;
}

// ── UQC mapping (Hisaabo unit → IRP UQC code) ─────────────────────────────────
// Reference: https://einvoice1.gst.gov.in/Others/MasterCodes

const UQC_MAP: Record<string, string> = {
  pcs: "PCS",
  kg: "KGS",
  g: "GMS",
  l: "LTR",
  ml: "MLT",
  m: "MTR",
  cm: "CMT",
  ft: "FT",
  in: "INH",
  box: "BOX",
  dozen: "DZN",
  pair: "PAR",
  set: "SET",
  pkt: "PAC",
  bun: "BUN",
  pouch: "BAG",
  jar: "JAR",
  btl: "BTL",
  bag: "BAG",
  ton: "TON",
  pack: "PAC",
  pet: "NOS",
  person: "NOS",
  other: "OTH",
};

function toUQC(unit: string | null | undefined): string {
  if (!unit) return "OTH";
  return UQC_MAP[unit.toLowerCase()] ?? "OTH";
}

// ── Document type mapping ──────────────────────────────────────────────────────

function toIRPDocType(documentType: string): string {
  switch (documentType) {
    case "credit_note":
    case "sales_return":
      return "CRN";
    case "debit_note":
    case "purchase_return":
      return "DBN";
    default:
      return "INV";
  }
}

// ── Date formatting ────────────────────────────────────────────────────────────

function toIRPDate(date: Date): string {
  // IRP requires DD/MM/YYYY
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ── Number helpers ─────────────────────────────────────────────────────────────

function n(s: string | null | undefined): number {
  if (!s) return 0;
  const v = parseFloat(s);
  return isNaN(v) ? 0 : Math.round(v * 100) / 100;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ── Main mapping function ──────────────────────────────────────────────────────

/**
 * Map a Hisaabo invoice to the NIC IRP JSON Schema v1.1.
 *
 * @param invoice   - Invoice row from DB
 * @param lineItems - Invoice line items
 * @param party     - Customer/supplier party
 * @param business  - Seller business (must have GSTIN)
 */
export function mapInvoiceToIRP(
  invoice: IRPInvoice,
  lineItems: IRPLineItem[],
  party: IRPParty,
  business: IRPBusiness,
): IRPInvoiceJson {
  if (!business.gstin) {
    throw new Error("Business GSTIN is required for e-invoicing");
  }
  if (!party.gstin) {
    throw new Error("Party GSTIN is required for e-invoicing (B2B only)");
  }

  const sellerStateCode = business.stateCode ?? "00";
  const buyerStateCode = party.stateCode ?? sellerStateCode;
  const isInterState = sellerStateCode !== buyerStateCode;

  const supplyType = isInterState ? "EXPWP" : "B2B";

  // Map line items
  const itemList = lineItems.map((li, idx) => {
    const qty = n(li.quantity);
    const unitPrice = n(li.unitPrice);
    const taxPct = n(li.taxPercent);
    const discPct = n(li.discountPercent);

    const grossAmt = round2(qty * unitPrice);
    const discAmt = round2(grossAmt * discPct / 100);
    const assAmt = round2(grossAmt - discAmt);
    const totalTax = round2(assAmt * taxPct / 100);

    let cgstAmt = 0;
    let sgstAmt = 0;
    let igstAmt = 0;

    if (isInterState) {
      igstAmt = totalTax;
    } else {
      cgstAmt = round2(totalTax / 2);
      sgstAmt = round2(totalTax - cgstAmt); // handle odd paise
    }

    const totItemVal = round2(assAmt + totalTax);
    const isService = li.itemType === "service" ? "Y" : "N";

    return {
      SlNo: String(idx + 1),
      // IRP PrdDesc is the product-line display — use itemName (required
      // snapshot). The free-text notes field is intentionally NOT included
      // here, as IRP's PrdDesc is meant to identify the product, not capture
      // per-line comments.
      PrdDesc: li.itemName.slice(0, 300),
      IsServc: isService,
      HsnCd: li.itemHsn ?? "9999",
      Qty: qty,
      Unit: toUQC(li.selectedUnit),
      UnitPrice: unitPrice,
      TotAmt: grossAmt,
      Discount: discAmt,
      AssAmt: assAmt,
      GstRt: taxPct,
      IgstAmt: igstAmt,
      CgstAmt: cgstAmt,
      SgstAmt: sgstAmt,
      TotItemVal: totItemVal,
    };
  });

  // Aggregate ValDtls from itemList (sum of individual items)
  const assVal = round2(itemList.reduce((sum, item) => sum + item.AssAmt, 0));
  const cgstVal = round2(itemList.reduce((sum, item) => sum + item.CgstAmt, 0));
  const sgstVal = round2(itemList.reduce((sum, item) => sum + item.SgstAmt, 0));
  const igstVal = round2(itemList.reduce((sum, item) => sum + item.IgstAmt, 0));
  const discountTotal = round2(itemList.reduce((sum, item) => sum + item.Discount, 0));
  const othChrg = n(invoice.additionalCharges);
  const rndOffAmt = n(invoice.roundOff);
  const totInvVal = n(invoice.totalAmount);

  const sellerPin = parseInt(business.pincode ?? "000000", 10);
  const buyerPin = parseInt(party.pincode ?? "000000", 10);

  return {
    Version: "1.1",
    TranDtls: {
      TaxSch: "GST",
      SupTyp: supplyType,
      RegRev: invoice.isReverseCharge ? "Y" : "N",
      IgstOnIntra: "N",
    },
    DocDtls: {
      Typ: toIRPDocType(invoice.documentType),
      No: invoice.invoiceNumber,
      Dt: toIRPDate(invoice.invoiceDate),
    },
    SellerDtls: {
      Gstin: business.gstin,
      LglNm: (business.legalName ?? business.name).slice(0, 100),
      TrdNm: business.name.slice(0, 100),
      Addr1: (business.address ?? "").slice(0, 100),
      Loc: (business.city ?? business.state ?? "").slice(0, 50),
      Pin: isNaN(sellerPin) ? 0 : sellerPin,
      Stcd: sellerStateCode,
      Ph: business.phone ?? undefined,
      Em: business.email ?? undefined,
    },
    BuyerDtls: {
      Gstin: party.gstin,
      LglNm: party.name.slice(0, 100),
      TrdNm: party.name.slice(0, 100),
      Pos: buyerStateCode,
      Addr1: (party.billingAddress ?? "").slice(0, 100),
      Loc: (party.city ?? party.state ?? "").slice(0, 50),
      Pin: isNaN(buyerPin) ? 0 : buyerPin,
      Stcd: buyerStateCode,
      Ph: party.phone ?? undefined,
      Em: party.email ?? undefined,
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: assVal,
      CgstVal: cgstVal,
      SgstVal: sgstVal,
      IgstVal: igstVal,
      Discount: discountTotal,
      OthChrg: othChrg > 0 ? othChrg : undefined,
      RndOffAmt: rndOffAmt !== 0 ? rndOffAmt : undefined,
      TotInvVal: totInvVal,
    },
  };
}
