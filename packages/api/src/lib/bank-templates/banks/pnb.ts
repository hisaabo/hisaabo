/**
 * pnb.ts — Punjab National Bank statement template.
 *
 * PNB CSV export format:
 *   Transaction Date, Value Date, Description, Branch, Debit, Credit, Balance
 * Date format is DD-MMM-YYYY (e.g. "01-Jan-2024") — the month is a 3-letter abbreviation.
 * IFSC prefix is PUNB.
 */

import type { BankTemplateDefinition } from "../types.js";

export const PNB_TEMPLATES: BankTemplateDefinition[] = [
  {
    bankSlug: "pnb",
    bankDisplayName: "Punjab National Bank",
    version: 1,
    versionNote: "Standard PNB net banking CSV export",
    columnMapping: {
      // 0: Transaction Date, 1: Value Date, 2: Description, 3: Branch, 4: Debit, 5: Credit, 6: Balance
      date: 0,
      narration: 2,
      debit: 4,
      credit: 5,
      balance: 6,
      dateFormat: "DD-MMM-YYYY",
      skipRows: 1,
    },
    preprocessRules: {
      skipRowPatterns: [
        "Account No",
        "Account Name",
        "Account Type",
        "IFSC Code",
        "Opening Balance",
        "Closing Balance",
        "PNB",
      ],
      skipSubtotalRows: true,
      amountParsingMode: "standard",
    },
    detectionRules: {
      headerPatterns: ["Transaction Date", "Value Date", "Description", "Branch"],
      columnCount: { min: 7, max: 7 },
      ifscPrefix: "PUNB",
    },
    fileFormat: "csv",
  },
];
