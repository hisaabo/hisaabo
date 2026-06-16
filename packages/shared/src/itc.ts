/**
 * ITC (Input Tax Credit) Utilization Calculator
 *
 * Implements the prescribed order of ITC utilization as per Section 49
 * of CGST Act and Rule 88A of CGST Rules (as amended vide Circular
 * No. 98/17/2019-GST dated 23.04.2019).
 *
 * Prescribed Order (Post Rule 88A amendment):
 * 1. IGST credit → first against IGST liability
 * 2. IGST credit → then against CGST liability (any order with SGST)
 * 3. IGST credit → then against SGST liability
 * 4. CGST credit → against CGST liability, then IGST liability
 * 5. SGST credit → against SGST liability, then IGST liability
 *
 * CGST credit CANNOT be used against SGST liability and vice versa.
 * This is a hard constraint — violating it would be illegal.
 *
 * References:
 * - Section 49(5) of CGST Act
 * - Rule 88A of CGST Rules (inserted vide Notification No. 16/2019)
 * - Circular No. 98/17/2019-GST
 * - Section 16(4): 180-day reversal rule
 */

import { money } from "./money.js";

export interface ItcBalance {
  igst: string;
  cgst: string;
  sgst: string;
}

export interface GstLiability {
  igst: string;
  cgst: string;
  sgst: string;
  cess: string;
}

export interface ItcUtilizationStep {
  step: number;
  description: string;
  creditType: "igst" | "cgst" | "sgst";
  appliedAgainst: "igst" | "cgst" | "sgst";
  amountUtilized: string;
  creditRemaining: string;
  liabilityRemaining: string;
}

export interface ItcUtilizationResult {
  /** Step-by-step utilization log */
  steps: ItcUtilizationStep[];
  /** Remaining credit after full utilization */
  remainingCredit: ItcBalance;
  /** Remaining liability to be paid in cash */
  remainingLiability: GstLiability;
  /** Total cash payment required (after ITC utilization) */
  cashPaymentRequired: {
    igst: string;
    cgst: string;
    sgst: string;
    cess: string;
    total: string;
  };
  /** Total credit utilized */
  totalCreditUtilized: {
    igst: string;
    cgst: string;
    sgst: string;
    total: string;
  };
}

/**
 * Calculate ITC utilization in the prescribed order under Section 49 & Rule 88A.
 *
 * This is the exact logic that must be applied when filing GSTR-3B.
 * Getting this wrong leads to wrong ITC utilization → demand notices from GST dept.
 */
export function calculateItcUtilization(
  availableCredit: ItcBalance,
  liability: GstLiability,
): ItcUtilizationResult {
  // Working copies (mutable)
  let igstCredit = money.toNumber(availableCredit.igst);
  let cgstCredit = money.toNumber(availableCredit.cgst);
  let sgstCredit = money.toNumber(availableCredit.sgst);

  let igstLiab = money.toNumber(liability.igst);
  let cgstLiab = money.toNumber(liability.cgst);
  let sgstLiab = money.toNumber(liability.sgst);
  const cessLiab = money.toNumber(liability.cess); // Cess can only be paid from cess credit or cash

  const steps: ItcUtilizationStep[] = [];
  let stepNum = 0;

  function utilize(
    creditType: "igst" | "cgst" | "sgst",
    againstType: "igst" | "cgst" | "sgst",
    creditAvail: number,
    liabilityAvail: number,
    description: string,
  ): { creditUsed: number; newCredit: number; newLiability: number } {
    if (creditAvail <= 0 || liabilityAvail <= 0) {
      return { creditUsed: 0, newCredit: creditAvail, newLiability: liabilityAvail };
    }

    const utilized = Math.min(creditAvail, liabilityAvail);
    const newCredit = Math.round((creditAvail - utilized) * 100) / 100;
    const newLiability = Math.round((liabilityAvail - utilized) * 100) / 100;

    if (utilized > 0) {
      stepNum++;
      steps.push({
        step: stepNum,
        description,
        creditType,
        appliedAgainst: againstType,
        amountUtilized: utilized.toFixed(2),
        creditRemaining: newCredit.toFixed(2),
        liabilityRemaining: newLiability.toFixed(2),
      });
    }

    return { creditUsed: utilized, newCredit, newLiability };
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 1: IGST Credit → IGST Liability (mandatory first)
  // ═══════════════════════════════════════════════════════════
  {
    const r = utilize("igst", "igst", igstCredit, igstLiab,
      "IGST credit utilized against IGST liability (Section 49(5), first priority)");
    igstCredit = r.newCredit;
    igstLiab = r.newLiability;
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 2: IGST Credit → CGST Liability
  // Per Rule 88A, taxpayer can choose order between CGST and SGST.
  // Common practice: CGST first, then SGST.
  // ═══════════════════════════════════════════════════════════
  {
    const r = utilize("igst", "cgst", igstCredit, cgstLiab,
      "IGST credit utilized against CGST liability (Rule 88A)");
    igstCredit = r.newCredit;
    cgstLiab = r.newLiability;
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 3: IGST Credit → SGST Liability
  // ═══════════════════════════════════════════════════════════
  {
    const r = utilize("igst", "sgst", igstCredit, sgstLiab,
      "IGST credit utilized against SGST liability (Rule 88A)");
    igstCredit = r.newCredit;
    sgstLiab = r.newLiability;
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 4: CGST Credit → CGST Liability (own head first)
  // ═══════════════════════════════════════════════════════════
  {
    const r = utilize("cgst", "cgst", cgstCredit, cgstLiab,
      "CGST credit utilized against CGST liability (Section 49(5)(c))");
    cgstCredit = r.newCredit;
    cgstLiab = r.newLiability;
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 5: CGST Credit → IGST Liability (cross-utilization allowed)
  // CGST credit CANNOT be used against SGST — this is the law.
  // ═══════════════════════════════════════════════════════════
  {
    const r = utilize("cgst", "igst", cgstCredit, igstLiab,
      "CGST credit utilized against IGST liability (Section 49(5)(d) — cross-utilization)");
    cgstCredit = r.newCredit;
    igstLiab = r.newLiability;
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 6: SGST Credit → SGST Liability (own head first)
  // ═══════════════════════════════════════════════════════════
  {
    const r = utilize("sgst", "sgst", sgstCredit, sgstLiab,
      "SGST credit utilized against SGST liability (Section 49(5)(e))");
    sgstCredit = r.newCredit;
    sgstLiab = r.newLiability;
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 7: SGST Credit → IGST Liability (cross-utilization allowed)
  // SGST credit CANNOT be used against CGST — this is the law.
  // ═══════════════════════════════════════════════════════════
  {
    const r = utilize("sgst", "igst", sgstCredit, igstLiab,
      "SGST credit utilized against IGST liability (Section 49(5)(f) — cross-utilization)");
    sgstCredit = r.newCredit;
    igstLiab = r.newLiability;
  }

  // Remaining must be paid in cash via Electronic Cash Ledger
  const cashIgst = igstLiab.toFixed(2);
  const cashCgst = cgstLiab.toFixed(2);
  const cashSgst = sgstLiab.toFixed(2);
  const cashCess = cessLiab.toFixed(2);
  const cashTotal = money.sum([cashIgst, cashCgst, cashSgst, cashCess]);

  const totalIgstUsed = money.sub(availableCredit.igst, igstCredit.toFixed(2));
  const totalCgstUsed = money.sub(availableCredit.cgst, cgstCredit.toFixed(2));
  const totalSgstUsed = money.sub(availableCredit.sgst, sgstCredit.toFixed(2));
  const totalCreditUsed = money.sum([totalIgstUsed, totalCgstUsed, totalSgstUsed]);

  return {
    steps,
    remainingCredit: {
      igst: igstCredit.toFixed(2),
      cgst: cgstCredit.toFixed(2),
      sgst: sgstCredit.toFixed(2),
    },
    remainingLiability: {
      igst: cashIgst,
      cgst: cashCgst,
      sgst: cashSgst,
      cess: cashCess,
    },
    cashPaymentRequired: {
      igst: cashIgst,
      cgst: cashCgst,
      sgst: cashSgst,
      cess: cashCess,
      total: cashTotal,
    },
    totalCreditUtilized: {
      igst: totalIgstUsed,
      cgst: totalCgstUsed,
      sgst: totalSgstUsed,
      total: totalCreditUsed,
    },
  };
}

/**
 * Check if an invoice is within the 180-day ITC claim window.
 * Section 16(4): ITC must be claimed before the earlier of:
 * - 30th November of the following FY, OR
 * - Date of filing annual return (GSTR-9)
 *
 * Section 16(2)(d): Payment within 180 days of invoice date.
 * If not paid → ITC must be reversed.
 */
export interface ItcAgingResult {
  invoiceDate: string;
  daysElapsed: number;
  /** Whether 180-day limit for payment is approaching */
  isNearingExpiry: boolean;
  /** Whether 180-day limit has been breached (ITC must be reversed) */
  mustReverse: boolean;
  /** Days remaining before mandatory reversal */
  daysRemaining: number;
  /** Whether invoice is still within GSTR-3B claim window */
  withinClaimWindow: boolean;
  /** Last date to claim this ITC in GSTR-3B */
  lastClaimDate: string;
}

export function checkItcAging(invoiceDate: string, asOfDate?: string): ItcAgingResult {
  const invDate = new Date(invoiceDate);
  const today = asOfDate ? new Date(asOfDate) : new Date();

  const diffMs = today.getTime() - invDate.getTime();
  const daysElapsed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, 180 - daysElapsed);

  // Section 16(4) claim window: 30th November of following FY
  // FY runs Apr-Mar. Invoice in FY 2024-25 → claim by 30 Nov 2025
  const invMonth = invDate.getMonth(); // 0-indexed
  const invYear = invDate.getFullYear();
  const fyEndYear = invMonth >= 3 ? invYear + 1 : invYear; // Apr onwards → FY ends next year
  const lastClaimDate = `${fyEndYear}-11-30`;

  const claimDeadline = new Date(lastClaimDate);
  const withinClaimWindow = today <= claimDeadline;

  return {
    invoiceDate,
    daysElapsed,
    isNearingExpiry: daysElapsed >= 150 && daysElapsed < 180,
    mustReverse: daysElapsed >= 180,
    daysRemaining,
    withinClaimWindow,
    lastClaimDate,
  };
}

/**
 * Blocked ITC determination — Section 17(5) of CGST Act
 * These categories of ITC can NEVER be claimed, regardless of business use.
 */
export const BLOCKED_ITC_CATEGORIES = [
  { code: "motor_vehicle", description: "Motor vehicles & conveyances (except when used for specified purposes)", section: "17(5)(a)" },
  { code: "food_beverage", description: "Food & beverages, outdoor catering, beauty treatment, health services, cosmetic/plastic surgery", section: "17(5)(b)" },
  { code: "membership", description: "Membership of club, health and fitness centre", section: "17(5)(b)(ii)" },
  { code: "travel_benefits", description: "Travel benefits extended to employees on vacation (LTC/LTA)", section: "17(5)(b)(iii)" },
  { code: "works_contract", description: "Works contract services for construction of immovable property (except P&M)", section: "17(5)(c)" },
  { code: "construction", description: "Goods/services for construction of immovable property on own account", section: "17(5)(d)" },
  { code: "personal", description: "Goods/services received for personal consumption", section: "17(5)(g)" },
  { code: "tax_composition", description: "Tax paid under composition scheme", section: "17(5)(e)" },
  { code: "non_resident", description: "Goods/services received by non-resident taxable person (except import of goods)", section: "17(5)(f)" },
] as const;
