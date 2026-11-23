/**
 * pdf-fixtures.ts — synthetic "realistic full" invoices for the PDF renderer tests.
 *
 * Everything here is made up (names, GSTINs, bank details). The builder produces an invoice
 * with every optional section filled in (business + party details, HSN, mixed GST rates,
 * long item names, per-line notes, notes, terms, bank and UPI details with a QR code, a
 * partial payment and a status stamp), so a page-count assertion against it is a worst
 * case rather than a best case.
 */

import QRCode from "qrcode";
import { generateInvoicePDF, type InvoicePDFData, type PDFFormat } from "../../lib/invoice-pdf.js";

const RATES = ["0", "5", "12", "18", "28"] as const;

const LONG_NAMES = [
  "Basmati Rice Premium Long Grain Aged 2 Years, Vacuum Packed 25 kg Bag (Export Quality)",
  "Cold Pressed Groundnut Oil 15 Litre Tin",
  "Whole Wheat Flour (Atta) 10 kg",
  "Toor Dal",
  "Assorted Stainless Steel Kitchen Containers Set of 12 With Air-Tight Lids, Mirror Finish",
  "Turmeric Powder 500 g",
  "Sugar",
  "Refined Sunflower Oil 5 Litre Pouch Carton of 4",
];

const NOTE_TEXT =
  "Deliver before 11 am to the loading dock at the rear gate; call the store manager before arrival.";

export const FIXTURE_NOTES =
  "Goods once sold will not be taken back. Please check the quantity at the time of delivery. " +
  "Payment is due within 15 days of the invoice date; interest at 18% per annum is charged on overdue amounts.";

export const FIXTURE_TERMS =
  "1. Subject to Pune jurisdiction only.\n2. Our responsibility ceases once the goods leave our premises.\n" +
  "3. Interest at 24% per annum will be charged on bills not paid by the due date.\n" +
  "4. Errors and omissions excepted. Complaints, if any, must reach us within 3 days of delivery.";

/** Notes long enough to wrap to ~12 lines in the A4 notes column (and to 9+ on A5). */
export const LONG_NOTES =
  "Goods once sold will not be taken back or exchanged. Please check the quantity, brand and expiry dates at the " +
  "time of delivery; shortages and damages must be reported to our dispatch desk within 24 hours, with photographs " +
  "and the delivery challan number. Payment is due within 15 days of the invoice date; interest at 18% per annum " +
  "is charged on overdue amounts, computed daily. Cheques must be drawn in favour of the company name printed on " +
  "this invoice and are subject to realisation; a charge of Rs. 500 applies to every dishonoured cheque. Cold-chain " +
  "items are delivered against a signed temperature log. Any dispute is subject to the courts at Pune.";

/** A legal name that wraps to two lines on A5 (three with a logo). Within the 200-char limit. */
export const LONG_LEGAL_NAME =
  "Anand Wholesale Traders and Commission Agents Private Limited, trading as Anand Provisions, " +
  "Anand Cold Storage and Anand Logistics (a Maharashtra registered company)";

/** An item name at the 200-char limit: three or four lines in the A4 / A5 description column. */
export const VERY_LONG_ITEM_NAME =
  "Hand-Stitched Premium Cotton Bedsheet Set with Two Pillow Covers, King Size, Pre-Washed, Colour-Fast, " +
  "Machine Washable, Assorted Floral Prints in Blue, Green and Maroon, Gift Wrapped in a Reusable Fabric Bag";

/** A real (1x1, transparent) PNG, enough to make the templates reserve their logo slot. */
export const TINY_LOGO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export interface FullInvoiceOptions {
  /** Attach a per-line note to every line item (default true). */
  lineNotes?: boolean;
  /** Include notes + terms (default true). */
  notesAndTerms?: boolean;
  /** Include bank + UPI details with a QR code (default true). */
  payment?: boolean;
  /** Invoice status, drives the diagonal stamp on A5 / thermal (default "partial"). */
  status?: string;
}

let qrCache: string | undefined;
async function qr(): Promise<string> {
  qrCache ??= await QRCode.toDataURL("upi://pay?pa=test@upi&pn=Test&am=1.00&cu=INR", { width: 200, margin: 1 });
  return qrCache;
}

/** A GST-registered, intra-state sale invoice with `lines` line items and every section filled in. */
export async function buildFullInvoice(lines: number, opts: FullInvoiceOptions = {}): Promise<InvoicePDFData> {
  const { lineNotes = true, notesAndTerms = true, payment = true, status = "partial" } = opts;

  const lineItems: InvoicePDFData["lineItems"] = [];
  const lineItemHsn: string[] = [];
  let subtotalPaise = 0;
  let taxPaise = 0;
  for (let i = 0; i < lines; i++) {
    const rate = RATES[i % RATES.length];
    const qty = 1 + (i % 7);
    const unitPaise = 12_500 + i * 3_725;
    const basePaise = qty * unitPaise;
    const linePaise = Math.round((basePaise * Number(rate)) / 100);
    subtotalPaise += basePaise;
    taxPaise += linePaise;
    lineItems.push({
      itemName: `${LONG_NAMES[i % LONG_NAMES.length]} #${i + 1}`,
      description: lineNotes && i % 2 === 0 ? NOTE_TEXT : null,
      quantity: String(qty),
      unit: i % 3 === 0 ? "kg" : "pcs",
      unitPrice: (unitPaise / 100).toFixed(2),
      taxPercent: rate,
      taxAmount: (linePaise / 100).toFixed(2),
      discountPercent: "0",
      totalAmount: ((basePaise + linePaise) / 100).toFixed(2),
    });
    lineItemHsn.push(String(10061000 + i * 37));
  }
  const totalPaise = subtotalPaise + taxPaise;

  return {
    businessName: "Anand Wholesale Traders Private Limited",
    businessLegalName: "Anand Wholesale Traders Pvt. Ltd.",
    businessGstin: "27AAAAA0000A1Z5",
    businessPan: "AAAAA0000A",
    businessPhone: "+91 98765 43210",
    businessEmail: "accounts@example.invalid",
    businessAddress: "Shop 14, Market Yard Road, Near Grain Exchange",
    businessCity: "Pune",
    businessState: "Maharashtra",
    businessPincode: "411037",
    partyName: "Bhagirathi General Stores and Provisions",
    partyPhone: "+91 91234 56789",
    partyEmail: "orders@example.invalid",
    partyGstin: "27BBBBB1111B1Z6",
    partyBillingAddress: "12, Station Road, Opposite Old Bus Stand",
    partyCity: "Nashik",
    partyState: "Maharashtra",
    invoiceNumber: "INV-2026-00042",
    invoiceDate: new Date("2026-04-19").toISOString(),
    dueDate: new Date("2026-05-04").toISOString(),
    type: "sale",
    lineItems,
    subtotal: (subtotalPaise / 100).toFixed(2),
    taxAmount: (taxPaise / 100).toFixed(2),
    discountAmount: "0.00",
    totalAmount: (totalPaise / 100).toFixed(2),
    amountPaid: (Math.floor(totalPaise / 2) / 100).toFixed(2),
    notes: notesAndTerms ? FIXTURE_NOTES : undefined,
    termsAndConditions: notesAndTerms ? FIXTURE_TERMS : undefined,
    bankAccountName: payment ? "Anand Wholesale Traders Pvt Ltd" : undefined,
    bankAccountNumber: payment ? "000123456789" : undefined,
    bankIfsc: payment ? "TEST0001234" : undefined,
    bankName: payment ? "Test Bank of India" : undefined,
    upiId: payment ? "anand@upi" : undefined,
    upiQrDataUrl: payment ? await qr() : undefined,
    upiPayUrl: payment ? "https://example.invalid/pay/upi?pa=anand@upi" : undefined,
    gstRegistrationType: "regular",
    businessStateCode: "27",
    partyStateCode: "27",
    lineItemHsn,
    isPaidPlan: false,
    status,
  };
}

const SHORT_NAMES = [
  "Basmati Rice 25 kg",
  "Groundnut Oil 15 L",
  "Wheat Flour 10 kg",
  "Toor Dal 1 kg",
  "Steel Container Set",
  "Turmeric Powder 500 g",
  "Sugar 5 kg",
  "Sunflower Oil 5 L",
];

/**
 * A "tidy" invoice: the same shape as buildFullInvoice, but every item name and line note fits on
 * one line, the notes are one line, the terms are two lines and the legal name is short. These
 * trigger none of the overlap cases, so they must render exactly as they did before those cases
 * were fixed (the pixel-identity baseline).
 */
export async function buildNormalInvoice(lines: number, opts: FullInvoiceOptions = {}): Promise<InvoicePDFData> {
  const data = await buildFullInvoice(lines, opts);
  data.lineItems.forEach((li, i) => {
    li.itemName = `${SHORT_NAMES[i % SHORT_NAMES.length]} #${i + 1}`;
    if (li.description) li.description = "Deliver before 11 am";
  });
  if (data.notes) data.notes = "Thank you for your business.";
  if (data.termsAndConditions) {
    data.termsAndConditions = "1. Subject to Pune jurisdiction only.\n2. Errors and omissions excepted.";
  }
  return data;
}

/** Render an invoice to a PDF buffer, exactly as pdf-worker.ts does. */
export async function renderInvoicePdf(data: InvoicePDFData, format: PDFFormat): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = generateInvoicePDF(data, format);
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/**
 * Number of pages in a PDFKit-written PDF. PDFKit writes page dictionaries uncompressed, so
 * counting `/Type /Page` objects (and not `/Type /Pages`) is exact.
 */
export function countPdfPages(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type \/Page(?![s\w])/g) ?? []).length;
}
