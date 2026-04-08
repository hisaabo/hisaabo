/**
 * idbi.ts — IDBI Bank statement template.
 *
 * IDBI Bank CSV export format:
 *   Transaction Date, Value Date, Narration, Cheque No, Debit Amount, Credit Amount, Balance
 * Date format uses DD-MM-YYYY (hyphens, numeric month).
 * IFSC prefix is IBKL.
 */

import type { BankTemplateDefinition } from "../types.js";

export const IDBI_TEMPLATES: BankTemplateDefinition[] = [
  {
    bankSlug: "idbi",
    bankDisplayName: "IDBI Bank",
    version: 1,
    versionNote: "Standard IDBI Bank net banking CSV export",
    columnMapping: {
      // 0: Transaction Date, 1: Value Date, 2: Narration, 3: Cheque No,
      // 4: Debit Amount, 5: Credit Amount, 6: Balance
      date: 0,
      narration: 2,
      reference: 3,
      debit: 4,
      credit: 5,
      balance: 6,
      dateFormat: "DD-MM-YYYY",
      skipRows: 1,
    },
    preprocessRules: {
      skipRowPatterns: [
        "Account No",
        "Account Name",
        "Account Type",
        "IFSC",
        "Branch",
        "Opening Balance",
        "Closing Balance",
        "IDBI",
      ],
      skipSubtotalRows: true,
      amountParsingMode: "standard",
    },
    detectionRules: {
      headerPatterns: ["Transaction Date", "Narration", "Cheque No", "Debit Amount", "Credit Amount"],
      columnCount: { min: 7, max: 7 },
      ifscPrefix: "IBKL",
    },
    fileFormat: "csv",
  },
];
