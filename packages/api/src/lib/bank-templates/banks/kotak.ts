/**
 * kotak.ts — Kotak Mahindra Bank statement template.
 *
 * Kotak Bank CSV export format:
 *   Sl No., Transaction Date, Value Date, Description, Chq / Ref No., Debit, Credit, Balance
 * Has a serial number column (Sl No.) at position 0.
 * IFSC prefix is KKBK.
 */

import type { BankTemplateDefinition } from "../types.js";

export const KOTAK_TEMPLATES: BankTemplateDefinition[] = [
  {
    bankSlug: "kotak",
    bankDisplayName: "Kotak Mahindra Bank",
    version: 1,
    versionNote: "Standard Kotak Mahindra Bank net banking CSV export",
    columnMapping: {
      // 0: Sl No., 1: Transaction Date, 2: Value Date, 3: Description,
      // 4: Chq / Ref No., 5: Debit, 6: Credit, 7: Balance
      date: 1,
      narration: 3,
      reference: 4,
      debit: 5,
      credit: 6,
      balance: 7,
      dateFormat: "DD/MM/YYYY",
      skipRows: 1,
    },
    preprocessRules: {
      skipRowPatterns: [
        "Account No",
        "Account Name",
        "Account Type",
        "Branch",
        "IFSC",
        "Opening Balance",
        "Closing Balance",
        "Net Balance",
      ],
      skipSubtotalRows: true,
      amountParsingMode: "standard",
    },
    detectionRules: {
      headerPatterns: ["Sl No", "Transaction Date", "Chq.*Ref No", "Value Date"],
      columnCount: { min: 8, max: 8 },
      ifscPrefix: "KKBK",
    },
    fileFormat: "csv",
  },
];
