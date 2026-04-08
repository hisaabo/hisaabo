/**
 * bank-reconciliation.ts — Matching algorithm for bank statement reconciliation.
 *
 * WHY THIS FILE EXISTS:
 * The reconciliation engine needs to correlate bank statement lines (imported CSV)
 * with internal records (payments received, expenses paid, bank transactions).
 * Indian banking uses specific reference formats for UPI, NEFT, RTGS, IMPS, and
 * cheque transactions that we can parse to improve match confidence.
 *
 * Confidence tiers:
 *   1.0 — Exact: amount + same day + reference number matches
 *   0.9 — Strong: amount + within 2 days
 *   0.8 — Narration: UPI VPA / cheque / NEFT ref parsed + amount matches
 *   0.7 — Partial: amount + within 3–7 days
 *   <0.7 — No match
 */

import type { ParsedStatementLine } from "./csv-parser.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Payment {
  id: string;
  amount: string;
  paymentDate: Date;
  referenceNumber?: string | null;
  mode: string;
  partyId?: string | null;
}

export interface Expense {
  id: string;
  amount: string;
  expenseDate: Date;
  referenceNumber?: string | null;
  description?: string | null;
  category?: string | null;
}

export interface BankTransaction {
  id: string;
  amount: string;
  transactionDate: Date;
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
}

export type MatchType = "payment" | "expense" | "bank_transaction";

export interface MatchResult {
  lineNumber: number;
  /** Null = no match found */
  matchedId: string | null;
  matchType: MatchType | null;
  confidence: number;
  /** Human-readable reason for confidence score */
  reason: string;
}

export interface CategorizationRule {
  id: string;
  matchField: "narration" | "reference";
  matchType: "contains" | "starts_with" | "exact" | "regex";
  matchValue: string;
  action: "create_expense" | "ignore" | "tag_party";
  expenseCategory?: string | null;
  partyId?: string | null;
  priority: number;
  isActive: boolean;
}

export interface CategorizationResult {
  action: "create_expense" | "ignore" | "tag_party";
  category?: string;
  partyId?: string;
}

export interface ParsedNarration {
  upiId?: string;
  upiName?: string;
  chequeNumber?: string;
  neftRef?: string;
  impsRef?: string;
  rtgsRef?: string;
}

// ── Narration Parsing ─────────────────────────────────────────────────────────

/**
 * Parse structured references from Indian bank statement narrations.
 *
 * Common formats:
 *   UPI:  UPI/<VPA>/<name>/<txnid>  or  UPI-<txnid>-<VPA>-<name>
 *   NEFT: NEFT/<UTR>/<remitter>  or  NEFT-CMS-<UTR>
 *   IMPS: IMPS/<ref>/<remitter>  or  IMPS-<ref>
 *   CHQ:  CHQ NO 123456  or  CHEQUE NUMBER 123456
 *   RTGS: RTGS/<UTR>/<remitter>
 */
export function parseNarration(narration: string): ParsedNarration {
  const result: ParsedNarration = {};
  const s = narration.trim();

  // UPI VPA: UPI/<VPA>/<name>/<txnid>  or  UPI-<txnid>-<VPA>
  const upiSlash = s.match(/UPI[-/]([^/\s@-]+@[^/\s-]+)[-/]([^/\s-]+)/i);
  if (upiSlash) {
    result.upiId = upiSlash[1]!.toLowerCase();
    result.upiName = upiSlash[2];
  } else {
    // UPI VPA without the standard separator
    const upiAt = s.match(/(?:UPI[/\s-]+)([A-Za-z0-9._]+@[A-Za-z0-9]+)/i);
    if (upiAt) {
      result.upiId = upiAt[1]!.toLowerCase();
    }
  }

  // Cheque number: CHQ NO / CHQ. NO / CHEQUE NO / CQ
  const cheque = s.match(/(?:CHQ(?:UE)?[\s.]*(?:NO|NUMBER)?[\s.:]*|CQ\s*NO\s*)(\d{5,9})/i);
  if (cheque) {
    result.chequeNumber = cheque[1];
  }

  // NEFT UTR: NEFT/<UTR>/...  or  NEFT-CMS-<anything>/<UTR>
  const neft = s.match(/NEFT[-/](?:CMS[-/][^/]+[-/])?([A-Z0-9]{16,22})/i);
  if (neft) {
    result.neftRef = neft[1];
  }

  // IMPS ref
  const imps = s.match(/IMPS[/\s-]+([A-Z0-9]{10,20})/i);
  if (imps) {
    result.impsRef = imps[1];
  }

  // RTGS UTR
  const rtgs = s.match(/RTGS[/\s-]+([A-Z0-9]{16,22})/i);
  if (rtgs) {
    result.rtgsRef = rtgs[1];
  }

  return result;
}

// ── Matching Engine ───────────────────────────────────────────────────────────

const PAISE_TOLERANCE = 1; // 1 paise tolerance for float/rounding artefacts

function toPaise(v: string | number): number {
  return Math.round(parseFloat(String(v)) * 100);
}

function amountsMatch(a: string, b: string): boolean {
  return Math.abs(toPaise(a) - toPaise(b)) <= PAISE_TOLERANCE;
}

function daysDiff(a: Date, b: Date): number {
  return Math.abs((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * Match a set of statement lines against payments, expenses, and bank transactions.
 *
 * Each line is tried in order of confidence tier:
 *   1. Exact: amount + same-day + reference
 *   2. Strong: amount + ≤2 days
 *   3. Narration: parsed UPI/cheque/NEFT ref + amount
 *   4. Partial: amount + ≤7 days
 *
 * Payments are tried for credit lines (money coming in).
 * Expenses are tried for debit lines (money going out).
 * BankTransactions are tried for both.
 */
export function matchStatementLines(
  lines: ParsedStatementLine[],
  payments: Payment[],
  expenses: Expense[],
  bankTransactions: BankTransaction[],
  rules: CategorizationRule[] = [],
): MatchResult[] {
  const usedPayments = new Set<string>();
  const usedExpenses = new Set<string>();
  const usedBankTxns = new Set<string>();

  return lines.map((line) => {
    const isCredit = toPaise(line.credit) > 0;
    const isDebit = toPaise(line.debit) > 0;
    const lineAmount = isCredit ? line.credit : line.debit;
    const lineDate = line.transactionDate;

    // ── Tier 1: Exact match ──────────────────────────────────────────────────
    if (isCredit) {
      for (const p of payments) {
        if (usedPayments.has(p.id)) continue;
        if (!amountsMatch(lineAmount, p.amount)) continue;
        if (daysDiff(lineDate, p.paymentDate) > 0.5) continue; // same day
        if (
          line.referenceNumber &&
          p.referenceNumber &&
          normaliseRef(line.referenceNumber) === normaliseRef(p.referenceNumber)
        ) {
          usedPayments.add(p.id);
          return { lineNumber: line.lineNumber, matchedId: p.id, matchType: "payment", confidence: 1.0, reason: "Exact: amount + date + reference" };
        }
      }
    }

    if (isDebit) {
      for (const e of expenses) {
        if (usedExpenses.has(e.id)) continue;
        if (!amountsMatch(lineAmount, e.amount)) continue;
        if (daysDiff(lineDate, e.expenseDate) > 0.5) continue;
        if (
          line.referenceNumber &&
          e.referenceNumber &&
          normaliseRef(line.referenceNumber) === normaliseRef(e.referenceNumber)
        ) {
          usedExpenses.add(e.id);
          return { lineNumber: line.lineNumber, matchedId: e.id, matchType: "expense", confidence: 1.0, reason: "Exact: amount + date + reference" };
        }
      }
    }

    // Bank transactions (both credit and debit)
    for (const bt of bankTransactions) {
      if (usedBankTxns.has(bt.id)) continue;
      if (!amountsMatch(lineAmount, bt.amount)) continue;
      if (daysDiff(lineDate, bt.transactionDate) > 0.5) continue;
      if (
        line.referenceNumber &&
        bt.description &&
        normaliseRef(line.referenceNumber) === normaliseRef(bt.description)
      ) {
        usedBankTxns.add(bt.id);
        return { lineNumber: line.lineNumber, matchedId: bt.id, matchType: "bank_transaction", confidence: 1.0, reason: "Exact: amount + date + reference" };
      }
    }

    // ── Tier 2: Strong (amount + ≤2 days) ────────────────────────────────────
    if (isCredit) {
      for (const p of payments) {
        if (usedPayments.has(p.id)) continue;
        if (!amountsMatch(lineAmount, p.amount)) continue;
        if (daysDiff(lineDate, p.paymentDate) <= 2) {
          usedPayments.add(p.id);
          return { lineNumber: line.lineNumber, matchedId: p.id, matchType: "payment", confidence: 0.9, reason: "Strong: amount + within 2 days" };
        }
      }
    }

    if (isDebit) {
      for (const e of expenses) {
        if (usedExpenses.has(e.id)) continue;
        if (!amountsMatch(lineAmount, e.amount)) continue;
        if (daysDiff(lineDate, e.expenseDate) <= 2) {
          usedExpenses.add(e.id);
          return { lineNumber: line.lineNumber, matchedId: e.id, matchType: "expense", confidence: 0.9, reason: "Strong: amount + within 2 days" };
        }
      }
    }

    for (const bt of bankTransactions) {
      if (usedBankTxns.has(bt.id)) continue;
      if (!amountsMatch(lineAmount, bt.amount)) continue;
      if (daysDiff(lineDate, bt.transactionDate) <= 2) {
        usedBankTxns.add(bt.id);
        return { lineNumber: line.lineNumber, matchedId: bt.id, matchType: "bank_transaction", confidence: 0.9, reason: "Strong: amount + within 2 days" };
      }
    }

    // ── Tier 3: Narration-based (UPI/cheque/NEFT + amount) ───────────────────
    const parsed = parseNarration(line.narration ?? "");
    const hasNarrationRef = parsed.upiId || parsed.chequeNumber || parsed.neftRef || parsed.impsRef || parsed.rtgsRef;

    if (hasNarrationRef) {
      if (isCredit) {
        for (const p of payments) {
          if (usedPayments.has(p.id)) continue;
          if (!amountsMatch(lineAmount, p.amount)) continue;
          if (narrationMatchesRecord(parsed, p.referenceNumber, undefined)) {
            usedPayments.add(p.id);
            return { lineNumber: line.lineNumber, matchedId: p.id, matchType: "payment", confidence: 0.8, reason: "Narration: parsed reference + amount" };
          }
        }
      }

      if (isDebit) {
        for (const e of expenses) {
          if (usedExpenses.has(e.id)) continue;
          if (!amountsMatch(lineAmount, e.amount)) continue;
          if (narrationMatchesRecord(parsed, e.referenceNumber, e.description)) {
            usedExpenses.add(e.id);
            return { lineNumber: line.lineNumber, matchedId: e.id, matchType: "expense", confidence: 0.8, reason: "Narration: parsed reference + amount" };
          }
        }
      }
    }

    // ── Tier 4: Partial (amount + ≤7 days) ───────────────────────────────────
    if (isCredit) {
      for (const p of payments) {
        if (usedPayments.has(p.id)) continue;
        if (!amountsMatch(lineAmount, p.amount)) continue;
        if (daysDiff(lineDate, p.paymentDate) <= 7) {
          usedPayments.add(p.id);
          return { lineNumber: line.lineNumber, matchedId: p.id, matchType: "payment", confidence: 0.7, reason: "Partial: amount + within 7 days" };
        }
      }
    }

    if (isDebit) {
      for (const e of expenses) {
        if (usedExpenses.has(e.id)) continue;
        if (!amountsMatch(lineAmount, e.amount)) continue;
        if (daysDiff(lineDate, e.expenseDate) <= 7) {
          usedExpenses.add(e.id);
          return { lineNumber: line.lineNumber, matchedId: e.id, matchType: "expense", confidence: 0.7, reason: "Partial: amount + within 7 days" };
        }
      }
    }

    // ── No match: apply categorization rules ─────────────────────────────────
    const ruleResult = applyCategorizationRules(
      line.narration ?? "",
      line.referenceNumber ?? "",
      rules,
    );

    return {
      lineNumber: line.lineNumber,
      matchedId: null,
      matchType: null,
      confidence: 0,
      reason: ruleResult ? `Rule: ${ruleResult.action}` : "Unmatched",
    };
  });
}

// ── Categorization Rules ──────────────────────────────────────────────────────

/**
 * Apply categorization rules to an unmatched statement line.
 * Rules are sorted by priority (higher priority first).
 * Returns the first matching rule's action, or null if none match.
 */
export function applyCategorizationRules(
  narration: string,
  reference: string,
  rules: CategorizationRule[],
): CategorizationResult | null {
  const sorted = [...rules]
    .filter((r) => r.isActive)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of sorted) {
    const target = rule.matchField === "narration" ? narration : reference;
    if (matchesRule(target, rule.matchType, rule.matchValue)) {
      return {
        action: rule.action,
        category: rule.expenseCategory ?? undefined,
        partyId: rule.partyId ?? undefined,
      };
    }
  }

  return null;
}

function matchesRule(
  target: string,
  matchType: "contains" | "starts_with" | "exact" | "regex",
  matchValue: string,
): boolean {
  const t = target.toLowerCase();
  const v = matchValue.toLowerCase();

  switch (matchType) {
    case "contains":
      return t.includes(v);
    case "starts_with":
      return t.startsWith(v);
    case "exact":
      return t === v;
    case "regex": {
      try {
        return new RegExp(matchValue, "i").test(target);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseRef(ref: string): string {
  return ref.trim().toUpperCase().replace(/\s+/g, "");
}

function narrationMatchesRecord(
  parsed: ParsedNarration,
  referenceNumber: string | null | undefined,
  description: string | null | undefined,
): boolean {
  if (!referenceNumber && !description) return false;

  const haystack = [referenceNumber, description]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  if (parsed.chequeNumber && haystack.includes(parsed.chequeNumber)) return true;
  if (parsed.neftRef && haystack.includes(parsed.neftRef)) return true;
  if (parsed.impsRef && haystack.includes(parsed.impsRef)) return true;
  if (parsed.rtgsRef && haystack.includes(parsed.rtgsRef)) return true;
  if (parsed.upiId) {
    const upiUpper = parsed.upiId.toUpperCase();
    if (haystack.includes(upiUpper)) return true;
  }

  return false;
}
