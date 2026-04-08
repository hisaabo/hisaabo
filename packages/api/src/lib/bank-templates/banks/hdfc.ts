/**
 * hdfc.ts — HDFC Bank statement template.
 *
 * HDFC CSV export format:
 *   Date, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt., Closing Balance
 * The first rows often contain "HDFC BANK LTD" disclaimer text before the header row.
 * Date format is DD/MM/YY (two-digit year).
 */

import type { BankTemplateDefinition } from "../types.js";

export const HDFC_TEMPLATES: BankTemplateDefinition[] = [
  {
    bankSlug: "hdfc",
    bankDisplayName: "HDFC Bank",
    version: 1,
    versionNote: "Standard HDFC net banking CSV export",
    columnMapping: {
      // 0: Date, 1: Narration, 2: Chq./Ref.No., 3: Value Dt, 4: Withdrawal Amt., 5: Deposit Amt., 6: Closing Balance
      date: 0,
      narration: 1,
      reference: 2,
      debit: 4,
      credit: 5,
      balance: 6,
      dateFormat: "DD/MM/YY",
      skipRows: 1,
    },
    preprocessRules: {
      skipRowPatterns: [
        "HDFC BANK LTD",
        "Regd\\. Office",
        "SEBI",
        "Statement of account",
        "Account No",
        "Customer ID",
        "IFSC Code",
        "MICR Code",
        "Branch",
        "Email",
        "Nomination",
        "^\\s*$",
      ],
      skipSubtotalRows: false,
      amountParsingMode: "standard",
    },
    detectionRules: {
      headerPatterns: ["Narration", "Withdrawal Amt", "Deposit Amt", "Closing Balance"],
      columnCount: { min: 7, max: 7 },
      firstRowPatterns: ["HDFC BANK", "HDFC Bank"],
      ifscPrefix: "HDFC",
    },
    fileFormat: "csv",
  },
];
