/**
 * sbi.ts — State Bank of India bank statement template.
 *
 * SBI CSV export format:
 *   Txn Date, Value Date, Description, Ref No./Cheque No., Debit, Credit, Balance
 * Two header rows; first row is account info, second is column headers.
 * Opening/closing balance summary rows are present and must be skipped.
 */

import type { BankTemplateDefinition } from "../types.js";

export const SBI_TEMPLATES: BankTemplateDefinition[] = [
  {
    bankSlug: "sbi",
    bankDisplayName: "State Bank of India",
    version: 1,
    versionNote: "Standard SBI net banking CSV export",
    columnMapping: {
      // 0: Txn Date, 1: Value Date, 2: Description, 3: Ref No./Cheque No., 4: Debit, 5: Credit, 6: Balance
      date: 0,
      narration: 2,
      reference: 3,
      debit: 4,
      credit: 5,
      balance: 6,
      dateFormat: "DD/MM/YYYY",
      skipRows: 2,
    },
    preprocessRules: {
      extraHeaderRows: 1,
      skipRowPatterns: [
        "Opening Balance",
        "Closing Balance",
        "Account No",
        "Account Name",
        "Nomination",
      ],
      skipSubtotalRows: true,
      amountParsingMode: "standard",
    },
    detectionRules: {
      headerPatterns: ["Txn Date", "Value Date", "Ref No"],
      columnCount: { min: 7, max: 7 },
      ifscPrefix: "SBIN",
    },
    fileFormat: "csv",
  },
];
