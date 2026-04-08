/**
 * union.ts — Union Bank of India statement template.
 *
 * Union Bank of India CSV export format:
 *   Transaction Date, Value Date, Description, Debit, Credit, Balance
 * IFSC prefix is UBIN.
 * Notably simpler — 6 columns with no serial number or branch column.
 */

import type { BankTemplateDefinition } from "../types.js";

export const UNION_TEMPLATES: BankTemplateDefinition[] = [
  {
    bankSlug: "union",
    bankDisplayName: "Union Bank of India",
    version: 1,
    versionNote: "Standard Union Bank of India net banking CSV export",
    columnMapping: {
      // 0: Transaction Date, 1: Value Date, 2: Description, 3: Debit, 4: Credit, 5: Balance
      date: 0,
      narration: 2,
      debit: 3,
      credit: 4,
      balance: 5,
      dateFormat: "DD/MM/YYYY",
      skipRows: 1,
    },
    preprocessRules: {
      skipRowPatterns: [
        "Account No",
        "Account Name",
        "IFSC",
        "Branch",
        "Opening Balance",
        "Closing Balance",
        "Union Bank",
      ],
      skipSubtotalRows: true,
      amountParsingMode: "standard",
    },
    detectionRules: {
      headerPatterns: ["Transaction Date", "Value Date", "Description"],
      columnCount: { min: 6, max: 6 },
      ifscPrefix: "UBIN",
    },
    fileFormat: "csv",
  },
];
