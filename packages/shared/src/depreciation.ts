/**
 * Depreciation Calculator — Income Tax Act, 1961 (Section 32)
 * and Companies Act, 2013 (Schedule II)
 *
 * Implements:
 * 1. Written Down Value (WDV) method — mandatory for IT Act
 * 2. Straight Line Method (SLM) — used for Companies Act
 * 3. Block-of-asset concept (IT Act grouping)
 * 4. Additional depreciation (Section 32(1)(iia))
 * 5. Half-year convention (< 180 days usage)
 *
 * References:
 * - IT Act Section 32, Rule 5
 * - Companies Act 2013, Schedule II Part A & C
 * - CBDT Notification for depreciation rates
 */

import { money } from "./money.js";

/** Asset block categories per IT Act with WDV rates */
export interface DepreciationBlock {
  blockId: string;
  description: string;
  /** WDV rate under Income Tax Act (%) */
  itRate: string;
  /** SLM rate under Companies Act Schedule II (%) - useful life based */
  companiesActUsefulLife: number; // years
  /** Whether additional depreciation u/s 32(1)(iia) is available */
  additionalDepAllowed: boolean;
}

export const DEPRECIATION_BLOCKS: DepreciationBlock[] = [
  // Buildings
  { blockId: "BLDG_RES", description: "Building — Residential", itRate: "5", companiesActUsefulLife: 60, additionalDepAllowed: false },
  { blockId: "BLDG_NON_RES", description: "Building — Non-Residential (other than factory)", itRate: "10", companiesActUsefulLife: 30, additionalDepAllowed: false },
  { blockId: "BLDG_TEMP", description: "Building — Temporary structures", itRate: "40", companiesActUsefulLife: 3, additionalDepAllowed: false },

  // Furniture & Fittings
  { blockId: "FURN", description: "Furniture & Fittings", itRate: "10", companiesActUsefulLife: 10, additionalDepAllowed: false },

  // Plant & Machinery
  { blockId: "PM_GENERAL", description: "Plant & Machinery — General", itRate: "15", companiesActUsefulLife: 15, additionalDepAllowed: true },
  { blockId: "PM_MOTOR_CAR", description: "Motor cars (other than used in hiring)", itRate: "15", companiesActUsefulLife: 8, additionalDepAllowed: false },
  { blockId: "PM_MOTOR_HIRE", description: "Motor cars used in hiring business", itRate: "30", companiesActUsefulLife: 6, additionalDepAllowed: true },
  { blockId: "PM_ENERGY", description: "Energy saving devices (specified list)", itRate: "40", companiesActUsefulLife: 5, additionalDepAllowed: true },
  { blockId: "PM_AERO", description: "Aeroplane / Helicopter (non-hiring)", itRate: "40", companiesActUsefulLife: 20, additionalDepAllowed: false },
  { blockId: "PM_COMPUTER", description: "Computers & software", itRate: "40", companiesActUsefulLife: 3, additionalDepAllowed: true },
  { blockId: "PM_BOOKS", description: "Books — annual publications", itRate: "40", companiesActUsefulLife: 2, additionalDepAllowed: false },
  { blockId: "PM_BOOKS_OTHER", description: "Books — other than annual", itRate: "40", companiesActUsefulLife: 5, additionalDepAllowed: false },

  // Intangible Assets (Section 32(1)(ii))
  { blockId: "INTANGIBLE", description: "Intangible — Patents, Copyrights, Trademarks, Licenses, Franchises", itRate: "25", companiesActUsefulLife: 10, additionalDepAllowed: false },
];

export interface DepreciationInput {
  /** Original cost of asset */
  cost: string;
  /** Date of acquisition (for half-year rule) */
  acquisitionDate: string;
  /** Block ID (references DEPRECIATION_BLOCKS) */
  blockId: string;
  /** Opening WDV (if computing for subsequent year) */
  openingWdv?: string;
  /** Method: WDV (IT Act) or SLM (Companies Act) */
  method: "wdv" | "slm";
  /** Financial year start date (e.g., "2024-04-01") */
  fyStartDate: string;
  /** Whether additional depreciation u/s 32(1)(iia) is claimed (20%) */
  claimAdditionalDep?: boolean;
  /** Salvage/residual value (for SLM only, per Companies Act 5% of cost) */
  residualValue?: string;
  /** Whether asset was put to use for less than 180 days in first year */
  usedLessThan180Days?: boolean;
  /** Number of years already depreciated (for SLM schedule) */
  yearsDepreciated?: number;
}

export interface DepreciationResult {
  openingValue: string;
  depreciationRate: string;
  /** Base depreciation for the year */
  baseDepreciation: string;
  /** Additional depreciation u/s 32(1)(iia) if applicable */
  additionalDepreciation: string;
  /** Total depreciation (base + additional) */
  totalDepreciation: string;
  /** Closing WDV / Written-down book value */
  closingValue: string;
  /** Whether half-year rule was applied */
  halfYearApplied: boolean;
  /** Remaining useful life (SLM only) */
  remainingUsefulLife: number | null;
  /** Method used */
  method: "wdv" | "slm";
}

/**
 * Calculate depreciation for an asset.
 *
 * WDV Method (IT Act):
 * - Depreciation = Opening WDV × Rate
 * - If put to use < 180 days → 50% of normal depreciation
 * - Additional depreciation (20% of actual cost) available for P&M used in manufacturing
 *
 * SLM Method (Companies Act):
 * - Depreciation = (Cost - Residual Value) / Useful Life
 * - Residual value = 5% of original cost (as per Schedule II)
 * - If put to use < 180 days → proportionate depreciation
 */
export function calculateDepreciation(input: DepreciationInput): DepreciationResult {
  const block = DEPRECIATION_BLOCKS.find(b => b.blockId === input.blockId);
  if (!block) {
    throw new Error(`Unknown depreciation block: ${input.blockId}`);
  }

  const cost = money.toNumber(input.cost);
  const halfYearApplied = !!input.usedLessThan180Days;

  if (input.method === "wdv") {
    // WDV Method
    const openingWdv = input.openingWdv
      ? money.toNumber(input.openingWdv)
      : cost;
    const rate = parseFloat(block.itRate);

    let baseDep = openingWdv * (rate / 100);

    // Half-year rule: if put to use for less than 180 days, 50% depreciation
    if (halfYearApplied) {
      baseDep = baseDep * 0.5;
    }

    // Round to 2 decimal places
    baseDep = Math.round(baseDep * 100) / 100;

    // Additional depreciation — 20% of actual cost (only in first year)
    let additionalDep = 0;
    if (input.claimAdditionalDep && block.additionalDepAllowed && !input.openingWdv) {
      additionalDep = cost * 0.20;
      if (halfYearApplied) {
        additionalDep = additionalDep * 0.5; // Balance 10% claimed next year
      }
      additionalDep = Math.round(additionalDep * 100) / 100;
    }

    const totalDep = baseDep + additionalDep;
    const closingWdv = Math.max(0, openingWdv - totalDep);

    return {
      openingValue: openingWdv.toFixed(2),
      depreciationRate: block.itRate,
      baseDepreciation: baseDep.toFixed(2),
      additionalDepreciation: additionalDep.toFixed(2),
      totalDepreciation: totalDep.toFixed(2),
      closingValue: closingWdv.toFixed(2),
      halfYearApplied,
      remainingUsefulLife: null,
      method: "wdv",
    };
  }

  // SLM Method (Companies Act)
  const usefulLife = block.companiesActUsefulLife;
  const residualPct = 0.05; // 5% as per Schedule II
  const residualValue = input.residualValue
    ? money.toNumber(input.residualValue)
    : cost * residualPct;

  const depreciableAmount = cost - residualValue;
  let annualDep = depreciableAmount / usefulLife;

  // Half-year proportionate (if < 180 days)
  if (halfYearApplied) {
    // Calculate exact days and pro-rate
    annualDep = annualDep * 0.5;
  }

  annualDep = Math.round(annualDep * 100) / 100;

  const yearsAlready = input.yearsDepreciated || 0;
  const cumulativeDep = annualDep * yearsAlready;
  const openingValue = cost - cumulativeDep;
  const closingValue = Math.max(residualValue, openingValue - annualDep);
  const actualDep = openingValue - closingValue;

  const remainingLife = Math.max(0, usefulLife - yearsAlready - 1);

  return {
    openingValue: openingValue.toFixed(2),
    depreciationRate: ((1 / usefulLife) * 100).toFixed(2),
    baseDepreciation: actualDep.toFixed(2),
    additionalDepreciation: "0.00",
    totalDepreciation: actualDep.toFixed(2),
    closingValue: closingValue.toFixed(2),
    halfYearApplied,
    remainingUsefulLife: remainingLife,
    method: "slm",
  };
}

/**
 * Generate full depreciation schedule for an asset over its useful life.
 */
export function generateDepreciationSchedule(input: DepreciationInput): DepreciationResult[] {
  const block = DEPRECIATION_BLOCKS.find(b => b.blockId === input.blockId);
  if (!block) throw new Error(`Unknown block: ${input.blockId}`);

  const schedule: DepreciationResult[] = [];
  const cost = money.toNumber(input.cost);

  if (input.method === "wdv") {
    let currentWdv = cost;
    const rate = parseFloat(block.itRate);
    // Generate until WDV < 5% of cost or max 40 years
    const minValue = cost * 0.05;
    let year = 0;

    while (currentWdv > minValue && year < 40) {
      const isFirstYear = year === 0;
      const halfYear = isFirstYear && !!input.usedLessThan180Days;

      let dep = currentWdv * (rate / 100);
      if (halfYear) dep *= 0.5;
      dep = Math.round(dep * 100) / 100;

      let addlDep = 0;
      if (isFirstYear && input.claimAdditionalDep && block.additionalDepAllowed) {
        addlDep = cost * 0.20;
        if (halfYear) addlDep *= 0.5;
        addlDep = Math.round(addlDep * 100) / 100;
      }

      const totalDep = dep + addlDep;
      const closing = Math.max(0, currentWdv - totalDep);

      schedule.push({
        openingValue: currentWdv.toFixed(2),
        depreciationRate: block.itRate,
        baseDepreciation: dep.toFixed(2),
        additionalDepreciation: addlDep.toFixed(2),
        totalDepreciation: totalDep.toFixed(2),
        closingValue: closing.toFixed(2),
        halfYearApplied: halfYear,
        remainingUsefulLife: null,
        method: "wdv",
      });

      currentWdv = closing;
      year++;
    }
  } else {
    // SLM schedule
    const usefulLife = block.companiesActUsefulLife;
    for (let y = 0; y < usefulLife; y++) {
      const result = calculateDepreciation({
        ...input,
        yearsDepreciated: y,
        usedLessThan180Days: y === 0 ? input.usedLessThan180Days : false,
      });
      schedule.push(result);
      if (money.toNumber(result.closingValue) <= money.toNumber(input.cost) * 0.05) break;
    }
  }

  return schedule;
}
