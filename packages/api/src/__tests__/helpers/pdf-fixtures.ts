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
