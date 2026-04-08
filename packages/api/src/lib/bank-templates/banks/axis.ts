/**
 * axis.ts — Axis Bank statement template.
 *
 * Axis Bank CSV export format:
 *   Tran Date, Chq No, Particulars, Debit, Credit, Balance, Init.Br
 * Date uses DD-MM-YYYY with hyphens.
 * IFSC prefix is UTIB (Axis Bank's IFSC code prefix).
 * May have inline subtotal rows that must be filtered.
 */

import type { BankTemplateDefinition } from "../types.js";

export const AXIS_TEMPLATES: BankTemplateDefinition[] = [
  {
    bankSlug: "axis",
    bankDisplayName: "Axis Bank",
    version: 1,
    versionNote: "Standard Axis Bank net banking CSV export",
    columnMapping: {
      // 0: Tran Date, 1: Chq No, 2: Particulars, 3: Debit, 4: Credit, 5: Balance, 6: Init.Br
      date: 0,
      narration: 2,
      reference: 1,
      debit: 3,
      credit: 4,
      balance: 5,
      dateFormat: "DD-MM-YYYY",
      skipRows: 1,
    },
    preprocessRules: {
      skipRowPatterns: [
        "Account No",
        "Account Name",
        "Account Branch",
        "Account Type",
        "Account Status",
        "Currency",
        "Opening Balance",
        "Closing Balance",
      ],
      skipSubtotalRows: true,
      amountParsingMode: "standard",
    },
    detectionRules: {
      headerPatterns: ["Tran Date", "Particulars", "Init\\.Br|Init Br"],
      columnCount: { min: 6, max: 7 },
      ifscPrefix: "UTIB",
    },
    fileFormat: "csv",
  },
];
