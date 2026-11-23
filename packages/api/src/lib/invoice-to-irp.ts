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
 *
 * SUPPLY TYPE (TranDtls.SupTyp):
 * The IRP values are B2B, SEZWP, SEZWOP, EXPWP, EXPWOP and DEXP. Hisaabo has no
 * export / SEZ / deemed-export fields until 0.11.0, so every invoice this mapper
 * accepts is a domestic B2B supply and SupTyp is always "B2B", intra- or
 * inter-state alike. Inter- vs intra-state is expressed by IGST vs CGST + SGST
 * and by the place of supply (BuyerDtls.Pos), never by SupTyp. A party that
 * looks foreign (GSTIN "URP" or state code 96) is refused rather than mis-filed.
 */

import type { IRPInvoiceJson } from "./irp-client.js";
import { money, resolveState, supplyKind, canonicalStateCode, GST_STATE_NAMES, FOREIGN_STATE_CODE } from "@hisaabo/shared";
import { resolveLineHsns } from "./hsn-check.js";
import { formatIstDate } from "./gst-period.js";

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
  /**
   * Annual turnover in rupees (`businesses.annual_turnover`), which sets the HSN digit minimum:
   * 4 digits up to ₹5 Cr, 6 above. Unknown (null / undefined) means the 4-digit minimum.
   */
  annualTurnover?: string | null;
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

/** TranDtls.SupTyp values in the IRP JSON schema v1.1. */
export type IRPSupplyType = "B2B" | "SEZWP" | "SEZWOP" | "EXPWP" | "EXPWOP" | "DEXP";

/**
 * Raised when an invoice cannot be e-invoiced as Hisaabo stands today (an export, or
 * a seller / buyer whose state cannot be worked out). Nothing has been sent to the IRP:
 * callers turn it into a plain "cannot generate" message and leave the invoice alone.
 */
export class EInvoiceNotEligibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EInvoiceNotEligibleError";
  }
}

/**
 * Why this party looks foreign (an export), or null for a domestic party. Hisaabo parties
 * have no country field, so the markers are the GSTIN placeholder "URP" (unregistered
 * person, what a foreign buyer is filed under) and the "Other Country" state code 96,
 * whether set on the party or read from the start of its GSTIN.
 */
export function foreignPartyReason(party: Pick<IRPParty, "gstin" | "stateCode">): string | null {
  if (party.gstin?.trim().toUpperCase() === "URP") return 'GSTIN "URP"';
  // an explicit stored 96 counts even when the GSTIN looks domestic: the record says "other country"
  if (canonicalStateCode(party.stateCode) === FOREIGN_STATE_CODE || resolveState({ gstin: party.gstin, stateCode: party.stateCode }).foreign) {
    return `state code ${FOREIGN_STATE_CODE} (other country)`;
  }
  return null;
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
  // DD/MM/YYYY on the IST calendar: the IRN is registered against this date (and its financial
  // year), and a date-only "1 April" is stored as 31 March 18:30 UTC.
  return formatIstDate(new Date(date));
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

  const foreignReason = foreignPartyReason(party);
  if (foreignReason) {
    throw new EInvoiceNotEligibleError(
      `Exports aren't supported in e-invoicing yet; available in 0.11. This customer has ${foreignReason}.`,
    );
  }

  // The state of each side, by the one rule every GST output shares (@hisaabo/shared gst-state): the
  // GSTIN's state first, then the stored code, then the name; legacy codes mapped (28 -> 37). Never
  // assumed to be "the seller's": that filed an inter-state sale to a party with no state code as
  // CGST + SGST. A stored code that disagrees with the GSTIN is refused: the IRP checks the GSTIN.
  const seller = resolveState({ gstin: business.gstin, stateCode: business.stateCode, state: business.state });
  if (seller.conflict) {
    throw new EInvoiceNotEligibleError(
      `The business state code ${seller.conflict.storedCode} does not match its GSTIN, which starts with ${seller.conflict.gstinCode} (${GST_STATE_NAMES[seller.conflict.gstinCode]}); correct one of them in Settings.`,
    );
  }
  if (!seller.code) {
    throw new EInvoiceNotEligibleError("The business has no state code; set the business state in Settings before generating an e-invoice.");
  }
  const buyer = resolveState({ gstin: party.gstin, stateCode: party.stateCode, state: party.state });
  if (buyer.conflict) {
    throw new EInvoiceNotEligibleError(
      `Customer "${party.name}" has state code ${buyer.conflict.storedCode} but its GSTIN starts with ${buyer.conflict.gstinCode} (${GST_STATE_NAMES[buyer.conflict.gstinCode]}); correct one of them before generating an e-invoice.`,
    );
  }
  if (!buyer.code) {
    throw new EInvoiceNotEligibleError(`Customer "${party.name}" has no state code; set the customer's state before generating an e-invoice.`);
  }
  // What goes to the IRP is the code the GSTIN / record carries (it checks Stcd against the GSTIN's first two digits);
  // the comparison above used the canonical one, so legacy 28 and 37 are one state.
  const sellerStateCode = seller.rawCode!;
  const buyerStateCode = buyer.rawCode!;
  const isInterState = supplyKind(
    { gstin: business.gstin, stateCode: business.stateCode, state: business.state },
    { gstin: party.gstin, stateCode: party.stateCode, state: party.state },
  ) === "inter";

  // Always B2B (see the header): the IRP wants EXPWP for an export with payment, not
  // for an inter-state domestic sale.
  const supplyType: IRPSupplyType = "B2B";

  // Map line items
  // Every line needs a valid HSN before anything is built or sent.
  const { codes: hsnCodes, problems: hsnProblems } = resolveLineHsns(lineItems, business.annualTurnover);
  if (hsnProblems.length > 0) {
    throw new EInvoiceNotEligibleError(`Cannot generate the e-invoice: ${hsnProblems.join("; ")}.`);
  }

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
      // CGST = round-half-up(tax / 2), SGST = the remainder (odd paisa to CGST). Done in integer
      // paise through the shared split: `round2(totalTax / 2)` in floating point rounded some odd
      // paise down (0.29 / 2 = 0.145 is 0.14499...), which is not what the rule says and not what
      // the ledger and the GST returns, which use the same function, report.
      const [cgstHalf, sgstHalf] = money.splitHalf(totalTax);
      cgstAmt = money.toNumber(cgstHalf);
      sgstAmt = money.toNumber(sgstHalf);
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
      HsnCd: hsnCodes[idx]!,
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
      // Hisaabo never charges IGST on an intra-state supply; "Y" is for SEZ / deemed
      // exports, which arrive in 0.11.0.
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
