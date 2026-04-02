import PDFDocument from "pdfkit";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_REGULAR = resolve(__dirname, "../../fonts/NotoSans-Regular.ttf");
const FONT_BOLD = resolve(__dirname, "../../fonts/NotoSans-Bold.ttf");

// ── Types ──────────────────────────────────────────────────────

export interface LedgerEntry {
  date: Date;
  type: "invoice" | "payment";
  number: string;
  description: string;
  debit: string;
  credit: string;
  runningBalance: string;
}

export interface LedgerPDFData {
  businessName: string;
  partyName: string;
  partyType: string;
  openingBalance: string;
  fromDate: string | null;
  toDate: string | null;
  entries: LedgerEntry[];
  summary: {
    totalDebit: string;
    totalCredit: string;
    closingBalance: string;
  };
  // UPI payment QR — shown when closing balance is receivable
  upiQrDataUrl?: string;
  upiPayUrl?: string;
}

// ── Helpers ────────────────────────────────────────────────────

function fmt(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "0.00";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function fmtDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

// ── PDF Generator ─────────────────────────────────────────────

function generateLedgerPDFDoc(doc: InstanceType<typeof PDFDocument>, data: LedgerPDFData) {
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
  const colorDebit = "#c92a2a";
  const colorCredit = "#2f9e44";

  // ── Header ───────────────────────────────────────────────────

  // Business name
  doc.fontSize(16).fillColor(colorPrimary).font("NotoSans-Bold")
    .text(data.businessName, margin, y, { width: contentW });
  y += 22;

  // Report title
  doc.fontSize(11).fillColor(colorAccent).font("NotoSans-Bold")
    .text(`Party Ledger: ${data.partyName}`, margin, y, { width: contentW });
  y += 16;

  // Period
  const fromLabel = data.fromDate ? fmtDate(data.fromDate) : "Beginning";
  const toLabel = data.toDate ? fmtDate(data.toDate) : "Today";
  doc.fontSize(8.5).fillColor(colorSecondary).font("NotoSans")
    .text(`Period: ${fromLabel} to ${toLabel}`, margin, y);
  y += 12;

  // Party type badge
  doc.fontSize(8).fillColor(colorMuted).font("NotoSans")
    .text(`Type: ${data.partyType.charAt(0).toUpperCase() + data.partyType.slice(1)}`, margin, y);
  y += 18;

  // ── Divider ──────────────────────────────────────────────────
  doc.strokeColor(colorBorder).lineWidth(0.75)
    .moveTo(margin, y).lineTo(margin + contentW, y).stroke();
  y += 14;

  // ── Summary row ──────────────────────────────────────────────
  // Three boxes: Opening Balance | Total Debit | Total Credit | Closing Balance
  const boxW = contentW / 4;
  const summaryItems = [
    { label: "Opening Balance", value: fmt(data.openingBalance) },
    { label: "Total Debit", value: fmt(data.summary.totalDebit), color: colorDebit },
    { label: "Total Credit", value: fmt(data.summary.totalCredit), color: colorCredit },
    { label: "Closing Balance", value: fmt(data.summary.closingBalance) },
  ];

  const boxH = 36;
  summaryItems.forEach((item, i) => {
    const bx = margin + i * boxW;
    doc.rect(bx, y, boxW - 4, boxH).fill(colorBg);
    doc.fontSize(7).fillColor(colorMuted).font("NotoSans")
      .text(item.label.toUpperCase(), bx + 6, y + 6, { width: boxW - 12 });
    doc.fontSize(9).fillColor(item.color || colorPrimary).font("NotoSans-Bold")
      .text(item.value, bx + 6, y + 18, { width: boxW - 12 });
  });
  y += boxH + 14;

  // ── Table ────────────────────────────────────────────────────

  // Column X positions and widths
  const col = {
    date:   { x: margin,               w: 58 },
    doc:    { x: margin + 58,           w: 70 },
    desc:   { x: margin + 128,          w: contentW - 128 - 64 - 64 - 60 },
    debit:  { x: margin + contentW - 64 - 64 - 60, w: 64 },
    credit: { x: margin + contentW - 64 - 60,       w: 64 },
    bal:    { x: margin + contentW - 60,             w: 60 },
  };

  // Table header
  const hdrH = 20;
  doc.rect(margin, y, contentW, hdrH).fill(colorPrimary);
  doc.fontSize(7.5).fillColor("#ffffff").font("NotoSans-Bold");
  doc.text("DATE",        col.date.x  + 4, y + 6, { width: col.date.w  - 4 });
  doc.text("DOCUMENT #",  col.doc.x   + 4, y + 6, { width: col.doc.w  - 4 });
  doc.text("DESCRIPTION", col.desc.x  + 4, y + 6, { width: col.desc.w - 4 });
  doc.text("DEBIT",       col.debit.x + 4, y + 6, { width: col.debit.w - 4, align: "right" });
  doc.text("CREDIT",      col.credit.x + 4, y + 6, { width: col.credit.w - 4, align: "right" });
  doc.text("BALANCE",     col.bal.x   + 2, y + 6, { width: col.bal.w  - 2, align: "right" });
  y += hdrH;

  // Opening balance row
  const obRowH = 18;
  doc.rect(margin, y, contentW, obRowH).fill(colorBg);
  doc.fontSize(8).fillColor(colorSecondary).font("NotoSans");
  doc.text("—",                 col.date.x  + 4, y + 5, { width: col.date.w  - 4 });
  doc.text("—",                 col.doc.x   + 4, y + 5, { width: col.doc.w  - 4 });
  doc.font("NotoSans-Bold")
    .text("Opening Balance",    col.desc.x  + 4, y + 5, { width: col.desc.w - 4 });
  doc.font("NotoSans")
    .text("—",                  col.debit.x + 4, y + 5, { width: col.debit.w - 4, align: "right" });
  doc.text("—",                 col.credit.x + 4, y + 5, { width: col.credit.w - 4, align: "right" });
  doc.font("NotoSans-Bold")
    .fillColor(colorPrimary)
    .text(fmt(data.openingBalance), col.bal.x + 2, y + 5, { width: col.bal.w - 2, align: "right" });
  y += obRowH;

  // Transaction rows
  const rowH = 18;
  data.entries.forEach((e, i) => {
    // Zebra stripe
    if (i % 2 === 0) {
      doc.rect(margin, y, contentW, rowH).fill("#ffffff");
    } else {
      doc.rect(margin, y, contentW, rowH).fill(colorBg);
    }

    const hasDebit  = e.debit  !== "0" && e.debit  !== "0.00";
    const hasCredit = e.credit !== "0" && e.credit !== "0.00";
    const bal = parseFloat(e.runningBalance);

    doc.fontSize(7.5).fillColor(colorSecondary).font("NotoSans");
    doc.text(fmtDate(e.date),  col.date.x  + 4, y + 5, { width: col.date.w  - 4 });
    doc.text(e.number || "—",  col.doc.x   + 4, y + 5, { width: col.doc.w  - 4 });
    doc.fillColor(colorPrimary)
      .text(e.description,     col.desc.x  + 4, y + 5, { width: col.desc.w - 4 });

    // Debit column
    if (hasDebit) {
      doc.fillColor(colorDebit).font("NotoSans")
        .text(fmt(e.debit),    col.debit.x + 4, y + 5, { width: col.debit.w - 4, align: "right" });
    } else {
      doc.fillColor(colorMuted)
        .text("—",             col.debit.x + 4, y + 5, { width: col.debit.w - 4, align: "right" });
    }

    // Credit column
    if (hasCredit) {
      doc.fillColor(colorCredit)
        .text(fmt(e.credit),   col.credit.x + 4, y + 5, { width: col.credit.w - 4, align: "right" });
    } else {
      doc.fillColor(colorMuted)
        .text("—",             col.credit.x + 4, y + 5, { width: col.credit.w - 4, align: "right" });
    }

    // Running balance
    doc.fillColor(bal > 0 ? colorDebit : bal < 0 ? colorCredit : colorPrimary).font("NotoSans-Bold")
      .text(fmt(e.runningBalance), col.bal.x + 2, y + 5, { width: col.bal.w - 2, align: "right" });

    y += rowH;

    // Page break: leave 60pt for closing row + footer
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = margin;
    }
  });

  // ── Closing balance row ───────────────────────────────────────
  const cbRowH = 22;
  doc.rect(margin, y, contentW, cbRowH).fill(colorPrimary);
  doc.fontSize(8).fillColor("#ffffff").font("NotoSans-Bold");
  doc.text("Closing Balance",    col.desc.x + 4, y + 7, { width: col.desc.w - 4 });
  doc.text(fmt(data.summary.totalDebit),  col.debit.x  + 4, y + 7, { width: col.debit.w  - 4, align: "right" });
  doc.text(fmt(data.summary.totalCredit), col.credit.x + 4, y + 7, { width: col.credit.w - 4, align: "right" });
  doc.text(fmt(data.summary.closingBalance), col.bal.x + 2, y + 7, { width: col.bal.w - 2, align: "right" });
  y += cbRowH + 12;

  // ── UPI QR code (if receivable balance exists) ────────────────
  if (data.upiQrDataUrl && parseFloat(data.summary.closingBalance) > 0) {
    const qrSize = 72;
    try {
      const qrBuffer = Buffer.from(data.upiQrDataUrl.split(",")[1], "base64");
      doc.image(qrBuffer, margin, y, { width: qrSize, height: qrSize });
      if (data.upiPayUrl) {
        doc.link(margin, y, qrSize, qrSize, data.upiPayUrl);
      }
      const label = data.upiPayUrl ? "Scan or tap to pay" : "Scan to pay";
      doc.fontSize(7).fillColor(colorMuted).font("NotoSans")
        .text(`${label} ${fmt(data.summary.closingBalance)}`, margin, y + qrSize + 2,
          { width: qrSize, align: "center" });
      y += qrSize + 16;
    } catch {
      // skip QR if image decoding fails
    }
  }

  y += 8;

  // ── Footer ────────────────────────────────────────────────────
  doc.fontSize(7).fillColor(colorMuted).font("NotoSans")
    .text(
      `Generated by Hisaabo on ${fmtDate(new Date())}`,
      margin, y,
      { width: contentW, align: "right" },
    );
}

// ── Public export — returns a Buffer ─────────────────────────

export function generateLedgerPDF(data: LedgerPDFData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      bufferPages: true,
      info: {
        Title: `Party Ledger — ${data.partyName}`,
        Author: data.businessName,
        Subject: `Ledger report for ${data.partyName}`,
        Creator: "Hisaabo",
      },
    });

    doc.registerFont("NotoSans", FONT_REGULAR);
    doc.registerFont("NotoSans-Bold", FONT_BOLD);

    generateLedgerPDFDoc(doc, data);

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}
