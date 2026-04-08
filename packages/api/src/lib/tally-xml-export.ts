/**
 * tally-xml-export.ts — Tally Prime XML generator.
 *
 * Converts DerivedEntry[] (from derive-ledger) and Chart of Accounts
 * into a Tally Prime-compatible XML import file.
 *
 * Key Tally conventions:
 *   - AMOUNT: negative = debit, positive = credit (opposite of standard)
 *   - ISDEEMEDPOSITIVE: "Yes" for debit lines, "No" for credit lines
 *   - DATE format: YYYYMMDD
 *   - Voucher types: Sales, Purchase, Receipt, Payment, Journal, Contra
 */

import type { DerivedEntry } from "./derive-ledger.js";

// ── Types ────────────────────────────────────────────────────────

export interface TallyAccount {
  code: string;
  name: string;
  accountType: "asset" | "liability" | "equity" | "income" | "expense";
}

export interface TallyBusiness {
  name: string;
}

// ── XML escaping ─────────────────────────────────────────────────

/**
 * Escape characters that are illegal inside XML text nodes and attributes.
 * Covers the five predefined XML entities.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Date formatting ──────────────────────────────────────────────

/** Format a Date as Tally's YYYYMMDD string. */
function formatTallyDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// ── Account type → Tally parent group ───────────────────────────

/**
 * Map a Chart of Accounts accountType to the appropriate Tally parent ledger
 * group. Income is split into Sales / other income by account code prefix:
 *   4000-4099 → Sales Accounts
 *   4100+     → Direct Income
 * Expenses are split by code prefix:
 *   5000-5199 → Purchase Accounts / Direct Expenses
 *   5200+     → Indirect Expenses
 */
function accountTypeToTallyParent(account: TallyAccount): string {
  switch (account.accountType) {
    case "asset":
      return "Current Assets";
    case "liability":
      return "Current Liabilities";
    case "equity":
      return "Capital Account";
    case "income": {
      const code = parseInt(account.code, 10);
      if (code >= 4000 && code <= 4099) return "Sales Accounts";
      return "Direct Income";
    }
    case "expense": {
      const code = parseInt(account.code, 10);
      if (code >= 5000 && code <= 5099) return "Purchase Accounts";
      if (code >= 5100 && code <= 5199) return "Direct Expenses";
      return "Indirect Expenses";
    }
  }
}

// ── Source type → Tally voucher type ────────────────────────────

/**
 * Map a DerivedEntry sourceType + narration to the correct Tally VCHTYPE.
 *
 * Rules (from spec):
 *   invoice  narration starts with "Purchase" → Purchase
 *   invoice  otherwise                        → Sales
 *   payment  narration starts with "Payment Made" → Payment
 *   payment  otherwise (received)                 → Receipt
 *   expense                                       → Payment
 *   journal                                       → Journal
 *   bank_transfer                                 → Contra
 */
function sourceTypeToVchType(entry: Pick<DerivedEntry, "sourceType" | "narration">): string {
  switch (entry.sourceType) {
    case "invoice":
      return entry.narration.startsWith("Purchase") ? "Purchase" : "Sales";
    case "payment":
      return entry.narration.startsWith("Payment Made") ? "Payment" : "Receipt";
    case "expense":
      return "Payment";
    case "bank_transfer":
      return "Contra";
    case "journal":
    default:
      return "Journal";
  }
}

// ── Amount sign convention ───────────────────────────────────────

/**
 * Tally uses negative amounts for debits and positive for credits.
 * Given a DerivedEntryLine, return the Tally-signed amount string.
 */
function tallyAmount(debit: string, credit: string): string {
  const debitVal = parseFloat(debit);
  const creditVal = parseFloat(credit);

  if (debitVal > 0) {
    // Debit side: negate the amount
    return `-${debitVal.toFixed(2)}`;
  }
  // Credit side: positive
  return creditVal.toFixed(2);
}

/** Returns "Yes" for debit lines (deemed positive = increases asset/expense). */
function isDeemedPositive(debit: string): "Yes" | "No" {
  return parseFloat(debit) > 0 ? "Yes" : "No";
}

// ── XML building helpers ─────────────────────────────────────────

function tag(name: string, value: string): string {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

function rawTag(name: string, value: string): string {
  // Used when value is already-built XML (no escaping)
  return `<${name}>${value}</${name}>`;
}

// ── Ledger master builder ────────────────────────────────────────

function buildLedgerMessage(account: TallyAccount): string {
  const parent = accountTypeToTallyParent(account);
  return [
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `  <LEDGER NAME="${escapeXml(account.name)}" ACTION="Create">`,
    `    ${rawTag("NAME.LIST", `\n      ${tag("NAME", account.name)}\n    `)}`,
    `    ${tag("PARENT", parent)}`,
    "    <ISBILLWISEON>No</ISBILLWISEON>",
    "  </LEDGER>",
    "</TALLYMESSAGE>",
  ].join("\n");
}

// ── Voucher builder ──────────────────────────────────────────────

function buildVoucherMessage(entry: DerivedEntry): string {
  const vchType = sourceTypeToVchType(entry);
  const dateStr = formatTallyDate(entry.date);

  const ledgerLines = entry.lines
    .map((line) => {
      const amount = tallyAmount(line.debit, line.credit);
      const deemed = isDeemedPositive(line.debit);
      return [
        "    <ALLLEDGERENTRIES.LIST>",
        `      ${tag("LEDGERNAME", line.accountName)}`,
        `      <ISDEEMEDPOSITIVE>${deemed}</ISDEEMEDPOSITIVE>`,
        `      <AMOUNT>${amount}</AMOUNT>`,
        "    </ALLLEDGERENTRIES.LIST>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<TALLYMESSAGE xmlns:UDF="TallyUDF">',
    `  <VOUCHER VCHTYPE="${vchType}" ACTION="Create">`,
    `    ${tag("DATE", dateStr)}`,
    `    ${tag("NARRATION", entry.narration)}`,
    `    ${tag("VOUCHERTYPENAME", vchType)}`,
    `    ${tag("VOUCHERNUMBER", entry.sourceNumber)}`,
    ledgerLines,
    "  </VOUCHER>",
    "</TALLYMESSAGE>",
  ].join("\n");
}

// ── Main export ──────────────────────────────────────────────────

/**
 * Generate a Tally Prime-compatible XML import string.
 *
 * @param entries   DerivedEntry[] from deriveLedger() + manual journals converted to DerivedEntry
 * @param accounts  Chart of Accounts rows (code, name, accountType)
 * @param business  Business metadata (name used in comments)
 * @returns         UTF-8 XML string ready for Tally import
 */
export function generateTallyXml(
  entries: DerivedEntry[],
  accounts: TallyAccount[],
  business: TallyBusiness,
): string {
  const ledgerMessages = accounts.map(buildLedgerMessage).join("\n");
  const voucherMessages = entries.map(buildVoucherMessage).join("\n");

  // Combine: ledger masters first (All Masters report), then vouchers
  const requestData = [ledgerMessages, voucherMessages]
    .filter(Boolean)
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<!-- Tally Prime export for ${escapeXml(business.name)} -->`,
    "<ENVELOPE>",
    "  <HEADER>",
    "    <TALLYREQUEST>Import Data</TALLYREQUEST>",
    "  </HEADER>",
    "  <BODY>",
    "    <IMPORTDATA>",
    "      <REQUESTDESC>",
    "        <REPORTNAME>All Masters</REPORTNAME>",
    "      </REQUESTDESC>",
    "      <REQUESTDATA>",
    requestData,
    "      </REQUESTDATA>",
    "    </IMPORTDATA>",
    "  </BODY>",
    "</ENVELOPE>",
  ].join("\n");
}
