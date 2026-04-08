/**
 * bob.ts — Bank of Baroda statement template.
 *
 * Bank of Baroda CSV export format:
 *   Tran. Date, Value Date, Tran. Particulars, Cheque No., Debit, Credit, Balance
 * IFSC prefix is BARB.
 */

import type { BankTemplateDefinition } from "../types.js";

export const BOB_TEMPLATES: BankTemplateDefinition[] = [
  {
    bankSlug: "bob",
    bankDisplayName: "Bank of Baroda",
    version: 1,
    versionNote: "Standard Bank of Baroda net banking CSV export",
    columnMapping: {
      // 0: Tran. Date, 1: Value Date, 2: Tran. Particulars, 3: Cheque No., 4: Debit, 5: Credit, 6: Balance
      date: 0,
      narration: 2,
      reference: 3,
      debit: 4,
      credit: 5,
      balance: 6,
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
        "Bank of Baroda",
      ],
      skipSubtotalRows: true,
      amountParsingMode: "standard",
    },
    detectionRules: {
      headerPatterns: ["Tran\\. Date", "Tran\\. Particulars", "Cheque No"],
      columnCount: { min: 7, max: 7 },
      ifscPrefix: "BARB",
    },
    fileFormat: "csv",
  },
];
