export * from "./validators.js";
export * from "./money.js";
export { calcLineItem, calcInvoiceTotals } from "./calc.js";
export type { LineItemInput, LineItemResult, InvoiceTotalsInput, InvoiceTotals } from "./calc.js";
export { calculateGatewayCharge } from "./gateway.js";
export type { GatewayChargeConfig, GatewayChargeRate, GatewayChargeResult } from "./gateway.js";

// ── Indian Accounting & Compliance Modules ─────────────────────────────────

// GSTIN Validation (Luhn Mod-36 checksum + state code + PAN structure)
export {
  validateGstin,
  getStateFromGstin,
  determineGstType,
  splitGstComponents,
  validatePan,
  VALID_STATE_CODES,
} from "./gstin.js";
export type { GstinValidationResult } from "./gstin.js";

// TDS Calculator (Section 192, 194 series — full IT Act compliance)
export {
  calculateTds,
  calculateSalaryTds,
  getTdsReturnDueDate,
  TDS_SECTIONS,
} from "./tds.js";
export type { TdsSection, TdsCalculationInput, TdsCalculationResult, SalaryTdsInput, SalaryTdsResult } from "./tds.js";

// Depreciation (WDV + SLM, IT Act Section 32 & Companies Act Schedule II)
export {
  calculateDepreciation,
  generateDepreciationSchedule,
  DEPRECIATION_BLOCKS,
} from "./depreciation.js";
export type { DepreciationBlock, DepreciationInput, DepreciationResult } from "./depreciation.js";

// ITC Utilization (Section 49 + Rule 88A prescribed order)
export {
  calculateItcUtilization,
  checkItcAging,
  BLOCKED_ITC_CATEGORIES,
} from "./itc.js";
export type { ItcBalance, GstLiability, ItcUtilizationStep, ItcUtilizationResult, ItcAgingResult } from "./itc.js";

// Indian Currency Formatting & Number-to-Words
export {
  formatIndianCurrency,
  formatCompactIndian,
  numberToWordsIndian,
  numberToWordsHindi,
} from "./indian-currency.js";

// GST Compliance — Late Fee & Interest (Section 47, 50)
export {
  getGstReturnDueDate,
  calculateLateFee,
  calculateInterest,
} from "./gst-compliance.js";
export type {
  GstReturnType,
  GstDueDate,
  LateFeeInput,
  LateFeeResult,
  InterestInput,
  InterestResult,
} from "./gst-compliance.js";
