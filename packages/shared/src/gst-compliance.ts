/**
 * GST Late Fee & Interest Calculator
 *
 * Section 47: Late fee for delayed filing of returns
 * Section 50: Interest on delayed tax payment
 *
 * Implements:
 * - Late fee calculation for GSTR-1, GSTR-3B, GSTR-9
 * - Interest @18% p.a. on output tax paid late (Section 50(1))
 * - Interest @24% p.a. on excess ITC claimed and utilized (Section 50(3))
 * - Due date computation for all return types
 *
 * References:
 * - Notification No. 7/2020-Central Tax (late fee waiver/reduction)
 * - Notification No. 20/2021-Central Tax (revised late fees)
 * - Section 50(1) and 50(3) of CGST Act, 2017
 */

import { money } from "./money.js";

// ═══════════════════════════════════════════════════════════════════
// RETURN DUE DATES
// ═══════════════════════════════════════════════════════════════════

export type GstReturnType = "GSTR-1" | "GSTR-3B" | "GSTR-9" | "GSTR-1_QRMP" | "GSTR-3B_QRMP" | "CMP-08";

export interface GstDueDate {
  returnType: GstReturnType;
  period: string; // "2026-04" for monthly, "2026-Q1" for quarterly
  dueDate: string; // ISO date
  isQuarterly: boolean;
}

/**
 * Get due date for a GST return.
 *
 * GSTR-1 (Monthly): 11th of next month
 * GSTR-1 (QRMP Quarterly): 13th of month after quarter end
 * GSTR-3B (Monthly): 20th of next month (varies by state for some)
 * GSTR-3B (QRMP Quarterly): 22nd/24th of month after quarter
 * GSTR-9 (Annual): 31st December of following FY
 * CMP-08 (Composition quarterly): 18th of month after quarter
 */
export function getGstReturnDueDate(returnType: GstReturnType, period: string): GstDueDate {
  const isQuarterly = returnType.includes("QRMP") || returnType === "GSTR-9" || returnType === "CMP-08";

  let dueDate: string;

  if (returnType === "GSTR-9") {
    // Annual return: period is FY like "2025-26"
    // Due: 31st December of following FY end year
    const fyEndYear = parseInt(period.split("-")[0]) + 1;
    dueDate = `${fyEndYear}-12-31`;
  } else if (returnType === "CMP-08") {
    // Composition quarterly: 18th of month following quarter end
    const quarterEnd = getQuarterEndMonth(period);
    dueDate = getNextMonthDate(quarterEnd, 18);
  } else if (returnType === "GSTR-1") {
    // Monthly: 11th of next month
    dueDate = getNextMonthDate(period, 11);
  } else if (returnType === "GSTR-1_QRMP") {
    // Quarterly: 13th of month following quarter end
    const quarterEnd = getQuarterEndMonth(period);
    dueDate = getNextMonthDate(quarterEnd, 13);
  } else if (returnType === "GSTR-3B") {
    // Monthly: 20th of next month
    dueDate = getNextMonthDate(period, 20);
  } else if (returnType === "GSTR-3B_QRMP") {
    // Quarterly: 22nd of month following quarter end
    const quarterEnd = getQuarterEndMonth(period);
    dueDate = getNextMonthDate(quarterEnd, 22);
  } else {
    dueDate = "";
  }

  return { returnType, period, dueDate, isQuarterly };
}

function getQuarterEndMonth(period: string): string {
  // period format: "2026-Q1" → Apr-Jun → "2026-06"
  const [year, q] = period.split("-");
  const quarterEndMonths: Record<string, string> = {
    Q1: "06", Q2: "09", Q3: "12", Q4: "03",
  };
  const month = quarterEndMonths[q] || "03";
  // Q4 (Jan-Mar) ends in next year's March
  const endYear = q === "Q4" ? String(parseInt(year) + 1) : year;
  return `${endYear}-${month}`;
}

function getNextMonthDate(yearMonth: string, day: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ═══════════════════════════════════════════════════════════════════
// LATE FEE CALCULATION
// ═══════════════════════════════════════════════════════════════════

export interface LateFeeInput {
  returnType: GstReturnType;
  /** Due date of the return */
  dueDate: string;
  /** Actual filing date */
  filingDate: string;
  /** Tax liability in the return (for determining fee category) */
  taxLiability: string;
  /** Annual turnover in preceding FY (for GSTR-9 fee caps) */
  annualTurnover?: string;
}

export interface LateFeeResult {
  daysLate: number;
  /** Late fee under CGST per day */
  cgstPerDay: string;
  /** Late fee under SGST per day */
  sgstPerDay: string;
  /** Total CGST late fee */
  cgstTotal: string;
  /** Total SGST late fee */
  sgstTotal: string;
  /** Grand total late fee */
  total: string;
  /** Whether fee cap has been applied */
  capApplied: boolean;
  /** Maximum cap applicable */
  maxCap: string;
}

/**
 * Calculate GST late filing fee.
 *
 * Current rates (post Notification 20/2021):
 * - NIL return: Rs. 10/day CGST + Rs. 10/day SGST = Rs. 20/day total
 * - Non-NIL return: Rs. 25/day CGST + Rs. 25/day SGST = Rs. 50/day total
 *
 * Maximum caps:
 * - GSTR-1 / GSTR-3B (nil): Rs. 250 CGST + Rs. 250 SGST = Rs. 500
 * - GSTR-1 / GSTR-3B (non-nil): Rs. 2,500 CGST + Rs. 2,500 SGST = Rs. 5,000
 * - GSTR-9 (turnover ≤ 5Cr): Rs. 25/day, max Rs. 10,000 (CGST) + same SGST
 * - GSTR-9 (turnover > 5Cr): Rs. 100/day, max Rs. 25,000 (CGST) + same SGST
 */
export function calculateLateFee(input: LateFeeInput): LateFeeResult {
  const dueDate = new Date(input.dueDate);
  const filingDate = new Date(input.filingDate);
  const daysLate = Math.max(0, Math.floor((filingDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

  if (daysLate === 0) {
    return {
      daysLate: 0,
      cgstPerDay: "0.00", sgstPerDay: "0.00",
      cgstTotal: "0.00", sgstTotal: "0.00",
      total: "0.00", capApplied: false, maxCap: "0.00",
    };
  }

  const isNilReturn = money.isZero(input.taxLiability);
  let perDayCgst: number;
  let maxCapCgst: number;

  if (input.returnType === "GSTR-9") {
    const turnover = money.toNumber(input.annualTurnover || "0");
    if (turnover <= 50000000) { // ≤ 5 Crore
      perDayCgst = 25;
      maxCapCgst = 10000;
    } else {
      perDayCgst = 100;
      maxCapCgst = 25000;
    }
  } else if (input.returnType === "CMP-08") {
    perDayCgst = isNilReturn ? 10 : 25;
    maxCapCgst = isNilReturn ? 250 : 2500;
  } else {
    // GSTR-1, GSTR-3B (monthly or QRMP)
    perDayCgst = isNilReturn ? 10 : 25;
    maxCapCgst = isNilReturn ? 250 : 2500;
  }

  const rawCgst = perDayCgst * daysLate;
  const cgstTotal = Math.min(rawCgst, maxCapCgst);
  const sgstTotal = cgstTotal; // SGST mirrors CGST
  const total = cgstTotal + sgstTotal;

  return {
    daysLate,
    cgstPerDay: perDayCgst.toFixed(2),
    sgstPerDay: perDayCgst.toFixed(2),
    cgstTotal: cgstTotal.toFixed(2),
    sgstTotal: sgstTotal.toFixed(2),
    total: total.toFixed(2),
    capApplied: rawCgst > maxCapCgst,
    maxCap: (maxCapCgst * 2).toFixed(2), // Total cap (CGST + SGST)
  };
}

// ═══════════════════════════════════════════════════════════════════
// INTEREST CALCULATION
// ═══════════════════════════════════════════════════════════════════

export interface InterestInput {
  /** Tax amount on which interest is payable */
  taxAmount: string;
  /** Date from which interest starts (due date of payment) */
  fromDate: string;
  /** Date of actual payment */
  toDate: string;
  /** Type: 'delayed_payment' (18% u/s 50(1)) or 'excess_itc' (24% u/s 50(3)) */
  type: "delayed_payment" | "excess_itc";
}

export interface InterestResult {
  taxAmount: string;
  /** Interest rate applied (18% or 24%) */
  rate: string;
  /** Number of days for interest calculation */
  days: number;
  /** Interest amount */
  interest: string;
  /** Total payable (tax + interest) */
  totalPayable: string;
  /** Section reference */
  section: string;
  /** Calculation formula shown */
  formula: string;
}

/**
 * Calculate interest on delayed GST payment.
 *
 * Section 50(1): 18% p.a. on tax paid after due date
 * Section 50(3): 24% p.a. on excess ITC claimed and utilized
 *
 * Formula: Tax × Rate × Days / 365
 *
 * Post-Circular 115/34/2019-GST:
 * Interest is on NET tax liability (after ITC), not gross liability.
 */
export function calculateInterest(input: InterestInput): InterestResult {
  const fromDate = new Date(input.fromDate);
  const toDate = new Date(input.toDate);
  const days = Math.max(0, Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)));

  const rate = input.type === "delayed_payment" ? 18 : 24;
  const section = input.type === "delayed_payment" ? "50(1)" : "50(3)";

  const taxNum = money.toNumber(input.taxAmount);
  const interest = (taxNum * rate * days) / (100 * 365);
  const roundedInterest = Math.round(interest * 100) / 100;
  const totalPayable = taxNum + roundedInterest;

  const formula = `₹${input.taxAmount} × ${rate}% × ${days}/365 = ₹${roundedInterest.toFixed(2)}`;

  return {
    taxAmount: input.taxAmount,
    rate: rate.toString(),
    days,
    interest: roundedInterest.toFixed(2),
    totalPayable: totalPayable.toFixed(2),
    section,
    formula,
  };
}
