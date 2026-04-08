/**
 * indusind.ts — IndusInd Bank statement template.
 *
 * IndusInd Bank CSV export format:
 *   Transaction Date, Value Date, Description, Cheque No, Debit, Credit, Balance
 * First rows may contain "IndusInd Bank" header/disclaimer text.
 * IFSC prefix is INDB.
 */

import type { BankTemplateDefinition } from "../types.js";

export const INDUSIND_TEMPLATES: BankTemplateDefinition[] = [
  {
    bankSlug: "indusind",
    bankDisplayName: "IndusInd Bank",
    version: 1,
    versionNote: "Standard IndusInd Bank net banking CSV export",
    columnMapping: {
      // 0: Transaction Date, 1: Value Date, 2: Description, 3: Cheque No,
      // 4: Debit, 5: Credit, 6: Balance
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
        "IndusInd Bank",
        "Account No",
        "Account Name",
        "Account Type",
        "IFSC",
        "Branch",
        "Opening Balance",
        "Closing Balance",
        "CIN",
      ],
      skipSubtotalRows: true,
      amountParsingMode: "standard",
    },
    detectionRules: {
      headerPatterns: ["Transaction Date", "Value Date", "Description", "Cheque No"],
      columnCount: { min: 7, max: 7 },
      firstRowPatterns: ["IndusInd Bank", "INDUSIND"],
      ifscPrefix: "INDB",
    },
    fileFormat: "csv",
  },
];
