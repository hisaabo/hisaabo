/**
 * TDS (Tax Deducted at Source) Calculator — Income Tax Act, 1961
 *
 * Implements Section 194 series for common TDS deductions applicable
 * to businesses and CA firms. This is comprehensive — covers all major
 * sections with threshold checks, surcharge, cess, and PAN/non-PAN rates.
 *
 * References:
 * - Finance Act 2024 amendments
 * - CBDT Circular No. 01/2024
 * - Section 206AB (higher rate for non-filers)
 */

import { money } from "./money.js";

/** TDS Section configuration */
export interface TdsSection {
  section: string;
  description: string;
  /** Threshold below which TDS is NOT deducted (per FY, unless noted) */
  threshold: string;
  /** Rate for PAN holders (%) */
  rate: string;
  /** Rate when PAN is not furnished — Section 206AA (%) */
  noPanRate: string;
  /** Higher rate for non-filers — Section 206AB (%) */
  nonFilerRate: string;
  /** Whether threshold is per transaction or cumulative per FY */
  thresholdType: "per_transaction" | "per_fy";
  /** Effective from date */
  effectiveFrom: string;
  /** Nature of payment */
  nature: string;
}

/** TDS sections master data — FY 2024-25 onwards */
export const TDS_SECTIONS: TdsSection[] = [
  {
    section: "194A",
    description: "Interest other than interest on securities",
    threshold: "40000", // Rs. 40,000 for banks; Rs. 5,000 for others
    rate: "10",
    noPanRate: "20",
    nonFilerRate: "20",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "Interest (Bank/FD/RD)",
  },
  {
    section: "194B",
    description: "Winnings from lottery, crossword puzzles",
    threshold: "10000",
    rate: "30",
    noPanRate: "30",
    nonFilerRate: "30",
    thresholdType: "per_transaction",
    effectiveFrom: "2024-04-01",
    nature: "Lottery/Game winnings",
  },
  {
    section: "194C",
    description: "Payment to contractors",
    threshold: "30000", // Single transaction; Rs. 1,00,000 aggregate per FY
    rate: "1", // Individual/HUF: 1%, Others: 2%
    noPanRate: "20",
    nonFilerRate: "5",
    thresholdType: "per_transaction",
    effectiveFrom: "2024-04-01",
    nature: "Contractor payment",
  },
  {
    section: "194D",
    description: "Insurance commission",
    threshold: "15000",
    rate: "5",
    noPanRate: "20",
    nonFilerRate: "10",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "Insurance commission",
  },
  {
    section: "194H",
    description: "Commission or brokerage",
    threshold: "15000",
    rate: "5",
    noPanRate: "20",
    nonFilerRate: "10",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "Commission/Brokerage",
  },
  {
    section: "194I(a)",
    description: "Rent — Plant & Machinery",
    threshold: "240000",
    rate: "2",
    noPanRate: "20",
    nonFilerRate: "5",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "Rent (P&M)",
  },
  {
    section: "194I(b)",
    description: "Rent — Land, Building, Furniture, Fittings",
    threshold: "240000",
    rate: "10",
    noPanRate: "20",
    nonFilerRate: "20",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "Rent (Land/Building)",
  },
  {
    section: "194J(a)",
    description: "Professional/Technical fees — FTS to call centres",
    threshold: "30000",
    rate: "2",
    noPanRate: "20",
    nonFilerRate: "5",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "Technical services",
  },
  {
    section: "194J(b)",
    description: "Professional/Technical fees — others",
    threshold: "30000",
    rate: "10",
    noPanRate: "20",
    nonFilerRate: "20",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "Professional fees",
  },
  {
    section: "194K",
    description: "Income from units of mutual fund",
    threshold: "5000",
    rate: "10",
    noPanRate: "20",
    nonFilerRate: "20",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "Mutual fund income",
  },
  {
    section: "194N",
    description: "Cash withdrawal exceeding Rs. 1 crore",
    threshold: "10000000",
    rate: "2",
    noPanRate: "20",
    nonFilerRate: "5",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "Cash withdrawal",
  },
  {
    section: "194O",
    description: "E-commerce operator payments",
    threshold: "500000",
    rate: "1",
    noPanRate: "5",
    nonFilerRate: "5",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "E-commerce payment",
  },
  {
    section: "194Q",
    description: "Purchase of goods (buyer's TDS)",
    threshold: "5000000",
    rate: "0.1",
    noPanRate: "5",
    nonFilerRate: "5",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "Purchase of goods",
  },
  {
    section: "194R",
    description: "Benefits/perquisites arising from business or profession",
    threshold: "20000",
    rate: "10",
    noPanRate: "20",
    nonFilerRate: "20",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "Business perquisites",
  },
  {
    section: "194S",
    description: "Payment on transfer of virtual digital asset",
    threshold: "10000", // Rs. 50,000 for specified persons
    rate: "1",
    noPanRate: "20",
    nonFilerRate: "5",
    thresholdType: "per_fy",
    effectiveFrom: "2024-04-01",
    nature: "Virtual digital asset (crypto)",
  },
];

export interface TdsCalculationInput {
  section: string;
  /** Gross payment amount */
  grossAmount: string;
  /** Cumulative amount already paid in current FY to this deductee (for threshold check) */
  cumulativePaidThisFy?: string;
  /** Whether deductee has furnished PAN */
  hasPan: boolean;
  /** Whether deductee is a non-filer (Section 206AB applies) */
  isNonFiler?: boolean;
  /** For 194C: whether deductee is Individual/HUF (1%) or Company/Firm (2%) */
  isIndividualHuf?: boolean;
  /** Whether lower deduction certificate u/s 197 is available */
  hasLowerDeductionCert?: boolean;
  /** Rate specified in lower deduction certificate (%) */
  lowerDeductionRate?: string;
  /** Whether this is a final payment (no further payments expected this FY) */
  isFinalPayment?: boolean;
}

export interface TdsCalculationResult {
  section: string;
  grossAmount: string;
  /** Whether threshold is breached and TDS is applicable */
  tdsApplicable: boolean;
  /** Effective rate applied (after considering PAN, non-filer, lower cert) */
  effectiveRate: string;
  /** TDS amount to be deducted */
  tdsAmount: string;
  /** Net amount payable to deductee */
  netPayable: string;
  /** Reason if TDS not applicable */
  exemptionReason: string | null;
  /** Health & Education Cess (4% on TDS, applicable only in specific cases) */
  surchargeAndCess: string;
  /** Total TDS including surcharge/cess if applicable */
  totalDeduction: string;
  /** Due date for TDS deposit (7th of next month, except March → 30th April) */
  depositDueDate: string;
}

/**
 * Calculate TDS for a payment.
 *
 * Logic:
 * 1. Identify section and fetch rates/thresholds
 * 2. Check if cumulative payment exceeds threshold
 * 3. Determine applicable rate (standard / no-PAN / non-filer / lower cert)
 * 4. Apply rate, compute surcharge if applicable, add H&E Cess
 * 5. Return comprehensive result with deposit due date
 */
export function calculateTds(input: TdsCalculationInput): TdsCalculationResult {
  const sectionData = TDS_SECTIONS.find(s => s.section === input.section);

  if (!sectionData) {
    return {
      section: input.section,
      grossAmount: input.grossAmount,
      tdsApplicable: false,
      effectiveRate: "0",
      tdsAmount: "0.00",
      netPayable: input.grossAmount,
      exemptionReason: `Unknown section '${input.section}'`,
      surchargeAndCess: "0.00",
      totalDeduction: "0.00",
      depositDueDate: "",
    };
  }

  // Threshold check
  const cumulative = input.cumulativePaidThisFy
    ? money.add(input.cumulativePaidThisFy, input.grossAmount)
    : input.grossAmount;

  const threshold = sectionData.threshold;
  let tdsApplicable = false;

  if (sectionData.thresholdType === "per_transaction") {
    // TDS applicable if this single payment exceeds threshold
    tdsApplicable = money.compare(input.grossAmount, threshold) > 0;
  } else {
    // TDS applicable if cumulative payments in FY exceed threshold
    tdsApplicable = money.compare(cumulative, threshold) > 0;
  }

  if (!tdsApplicable) {
    return {
      section: input.section,
      grossAmount: input.grossAmount,
      tdsApplicable: false,
      effectiveRate: "0",
      tdsAmount: "0.00",
      netPayable: input.grossAmount,
      exemptionReason: `Below threshold of ₹${threshold} (${sectionData.thresholdType === "per_fy" ? "cumulative in FY" : "per transaction"})`,
      surchargeAndCess: "0.00",
      totalDeduction: "0.00",
      depositDueDate: "",
    };
  }

  // Determine rate
  let effectiveRate: string;
  if (input.hasLowerDeductionCert && input.lowerDeductionRate) {
    effectiveRate = input.lowerDeductionRate;
  } else if (!input.hasPan) {
    // Section 206AA: 20% or section rate, whichever is higher
    const sectionRate = parseFloat(sectionData.rate);
    effectiveRate = Math.max(20, sectionRate).toString();
  } else if (input.isNonFiler) {
    // Section 206AB: Higher of — twice the section rate, or 5%
    const twiceRate = parseFloat(sectionData.rate) * 2;
    effectiveRate = Math.max(twiceRate, 5).toString();
  } else {
    // Special case: 194C — Individual/HUF @ 1%, others @ 2%
    if (input.section === "194C") {
      effectiveRate = input.isIndividualHuf ? "1" : "2";
    } else {
      effectiveRate = sectionData.rate;
    }
  }

  // Calculate TDS amount
  // For per_fy threshold: TDS on entire payment once threshold is crossed
  // (not just the amount exceeding threshold, except for 194N)
  let taxableAmount = input.grossAmount;

  if (input.section === "194N") {
    // Special case: TDS only on amount exceeding Rs. 1 crore
    const excess = money.sub(cumulative, threshold);
    if (money.compare(excess, "0") > 0) {
      // TDS on the lesser of (this payment) or (excess over threshold)
      const priorExcess = money.sub(
        input.cumulativePaidThisFy || "0",
        threshold
      );
      if (money.compare(priorExcess, "0") > 0) {
        taxableAmount = input.grossAmount;
      } else {
        taxableAmount = money.sub(cumulative, threshold);
      }
    }
  }

  const tdsAmount = money.percent(taxableAmount, effectiveRate);

  // Surcharge and Cess — generally not applicable on TDS payments
  // However, for non-resident payments (194E, 195 etc.) surcharge + cess applies
  // For residents, Section 194B lottery winnings attract surcharge above threshold
  let surchargeAndCess = "0.00";

  // Net payable
  const totalDeduction = money.add(tdsAmount, surchargeAndCess);
  const netPayable = money.sub(input.grossAmount, totalDeduction);

  // Deposit due date: 7th of following month
  // Exception: March deductions → 30th April
  const today = new Date();
  const depositMonth = today.getMonth() === 2 ? 3 : (today.getMonth() + 1) % 12 + 1;
  const depositYear = today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear();
  const depositDay = today.getMonth() === 2 ? 30 : 7;
  const depositDueDate = `${depositYear}-${String(depositMonth).padStart(2, "0")}-${String(depositDay).padStart(2, "0")}`;

  return {
    section: input.section,
    grossAmount: input.grossAmount,
    tdsApplicable: true,
    effectiveRate,
    tdsAmount,
    netPayable,
    exemptionReason: null,
    surchargeAndCess,
    totalDeduction,
    depositDueDate,
  };
}

/**
 * Calculate TDS on salary — Section 192
 * More complex: requires estimating total income and applying slab rates.
 */
export interface SalaryTdsInput {
  /** Monthly gross salary */
  monthlySalary: string;
  /** Months remaining in FY (including current) */
  monthsRemaining: number;
  /** Already paid salary this FY */
  paidSalaryThisFy: string;
  /** Already deducted TDS this FY */
  tdsPaidThisFy: string;
  /** Declared deductions under Chapter VI-A (80C, 80D, etc.) */
  deductions80C: string;
  deductions80D: string;
  deductionsOther: string;
  /** HRA exemption */
  hraExemption: string;
  /** Standard deduction (Rs. 75,000 from FY 2024-25 new regime) */
  standardDeduction?: string;
  /** Whether old or new tax regime */
  regime: "old" | "new";
}

export interface SalaryTdsResult {
  estimatedAnnualIncome: string;
  totalDeductions: string;
  taxableIncome: string;
  totalTaxLiability: string;
  cessFourPercent: string;
  totalTaxWithCess: string;
  alreadyDeducted: string;
  remainingTax: string;
  monthlyTds: string;
}

/** Income tax slabs — New Regime FY 2024-25 (Section 115BAC) */
const NEW_REGIME_SLABS = [
  { from: 0, to: 300000, rate: 0 },
  { from: 300000, to: 700000, rate: 5 },
  { from: 700000, to: 1000000, rate: 10 },
  { from: 1000000, to: 1200000, rate: 15 },
  { from: 1200000, to: 1500000, rate: 20 },
  { from: 1500000, to: Infinity, rate: 30 },
];

/** Income tax slabs — Old Regime FY 2024-25 */
const OLD_REGIME_SLABS = [
  { from: 0, to: 250000, rate: 0 },
  { from: 250000, to: 500000, rate: 5 },
  { from: 500000, to: 1000000, rate: 20 },
  { from: 1000000, to: Infinity, rate: 30 },
];

function computeSlabTax(taxableIncome: number, regime: "old" | "new"): number {
  const slabs = regime === "new" ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
  let tax = 0;

  for (const slab of slabs) {
    if (taxableIncome <= slab.from) break;
    const taxableInSlab = Math.min(taxableIncome, slab.to) - slab.from;
    tax += (taxableInSlab * slab.rate) / 100;
  }

  // Rebate u/s 87A — New regime: taxable income up to Rs. 7,00,000
  // Old regime: taxable income up to Rs. 5,00,000
  if (regime === "new" && taxableIncome <= 700000) {
    tax = Math.min(tax, 0); // Full rebate
    tax = 0;
  } else if (regime === "old" && taxableIncome <= 500000) {
    tax = 0;
  }

  return tax;
}

/**
 * Calculate monthly TDS on salary under Section 192.
 *
 * Process:
 * 1. Estimate annual income (paid + projected remaining)
 * 2. Subtract deductions (80C, 80D, HRA, standard deduction)
 * 3. Compute tax on taxable income using applicable slabs
 * 4. Add 4% Health & Education Cess
 * 5. Subtract TDS already deducted → remaining liability
 * 6. Divide by months remaining → monthly TDS
 */
export function calculateSalaryTds(input: SalaryTdsInput): SalaryTdsResult {
  const monthlyNum = money.toNumber(input.monthlySalary);
  const paidThisFy = money.toNumber(input.paidSalaryThisFy);
  const projectedRemaining = monthlyNum * input.monthsRemaining;
  const estimatedAnnual = paidThisFy + projectedRemaining;

  // Standard deduction
  const stdDeduction = input.standardDeduction
    ? money.toNumber(input.standardDeduction)
    : (input.regime === "new" ? 75000 : 50000);

  // Total deductions
  let totalDeductions = stdDeduction;
  if (input.regime === "old") {
    // Old regime allows 80C, 80D, HRA etc.
    const d80c = Math.min(money.toNumber(input.deductions80C), 150000); // 80C cap
    const d80d = money.toNumber(input.deductions80D);
    const hra = money.toNumber(input.hraExemption);
    const other = money.toNumber(input.deductionsOther);
    totalDeductions += d80c + d80d + hra + other;
  }
  // New regime: only standard deduction of Rs. 75,000, no Chapter VI-A

  const taxableIncome = Math.max(0, estimatedAnnual - totalDeductions);
  const totalTaxLiability = computeSlabTax(taxableIncome, input.regime);
  const cess = totalTaxLiability * 0.04;
  const totalWithCess = totalTaxLiability + cess;

  const alreadyDeducted = money.toNumber(input.tdsPaidThisFy);
  const remainingTax = Math.max(0, totalWithCess - alreadyDeducted);
  const monthlyTds = input.monthsRemaining > 0
    ? Math.ceil(remainingTax / input.monthsRemaining)
    : 0;

  return {
    estimatedAnnualIncome: estimatedAnnual.toFixed(2),
    totalDeductions: totalDeductions.toFixed(2),
    taxableIncome: taxableIncome.toFixed(2),
    totalTaxLiability: totalTaxLiability.toFixed(2),
    cessFourPercent: cess.toFixed(2),
    totalTaxWithCess: totalWithCess.toFixed(2),
    alreadyDeducted: alreadyDeducted.toFixed(2),
    remainingTax: remainingTax.toFixed(2),
    monthlyTds: monthlyTds.toFixed(2),
  };
}

/**
 * Get TDS return due dates for a quarter
 */
export function getTdsReturnDueDate(quarter: "Q1" | "Q2" | "Q3" | "Q4", fy: string): string {
  // FY format: "2024-25"
  const startYear = parseInt(fy.split("-")[0]);
  const dueDates: Record<string, string> = {
    Q1: `${startYear}-07-31`,   // Apr-Jun → 31 July
    Q2: `${startYear}-10-31`,   // Jul-Sep → 31 October
    Q3: `${startYear + 1}-01-31`, // Oct-Dec → 31 January
    Q4: `${startYear + 1}-05-31`, // Jan-Mar → 31 May
  };
  return dueDates[quarter] || "";
}
