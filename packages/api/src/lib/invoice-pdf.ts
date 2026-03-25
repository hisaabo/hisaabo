import PDFDocument from "pdfkit";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = resolve(__dirname, "../../fonts/NotoSans-Regular.ttf");
const FONT_BOLD = resolve(__dirname, "../../fonts/NotoSans-Bold.ttf");

// ── Types ──────────────────────────────────────────────────────

export interface InvoicePDFData {
  // Business
  businessName: string;
  businessLegalName?: string;
  businessGstin?: string;
  businessPan?: string;
  businessPhone?: string;
  businessEmail?: string;
  businessAddress?: string;
  businessCity?: string;
  businessState?: string;
  businessPincode?: string;

  // Party
  partyName: string;
  partyPhone?: string;
  partyEmail?: string;
  partyGstin?: string;
  partyBillingAddress?: string;
  partyCity?: string;
  partyState?: string;

  // Invoice
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  type: "sale" | "purchase";

  // Line items
  lineItems: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    taxPercent: string;
    taxAmount: string;
    discountPercent: string;
    totalAmount: string;
  }>;

  // Totals
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  totalAmount: string;
  amountPaid: string;

  // Optional
  notes?: string;
  termsAndConditions?: string;

  // Payment info (shown on invoice for customer)
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankName?: string;
  upiId?: string;        // e.g., "business@upi"
  upiQrDataUrl?: string; // pre-generated QR code as data URL

  // GST
  gstRegistrationType?: "regular" | "composition" | "unregistered";
  businessStateCode?: string; // 2-digit state code
  partyStateCode?: string;
  lineItemHsn?: string[]; // HSN/SAC code per line item (parallel array)
}

type PDFFormat = "a5-landscape" | "a4" | "thermal";

// ── Helpers ────────────────────────────────────────────────────

function fmt(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(num);
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

// Number to words for Indian billing
function numberToWords(num: number): string {
  if (num === 0) return "Zero";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function chunk(n: number): string {
    if (n === 0) return "";
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " and " + chunk(n % 100) : "");
  }

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const rest = Math.floor(num % 1000);
  const paise = Math.round((num % 1) * 100);

  let words = "";
  if (crore) words += chunk(crore) + " Crore ";
  if (lakh) words += chunk(lakh) + " Lakh ";
  if (thousand) words += chunk(thousand) + " Thousand ";
  if (rest) words += chunk(rest);
  words = words.trim() + " Rupees";
  if (paise) words += " and " + chunk(paise) + " Paise";
  return words + " Only";
}

// ── GST helpers ────────────────────────────────────────────────

function getInvoiceTitle(data: InvoicePDFData): string {
  if (data.type === "purchase") return "PURCHASE INVOICE";
  if (!data.gstRegistrationType || data.gstRegistrationType === "unregistered") return "INVOICE";
  if (data.gstRegistrationType === "composition") return "BILL OF SUPPLY";
  return "TAX INVOICE";
}

// ── A4 Invoice ─────────────────────────────────────────────────

function generateA4Invoice(doc: InstanceType<typeof PDFDocument>, data: InvoicePDFData) {
  const pageW = 595.28; // A4
  const margin = 40;
  const contentW = pageW - margin * 2;
  let y = margin;

  const colorPrimary = "#1a1a2e";
  const colorSecondary = "#495057";
  const colorMuted = "#868e96";
  const colorAccent = "#4263eb";
  const colorBorder = "#dee2e6";
  const colorBg = "#f8f9fa";

  // ── Header ───────────────────────────────────────────────────
  // Business name
  doc.fontSize(18).fillColor(colorPrimary).font("NotoSans-Bold")
    .text(data.businessName, margin, y, { width: contentW * 0.6 });
  y += 24;

  if (data.businessLegalName) {
    doc.fontSize(9).fillColor(colorSecondary).font("NotoSans")
      .text(data.businessLegalName, margin, y);
    y += 14;
  }

  // Business details (left)
  const bizDetails: string[] = [];
  if (data.businessAddress) bizDetails.push(data.businessAddress);
  const cityLine = [data.businessCity, data.businessState, data.businessPincode].filter(Boolean).join(", ");
  if (cityLine) bizDetails.push(cityLine);
  if (data.businessPhone) bizDetails.push(`Ph: ${data.businessPhone}`);
  if (data.businessEmail) bizDetails.push(data.businessEmail);

  doc.fontSize(8).fillColor(colorMuted).font("NotoSans");
  for (const line of bizDetails) {
    doc.text(line, margin, y);
    y += 11;
  }

  // GSTIN / PAN (left)
  if (data.businessGstin && data.gstRegistrationType !== "unregistered") {
    doc.fontSize(8).fillColor(colorSecondary).font("NotoSans-Bold")
      .text(`GSTIN: ${data.businessGstin}`, margin, y);
    y += 11;
  }
  if (data.businessPan) {
    doc.fontSize(8).fillColor(colorSecondary).font("NotoSans-Bold")
      .text(`PAN: ${data.businessPan}`, margin, y);
    y += 11;
  }

  // Invoice title + number (right side, at top)
  const titleLabel = getInvoiceTitle(data);
  doc.fontSize(11).fillColor(colorAccent).font("NotoSans-Bold")
    .text(titleLabel, margin + contentW * 0.6, margin, { width: contentW * 0.4, align: "right" });

  doc.fontSize(9).fillColor(colorPrimary).font("NotoSans-Bold")
    .text(`# ${data.invoiceNumber}`, margin + contentW * 0.6, margin + 18, { width: contentW * 0.4, align: "right" });

  doc.fontSize(8).fillColor(colorSecondary).font("NotoSans")
    .text(`Date: ${fmtDate(data.invoiceDate)}`, margin + contentW * 0.6, margin + 32, { width: contentW * 0.4, align: "right" });

  if (data.dueDate) {
    doc.text(`Due: ${fmtDate(data.dueDate)}`, margin + contentW * 0.6, margin + 44, { width: contentW * 0.4, align: "right" });
  }

  y = Math.max(y, margin + 60) + 16;

  // ── Divider ──────────────────────────────────────────────────
  doc.strokeColor(colorBorder).lineWidth(0.5)
    .moveTo(margin, y).lineTo(margin + contentW, y).stroke();
  y += 16;

  // ── Bill To ──────────────────────────────────────────────────
  doc.fontSize(8).fillColor(colorMuted).font("NotoSans-Bold")
    .text("BILL TO", margin, y);
  y += 14;

  doc.fontSize(10).fillColor(colorPrimary).font("NotoSans-Bold")
    .text(data.partyName, margin, y);
  y += 15;

  doc.fontSize(8).fillColor(colorSecondary).font("NotoSans");
  if (data.partyBillingAddress) { doc.text(data.partyBillingAddress, margin, y); y += 11; }
  const partyCityLine = [data.partyCity, data.partyState].filter(Boolean).join(", ");
  if (partyCityLine) { doc.text(partyCityLine, margin, y); y += 11; }
  if (data.partyPhone) { doc.text(`Ph: ${data.partyPhone}`, margin, y); y += 11; }
  if (data.partyGstin) {
    doc.font("NotoSans-Bold").text(`GSTIN: ${data.partyGstin}`, margin, y);
    y += 11;
  }

  y += 16;

  // ── Items Table ──────────────────────────────────────────────
  const showHsn = (data.gstRegistrationType === "regular" || data.gstRegistrationType === "composition")
    && data.lineItemHsn?.some(h => h);
  const hsnColW = 50;

  const colX = {
    idx: margin,
    hsn: margin + 28,
    desc: showHsn ? margin + 28 + hsnColW : margin + 28,
    qty: margin + contentW * 0.52,
    rate: margin + contentW * 0.62,
    tax: margin + contentW * 0.76,
    amount: margin + contentW * 0.88,
  };

  // Table header
  doc.rect(margin, y, contentW, 22).fill(colorBg);
  doc.fontSize(7.5).fillColor(colorSecondary).font("NotoSans-Bold");
  doc.text("#", colX.idx + 4, y + 7);
  if (showHsn) doc.text("HSN", colX.hsn, y + 7, { width: hsnColW });
  doc.text("DESCRIPTION", colX.desc, y + 7);
  doc.text("QTY", colX.qty, y + 7, { width: contentW * 0.1, align: "right" });
  doc.text("RATE", colX.rate, y + 7, { width: contentW * 0.12, align: "right" });
  doc.text("TAX", colX.tax, y + 7, { width: contentW * 0.1, align: "right" });
  doc.text("AMOUNT", colX.amount, y + 7, { width: contentW * 0.12, align: "right" });
  y += 22;

  // Table rows
  doc.font("NotoSans").fontSize(8).fillColor(colorPrimary);
  data.lineItems.forEach((item, i) => {
    const rowH = 20;

    if (i % 2 === 1) {
      doc.rect(margin, y, contentW, rowH).fill("#fcfcfd");
      doc.fillColor(colorPrimary);
    }

    const rowY = y + 6;
    const descW = showHsn ? contentW * 0.4 - hsnColW : contentW * 0.4;
    doc.text(`${i + 1}`, colX.idx + 4, rowY);
    if (showHsn) doc.text(data.lineItemHsn?.[i] || "", colX.hsn, rowY, { width: hsnColW });
    doc.text(item.description, colX.desc, rowY, { width: descW });
    doc.text(parseFloat(item.quantity).toLocaleString("en-IN"), colX.qty, rowY, { width: contentW * 0.1, align: "right" });
    doc.text(fmt(item.unitPrice), colX.rate, rowY, { width: contentW * 0.12, align: "right" });
    doc.text(`${item.taxPercent}%`, colX.tax, rowY, { width: contentW * 0.1, align: "right" });
    doc.font("NotoSans-Bold").text(fmt(item.totalAmount), colX.amount, rowY, { width: contentW * 0.12, align: "right" });
    doc.font("NotoSans");

    y += rowH;
  });

  // Bottom border
  doc.strokeColor(colorBorder).lineWidth(0.5)
    .moveTo(margin, y).lineTo(margin + contentW, y).stroke();
  y += 16;

  // ── Totals ───────────────────────────────────────────────────
  const totalsX = margin + contentW * 0.6;
  const totalsW = contentW * 0.4;
  const totalsValX = margin + contentW * 0.88;
  const totalsValW = contentW * 0.12;

  function totalRow(label: string, value: string, bold = false) {
    doc.fontSize(8).fillColor(bold ? colorPrimary : colorSecondary)
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .text(label, totalsX, y, { width: totalsW * 0.65 });
    doc.fontSize(bold ? 10 : 8).fillColor(colorPrimary)
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .text(fmt(value), totalsValX, y, { width: totalsValW, align: "right" });
    y += bold ? 18 : 14;
  }

  totalRow("Subtotal", data.subtotal);
  if (parseFloat(data.discountAmount) > 0) totalRow("Discount", `-${data.discountAmount}`);
  totalRow("Tax", data.taxAmount);

  doc.strokeColor(colorBorder).lineWidth(0.5)
    .moveTo(totalsX, y).lineTo(margin + contentW, y).stroke();
  y += 8;

  totalRow("Total", data.totalAmount, true);

  if (parseFloat(data.amountPaid) > 0) {
    totalRow("Amount Paid", data.amountPaid);
    const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
    if (balance > 0) totalRow("Balance Due", balance.toFixed(2), true);
  }

  // Amount in words
  y += 4;
  doc.fontSize(7.5).fillColor(colorMuted).font("NotoSans-Bold")
    .text("Amount in words:", margin, y);
  y += 11;
  doc.fontSize(8).fillColor(colorSecondary).font("NotoSans")
    .text(numberToWords(parseFloat(data.totalAmount)), margin, y, { width: contentW });
  y += 20;

  // ── GST Breakdown ────────────────────────────────────────────
  const isGstRegistered = data.gstRegistrationType === "regular" || data.gstRegistrationType === "composition";

  if (isGstRegistered && parseFloat(data.taxAmount) > 0) {
    const gstRates = new Map<string, { taxable: number; cgst: number; sgst: number; igst: number }>();

    // Use state codes for inter/intra-state detection; fall back to state names
    const isSameState = data.businessStateCode && data.partyStateCode
      ? data.businessStateCode === data.partyStateCode
      : (data.businessState && data.partyState
          ? data.businessState.toLowerCase() === data.partyState.toLowerCase()
          : false);

    for (const item of data.lineItems) {
      const rate = item.taxPercent;
      const taxable = parseFloat(item.totalAmount) - parseFloat(item.taxAmount);
      const taxAmt = parseFloat(item.taxAmount);

      if (!gstRates.has(rate)) {
        gstRates.set(rate, { taxable: 0, cgst: 0, sgst: 0, igst: 0 });
      }
      const entry = gstRates.get(rate)!;
      entry.taxable += taxable;

      if (isSameState) {
        entry.cgst += taxAmt / 2;
        entry.sgst += taxAmt / 2;
      } else {
        entry.igst += taxAmt;
      }
    }

    if (gstRates.size > 0) {
      y += 8;
      doc.fontSize(8).fillColor(colorMuted).font("NotoSans-Bold")
        .text("TAX BREAKDOWN", margin, y);
      y += 14;

      // Header
      doc.rect(margin, y, contentW, 18).fill(colorBg);
      doc.fontSize(7).fillColor(colorSecondary).font("NotoSans-Bold");
      doc.text("TAX RATE", margin + 4, y + 5);
      doc.text("TAXABLE", margin + 100, y + 5, { width: 80, align: "right" });
      if (isSameState) {
        doc.text("CGST", margin + 200, y + 5, { width: 70, align: "right" });
        doc.text("SGST", margin + 290, y + 5, { width: 70, align: "right" });
      } else {
        doc.text("IGST", margin + 200, y + 5, { width: 70, align: "right" });
      }
      doc.text("TOTAL TAX", margin + 380, y + 5, { width: 80, align: "right" });
      y += 18;

      doc.font("NotoSans").fontSize(7.5).fillColor(colorPrimary);
      for (const [rate, amounts] of gstRates) {
        const totalTax = amounts.cgst + amounts.sgst + amounts.igst;
        doc.text(`${rate}%`, margin + 4, y + 4);
        doc.text(fmt(amounts.taxable), margin + 100, y + 4, { width: 80, align: "right" });
        if (isSameState) {
          doc.text(fmt(amounts.cgst), margin + 200, y + 4, { width: 70, align: "right" });
          doc.text(fmt(amounts.sgst), margin + 290, y + 4, { width: 70, align: "right" });
        } else {
          doc.text(fmt(amounts.igst), margin + 200, y + 4, { width: 70, align: "right" });
        }
        doc.text(fmt(totalTax), margin + 380, y + 4, { width: 80, align: "right" });
        y += 16;
      }
    }
  }

  y += 16;

  // ── Notes / Terms ────────────────────────────────────────────
  if (data.notes) {
    doc.fontSize(7.5).fillColor(colorMuted).font("NotoSans-Bold").text("Notes", margin, y);
    y += 12;
    doc.fontSize(8).fillColor(colorSecondary).font("NotoSans")
      .text(data.notes, margin, y, { width: contentW * 0.6 });
    y += doc.heightOfString(data.notes, { width: contentW * 0.6 }) + 12;
  }

  if (data.termsAndConditions) {
    doc.fontSize(7.5).fillColor(colorMuted).font("NotoSans-Bold").text("Terms & Conditions", margin, y);
    y += 12;
    doc.fontSize(7.5).fillColor(colorMuted).font("NotoSans")
      .text(data.termsAndConditions, margin, y, { width: contentW * 0.6 });
    y += doc.heightOfString(data.termsAndConditions, { width: contentW * 0.6 }) + 12;
  }

  // ── Payment Information ───────────────────────────────────────
  const hasPaymentInfo = data.type === "sale" && (data.bankAccountNumber || data.upiId);
  if (hasPaymentInfo) {
    y += 4;
    const payBoxW = contentW;
    doc.rect(margin, y, payBoxW, 14).fill(colorBg);
    doc.fontSize(8).fillColor(colorSecondary).font("NotoSans-Bold")
      .text("Payment Information", margin + 6, y + 3);
    y += 14;

    doc.rect(margin, y, payBoxW, 0.5).fill(colorBorder);
    y += 8;

    const hasQr = !!data.upiQrDataUrl;
    const qrSize = 70;
    const textAreaW = hasQr ? payBoxW - qrSize - 16 : payBoxW - 12;

    if (data.bankAccountNumber) {
      doc.fontSize(7.5).fillColor(colorSecondary).font("NotoSans-Bold")
        .text("Bank:", margin + 6, y);
      doc.font("NotoSans").fillColor(colorPrimary)
        .text(data.bankName || "Bank", margin + 36, y);
      y += 11;
      doc.fontSize(7.5).fillColor(colorSecondary).font("NotoSans-Bold")
        .text("A/C:", margin + 6, y);
      doc.font("NotoSans").fillColor(colorPrimary)
        .text(data.bankAccountNumber, margin + 36, y);
      if (data.bankIfsc) {
        doc.text(`   IFSC: ${data.bankIfsc}`, margin + 36 + doc.widthOfString(data.bankAccountNumber), y);
      }
      y += 11;
      if (data.bankAccountName) {
        doc.fontSize(7.5).fillColor(colorSecondary).font("NotoSans-Bold")
          .text("Name:", margin + 6, y);
        doc.font("NotoSans").fillColor(colorPrimary)
          .text(data.bankAccountName, margin + 36, y, { width: textAreaW - 36 });
        y += 11;
      }
    }

    if (data.upiId) {
      doc.fontSize(7.5).fillColor(colorSecondary).font("NotoSans-Bold")
        .text("UPI:", margin + 6, y);
      doc.font("NotoSans").fillColor(colorPrimary)
        .text(data.upiId, margin + 36, y, { width: textAreaW - 36 });
      y += 11;
    }

    if (hasQr && data.upiQrDataUrl) {
      const qrX = margin + payBoxW - qrSize - 6;
      const qrY = y - (data.bankAccountNumber ? 44 : 22);
      try {
        const qrBuffer = Buffer.from(data.upiQrDataUrl.split(",")[1], "base64");
        doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
        const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
        if (balance > 0) {
          doc.fontSize(6).fillColor(colorMuted).font("NotoSans")
            .text(`Scan to pay ${fmt(balance)}`, qrX, qrY + qrSize + 2, { width: qrSize, align: "center" });
        }
      } catch {
        // skip QR if image fails
      }
    }

    y += 8;
  }

  // ── Footer ───────────────────────────────────────────────────
  const footerY = 780;
  doc.strokeColor(colorBorder).lineWidth(0.5)
    .moveTo(margin, footerY).lineTo(margin + contentW, footerY).stroke();

  doc.fontSize(7).fillColor(colorMuted).font("NotoSans")
    .text("This is a computer-generated invoice.", margin, footerY + 8, { width: contentW, align: "center" });

  // Authorized signatory
  doc.fontSize(7.5).fillColor(colorSecondary).font("NotoSans")
    .text("Authorized Signatory", margin + contentW - 120, footerY - 30, { width: 120, align: "right" });
  doc.strokeColor(colorBorder).lineWidth(0.5)
    .moveTo(margin + contentW - 120, footerY - 8).lineTo(margin + contentW, footerY - 8).stroke();
}

// ── Thermal Receipt (58mm / 80mm) ──────────────────────────────

function generateThermalReceipt(doc: InstanceType<typeof PDFDocument>, data: InvoicePDFData) {
  const pageW = 226; // ~80mm at 72 DPI
  const margin = 8;
  const contentW = pageW - margin * 2;
  let y = margin;

  const colorBlack = "#000000";
  const colorGray = "#555555";

  function separator() {
    const dashes = "─".repeat(35);
    doc.fontSize(6).fillColor(colorGray).font("NotoSans")
      .text(dashes, margin, y, { width: contentW, align: "center" });
    y += 10;
  }

  // Header
  doc.fontSize(10).fillColor(colorBlack).font("Courier-Bold")
    .text(data.businessName.toUpperCase(), margin, y, { width: contentW, align: "center" });
  y += 14;

  if (data.businessAddress) {
    doc.fontSize(6).fillColor(colorGray).font("NotoSans")
      .text(data.businessAddress, margin, y, { width: contentW, align: "center" });
    y += 9;
  }

  const cityLine = [data.businessCity, data.businessState].filter(Boolean).join(", ");
  if (cityLine) {
    doc.text(cityLine, margin, y, { width: contentW, align: "center" });
    y += 9;
  }

  if (data.businessPhone) {
    doc.text(`Ph: ${data.businessPhone}`, margin, y, { width: contentW, align: "center" });
    y += 9;
  }

  if (data.businessGstin && data.gstRegistrationType !== "unregistered") {
    doc.fontSize(6).font("Courier-Bold")
      .text(`GSTIN: ${data.businessGstin}`, margin, y, { width: contentW, align: "center" });
    y += 9;
  }

  y += 4;
  separator();

  // Invoice info
  doc.fontSize(8).fillColor(colorBlack).font("Courier-Bold")
    .text(getInvoiceTitle(data), margin, y, { width: contentW, align: "center" });
  y += 12;

  doc.fontSize(6).font("NotoSans").fillColor(colorBlack);
  doc.text(`No: ${data.invoiceNumber}`, margin, y);
  doc.text(fmtDate(data.invoiceDate), margin, y, { width: contentW, align: "right" });
  y += 9;

  doc.text(`To: ${data.partyName}`, margin, y, { width: contentW });
  y += 9;

  if (data.partyGstin) {
    doc.text(`GSTIN: ${data.partyGstin}`, margin, y);
    y += 9;
  }

  separator();

  // Items
  doc.fontSize(6).font("Courier-Bold").fillColor(colorBlack);
  doc.text("ITEM", margin, y);
  doc.text("QTY", margin + contentW * 0.5, y, { width: 30, align: "right" });
  doc.text("AMT", margin + contentW * 0.7, y, { width: contentW * 0.3, align: "right" });
  y += 10;

  doc.font("NotoSans").fontSize(6);
  for (const item of data.lineItems) {
    // Item name (may wrap)
    const nameW = contentW * 0.48;
    doc.text(item.description, margin, y, { width: nameW });
    const nameH = doc.heightOfString(item.description, { width: nameW });

    doc.text(parseFloat(item.quantity).toString(), margin + contentW * 0.5, y, { width: 30, align: "right" });
    doc.text(fmt(item.totalAmount), margin + contentW * 0.7, y, { width: contentW * 0.3, align: "right" });

    // Rate + tax under item name
    y += Math.max(nameH, 8) + 1;
    doc.fontSize(5).fillColor(colorGray)
      .text(`@ ${fmt(item.unitPrice)} + ${item.taxPercent}% tax`, margin + 4, y);
    doc.fillColor(colorBlack).fontSize(6);
    y += 9;
  }

  separator();

  // Totals
  function totalLine(label: string, value: string, bold = false) {
    doc.fontSize(bold ? 8 : 6).font(bold ? "Courier-Bold" : "Courier")
      .text(label, margin, y)
      .text(fmt(value), margin, y, { width: contentW, align: "right" });
    y += bold ? 12 : 9;
  }

  totalLine("Subtotal", data.subtotal);
  totalLine("Tax", data.taxAmount);
  if (parseFloat(data.discountAmount) > 0) totalLine("Discount", `-${data.discountAmount}`);

  separator();
  totalLine("TOTAL", data.totalAmount, true);

  if (parseFloat(data.amountPaid) > 0) {
    totalLine("Paid", data.amountPaid);
    const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
    if (balance > 0) totalLine("Balance", balance.toFixed(2), true);
  }

  separator();

  // Footer
  doc.fontSize(5).fillColor(colorGray).font("NotoSans")
    .text("Thank you for your business!", margin, y, { width: contentW, align: "center" });
  y += 8;
  doc.text("Computer generated invoice", margin, y, { width: contentW, align: "center" });
  y += 12;
}

// ── A5 Landscape Invoice (210mm × 148mm = 595.28 × 419.53 pt) ──

function generateA5LandscapeInvoice(doc: InstanceType<typeof PDFDocument>, data: InvoicePDFData) {
  const pageW = 595.28;
  const pageH = 419.53;
  const margin = 30;
  const contentW = pageW - margin * 2;
  let y = margin;

  const colorPrimary = "#1a1a2e";
  const colorSecondary = "#495057";
  const colorMuted = "#868e96";
  const colorAccent = "#4263eb";
  const colorBorder = "#dee2e6";
  const colorBg = "#f8f9fa";

  // ── Two-column header ─────────────────────────────────────────
  // Left: business info
  doc.fontSize(14).fillColor(colorPrimary).font("NotoSans-Bold")
    .text(data.businessName, margin, y, { width: contentW * 0.55 });
  y += 20;

  if (data.businessLegalName) {
    doc.fontSize(7.5).fillColor(colorSecondary).font("NotoSans")
      .text(data.businessLegalName, margin, y, { width: contentW * 0.55 });
    y += 11;
  }

  const bizDetails: string[] = [];
  if (data.businessAddress) bizDetails.push(data.businessAddress);
  const cityLine = [data.businessCity, data.businessState, data.businessPincode].filter(Boolean).join(", ");
  if (cityLine) bizDetails.push(cityLine);
  if (data.businessPhone) bizDetails.push(`Ph: ${data.businessPhone}`);
  if (data.businessEmail) bizDetails.push(data.businessEmail);

  doc.fontSize(7).fillColor(colorMuted).font("NotoSans");
  for (const line of bizDetails) {
    doc.text(line, margin, y, { width: contentW * 0.55 });
    y += 9;
  }

  if (data.businessGstin && data.gstRegistrationType !== "unregistered") {
    doc.fontSize(7).fillColor(colorSecondary).font("NotoSans-Bold")
      .text(`GSTIN: ${data.businessGstin}`, margin, y, { width: contentW * 0.55 });
    y += 9;
  }
  if (data.businessPan) {
    doc.fontSize(7).fillColor(colorSecondary).font("NotoSans-Bold")
      .text(`PAN: ${data.businessPan}`, margin, y, { width: contentW * 0.55 });
    y += 9;
  }

  // Right: invoice title and details
  const rightX = margin + contentW * 0.6;
  const rightW = contentW * 0.4;
  const titleLabel = getInvoiceTitle(data);
  doc.fontSize(11).fillColor(colorAccent).font("NotoSans-Bold")
    .text(titleLabel, rightX, margin, { width: rightW, align: "right" });
  doc.fontSize(8.5).fillColor(colorPrimary).font("NotoSans-Bold")
    .text(`# ${data.invoiceNumber}`, rightX, margin + 16, { width: rightW, align: "right" });
  doc.fontSize(7).fillColor(colorSecondary).font("NotoSans")
    .text(`Date: ${fmtDate(data.invoiceDate)}`, rightX, margin + 28, { width: rightW, align: "right" });
  if (data.dueDate) {
    doc.text(`Due: ${fmtDate(data.dueDate)}`, rightX, margin + 38, { width: rightW, align: "right" });
  }

  y = Math.max(y, margin + 55) + 10;

  // ── Divider ──────────────────────────────────────────────────
  doc.strokeColor(colorBorder).lineWidth(0.5)
    .moveTo(margin, y).lineTo(margin + contentW, y).stroke();
  y += 10;

  // ── Bill To ──────────────────────────────────────────────────
  doc.fontSize(7).fillColor(colorMuted).font("NotoSans-Bold")
    .text("BILL TO", margin, y);
  y += 10;

  doc.fontSize(8.5).fillColor(colorPrimary).font("NotoSans-Bold")
    .text(data.partyName, margin, y);
  y += 12;

  doc.fontSize(7).fillColor(colorSecondary).font("NotoSans");
  if (data.partyBillingAddress) { doc.text(data.partyBillingAddress, margin, y, { width: contentW * 0.5 }); y += 9; }
  const partyCityLine = [data.partyCity, data.partyState].filter(Boolean).join(", ");
  if (partyCityLine) { doc.text(partyCityLine, margin, y); y += 9; }
  if (data.partyPhone) { doc.text(`Ph: ${data.partyPhone}`, margin, y); y += 9; }
  if (data.partyGstin) {
    doc.font("NotoSans-Bold").text(`GSTIN: ${data.partyGstin}`, margin, y);
    y += 9;
  }

  y += 10;

  // ── Items Table ──────────────────────────────────────────────
  const showHsn = (data.gstRegistrationType === "regular" || data.gstRegistrationType === "composition")
    && data.lineItemHsn?.some(h => h);
  const hsnColW = 40;

  const colX = {
    idx: margin,
    hsn: margin + 20,
    desc: showHsn ? margin + 20 + hsnColW : margin + 20,
    qty: margin + contentW * 0.52,
    rate: margin + contentW * 0.63,
    tax: margin + contentW * 0.76,
    amount: margin + contentW * 0.88,
  };

  // Table header
  doc.rect(margin, y, contentW, 17).fill(colorBg);
  doc.fontSize(6.5).fillColor(colorSecondary).font("NotoSans-Bold");
  doc.text("#", colX.idx + 3, y + 5);
  if (showHsn) doc.text("HSN", colX.hsn, y + 5, { width: hsnColW });
  doc.text("DESCRIPTION", colX.desc, y + 5);
  doc.text("QTY", colX.qty, y + 5, { width: contentW * 0.1, align: "right" });
  doc.text("RATE", colX.rate, y + 5, { width: contentW * 0.12, align: "right" });
  doc.text("TAX", colX.tax, y + 5, { width: contentW * 0.1, align: "right" });
  doc.text("AMOUNT", colX.amount, y + 5, { width: contentW * 0.12, align: "right" });
  y += 17;

  // Table rows
  doc.font("NotoSans").fontSize(7.5).fillColor(colorPrimary);
  data.lineItems.forEach((item, i) => {
    const rowH = 16;
    if (i % 2 === 1) {
      doc.rect(margin, y, contentW, rowH).fill("#fcfcfd");
      doc.fillColor(colorPrimary);
    }
    const rowY = y + 4;
    const descW = showHsn ? contentW * 0.38 - hsnColW : contentW * 0.38;
    doc.text(`${i + 1}`, colX.idx + 3, rowY);
    if (showHsn) doc.text(data.lineItemHsn?.[i] || "", colX.hsn, rowY, { width: hsnColW });
    doc.text(item.description, colX.desc, rowY, { width: descW });
    doc.text(parseFloat(item.quantity).toLocaleString("en-IN"), colX.qty, rowY, { width: contentW * 0.1, align: "right" });
    doc.text(fmt(item.unitPrice), colX.rate, rowY, { width: contentW * 0.12, align: "right" });
    doc.text(`${item.taxPercent}%`, colX.tax, rowY, { width: contentW * 0.1, align: "right" });
    doc.font("NotoSans-Bold").text(fmt(item.totalAmount), colX.amount, rowY, { width: contentW * 0.12, align: "right" });
    doc.font("NotoSans");
    y += rowH;
  });

  // Bottom border of table
  doc.strokeColor(colorBorder).lineWidth(0.5)
    .moveTo(margin, y).lineTo(margin + contentW, y).stroke();
  y += 10;

  // ── Bottom section: payment info left, totals right ───────────
  const bottomY = y;
  const leftColW = contentW * 0.55;
  const rightColX = margin + contentW * 0.58;
  const rightColW = contentW * 0.42;

  // Totals (right column)
  let ty = bottomY;
  const totalsValX = margin + contentW * 0.88;
  const totalsValW = contentW * 0.12;

  function totalRow(label: string, value: string, bold = false) {
    doc.fontSize(7).fillColor(bold ? colorPrimary : colorSecondary)
      .font(bold ? "NotoSans-Bold" : "NotoSans")
      .text(label, rightColX, ty, { width: rightColW * 0.65 });
    doc.fontSize(bold ? 8.5 : 7).fillColor(colorPrimary)
      .font(bold ? "NotoSans-Bold" : "NotoSans")
      .text(fmt(value), totalsValX, ty, { width: totalsValW, align: "right" });
    ty += bold ? 14 : 11;
  }

  totalRow("Subtotal", data.subtotal);
  if (parseFloat(data.discountAmount) > 0) totalRow("Discount", `-${data.discountAmount}`);
  totalRow("Tax", data.taxAmount);

  doc.strokeColor(colorBorder).lineWidth(0.5)
    .moveTo(rightColX, ty).lineTo(margin + contentW, ty).stroke();
  ty += 5;

  totalRow("Total", data.totalAmount, true);

  if (parseFloat(data.amountPaid) > 0) {
    totalRow("Amount Paid", data.amountPaid);
    const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
    if (balance > 0) totalRow("Balance Due", balance.toFixed(2), true);
  }

  // Amount in words (below totals, in right col)
  ty += 4;
  doc.fontSize(6).fillColor(colorMuted).font("NotoSans-Bold")
    .text("Amount in words:", rightColX, ty, { width: rightColW });
  ty += 9;
  doc.fontSize(6).fillColor(colorSecondary).font("NotoSans")
    .text(numberToWords(parseFloat(data.totalAmount)), rightColX, ty, { width: rightColW });

  // Payment info (left column)
  const hasPaymentInfo = data.type === "sale" && (data.bankAccountNumber || data.upiId);
  if (hasPaymentInfo) {
    let py = bottomY;
    doc.fontSize(7.5).fillColor(colorSecondary).font("NotoSans-Bold")
      .text("Payment Information", margin, py);
    py += 12;

    const hasQr = !!data.upiQrDataUrl;
    const qrSize = 60;
    const textW = hasQr ? leftColW - qrSize - 12 : leftColW - 6;

    if (data.bankAccountNumber) {
      doc.fontSize(7).fillColor(colorMuted).font("NotoSans-Bold")
        .text("Bank:", margin, py);
      doc.font("NotoSans").fillColor(colorPrimary)
        .text(data.bankName || "Bank", margin + 30, py, { width: textW - 30 });
      py += 10;

      doc.fontSize(7).fillColor(colorMuted).font("NotoSans-Bold")
        .text("A/C:", margin, py);
      doc.font("NotoSans").fillColor(colorPrimary)
        .text(data.bankAccountNumber, margin + 30, py);
      py += 10;

      if (data.bankIfsc) {
        doc.fontSize(7).fillColor(colorMuted).font("NotoSans-Bold")
          .text("IFSC:", margin, py);
        doc.font("NotoSans").fillColor(colorPrimary)
          .text(data.bankIfsc, margin + 30, py);
        py += 10;
      }
      if (data.bankAccountName) {
        doc.fontSize(7).fillColor(colorMuted).font("NotoSans-Bold")
          .text("Name:", margin, py);
        doc.font("NotoSans").fillColor(colorPrimary)
          .text(data.bankAccountName, margin + 30, py, { width: textW - 30 });
        py += 10;
      }
    }

    if (data.upiId) {
      doc.fontSize(7).fillColor(colorMuted).font("NotoSans-Bold")
        .text("UPI:", margin, py);
      doc.font("NotoSans").fillColor(colorPrimary)
        .text(data.upiId, margin + 30, py, { width: textW - 30 });
      py += 10;
    }

    if (hasQr && data.upiQrDataUrl) {
      const qrX = margin + leftColW - qrSize - 4;
      const qrY = bottomY + 12;
      try {
        const qrBuffer = Buffer.from(data.upiQrDataUrl.split(",")[1], "base64");
        doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
        const balance = parseFloat(data.totalAmount) - parseFloat(data.amountPaid);
        if (balance > 0) {
          doc.fontSize(5.5).fillColor(colorMuted).font("NotoSans")
            .text(`Scan to pay ${fmt(balance)}`, qrX, qrY + qrSize + 2, { width: qrSize, align: "center" });
        }
      } catch {
        // skip QR if image fails
      }
    }
  }

  // ── GST Breakdown (compact, below bottom section) ─────────────
  const isGstRegistered = data.gstRegistrationType === "regular" || data.gstRegistrationType === "composition";
  let gstBottomY = Math.max(ty, bottomY) + 10;

  if (isGstRegistered && parseFloat(data.taxAmount) > 0) {
    const gstRates = new Map<string, { taxable: number; cgst: number; sgst: number; igst: number }>();

    // Use state codes for inter/intra-state detection; fall back to state names
    const isSameState = data.businessStateCode && data.partyStateCode
      ? data.businessStateCode === data.partyStateCode
      : (data.businessState && data.partyState
          ? data.businessState.toLowerCase() === data.partyState.toLowerCase()
          : false);

    for (const item of data.lineItems) {
      const rate = item.taxPercent;
      const taxable = parseFloat(item.totalAmount) - parseFloat(item.taxAmount);
      const taxAmt = parseFloat(item.taxAmount);
      if (!gstRates.has(rate)) {
        gstRates.set(rate, { taxable: 0, cgst: 0, sgst: 0, igst: 0 });
      }
      const entry = gstRates.get(rate)!;
      entry.taxable += taxable;
      if (isSameState) {
        entry.cgst += taxAmt / 2;
        entry.sgst += taxAmt / 2;
      } else {
        entry.igst += taxAmt;
      }
    }

    if (gstRates.size > 0) {
      doc.fontSize(6.5).fillColor(colorMuted).font("NotoSans-Bold")
        .text("TAX BREAKDOWN", margin, gstBottomY);
      gstBottomY += 10;

      doc.rect(margin, gstBottomY, contentW * 0.55, 14).fill(colorBg);
      doc.fontSize(6).fillColor(colorSecondary).font("NotoSans-Bold");
      doc.text("RATE", margin + 3, gstBottomY + 4);
      doc.text("TAXABLE", margin + 60, gstBottomY + 4, { width: 60, align: "right" });
      if (isSameState) {
        doc.text("CGST", margin + 140, gstBottomY + 4, { width: 50, align: "right" });
        doc.text("SGST", margin + 200, gstBottomY + 4, { width: 50, align: "right" });
      } else {
        doc.text("IGST", margin + 140, gstBottomY + 4, { width: 50, align: "right" });
      }
      gstBottomY += 14;

      doc.font("NotoSans").fontSize(6).fillColor(colorPrimary);
      for (const [rate, amounts] of gstRates) {
        doc.text(`${rate}%`, margin + 3, gstBottomY + 2);
        doc.text(fmt(amounts.taxable), margin + 60, gstBottomY + 2, { width: 60, align: "right" });
        if (isSameState) {
          doc.text(fmt(amounts.cgst), margin + 140, gstBottomY + 2, { width: 50, align: "right" });
          doc.text(fmt(amounts.sgst), margin + 200, gstBottomY + 2, { width: 50, align: "right" });
        } else {
          doc.text(fmt(amounts.igst), margin + 140, gstBottomY + 2, { width: 50, align: "right" });
        }
        gstBottomY += 11;
      }
      gstBottomY += 4;
    }
  }

  // ── Notes / Terms (compact) ───────────────────────────────────
  let notesY = gstBottomY;

  if (data.notes) {
    doc.fontSize(6.5).fillColor(colorMuted).font("NotoSans-Bold").text("Notes", margin, notesY);
    notesY += 9;
    doc.fontSize(7).fillColor(colorSecondary).font("NotoSans")
      .text(data.notes, margin, notesY, { width: contentW * 0.55 });
    notesY += doc.heightOfString(data.notes, { width: contentW * 0.55 }) + 8;
  }

  if (data.termsAndConditions) {
    doc.fontSize(6.5).fillColor(colorMuted).font("NotoSans-Bold").text("Terms & Conditions", margin, notesY);
    notesY += 9;
    doc.fontSize(6.5).fillColor(colorMuted).font("NotoSans")
      .text(data.termsAndConditions, margin, notesY, { width: contentW * 0.55 });
  }

  // ── Footer ───────────────────────────────────────────────────
  const footerY = pageH - 20;
  doc.strokeColor(colorBorder).lineWidth(0.5)
    .moveTo(margin, footerY).lineTo(margin + contentW, footerY).stroke();
  doc.fontSize(6).fillColor(colorMuted).font("NotoSans")
    .text("This is a computer-generated invoice.", margin, footerY + 4, { width: contentW, align: "center" });

  // Authorized signatory
  doc.fontSize(7).fillColor(colorSecondary).font("NotoSans")
    .text("Authorized Signatory", margin + contentW - 110, footerY - 22, { width: 110, align: "right" });
  doc.strokeColor(colorBorder).lineWidth(0.5)
    .moveTo(margin + contentW - 110, footerY - 6).lineTo(margin + contentW, footerY - 6).stroke();
}

// ── Public API ─────────────────────────────────────────────────

export function generateInvoicePDF(data: InvoicePDFData, format: PDFFormat = "a5-landscape"): InstanceType<typeof PDFDocument> {
  const isA4 = format === "a4";
  const isA5Landscape = format === "a5-landscape";

  let docSize: string | number[];
  let docMargin: number;
  if (isA5Landscape) {
    docSize = [595.28, 419.53];
    docMargin = 30;
  } else if (isA4) {
    docSize = "A4";
    docMargin = 40;
  } else {
    docSize = [226, 800]; // 80mm thermal
    docMargin = 8;
  }

  const doc = new PDFDocument({
    size: docSize,
    margin: docMargin,
    bufferPages: true,
    info: {
      Title: `Invoice ${data.invoiceNumber}`,
      Author: data.businessName,
      Subject: `Invoice for ${data.partyName}`,
      Creator: "Hisaabo",
    },
  });

  // Register Noto Sans (supports ₹ and all Indic scripts)
  doc.registerFont("NotoSans", FONT_REGULAR);
  doc.registerFont("NotoSans-Bold", FONT_BOLD);

  if (isA5Landscape) {
    generateA5LandscapeInvoice(doc, data);
  } else if (format === "thermal") {
    generateThermalReceipt(doc, data);
  } else {
    generateA4Invoice(doc, data);
  }

  return doc;
}
