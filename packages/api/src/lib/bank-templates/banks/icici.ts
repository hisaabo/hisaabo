/**
 * icici.ts — ICICI Bank statement template.
 *
 * ICICI CSV export format:
 *   S No., Value Date, Transaction Date, Cheque Number, Transaction Remarks,
 *   Withdrawal Amount (INR ), Deposit Amount (INR ), Balance (INR )
 * Has a serial number column (S No.) at position 0.
 * Rows with "No." or numeric serial in first column are data rows.
 * Header row contains "S No." so skipRows: 1.
 */

import type { BankTemplateDefinition } from "../types.js";

export const ICICI_TEMPLATES: BankTemplateDefinition[] = [
  {
    bankSlug: "icici",
    bankDisplayName: "ICICI Bank",
    version: 1,
    versionNote: "Standard ICICI net banking CSV export",
    columnMapping: {
      // 0: S No., 1: Value Date, 2: Transaction Date, 3: Cheque Number,
      // 4: Transaction Remarks, 5: Withdrawal Amount (INR), 6: Deposit Amount (INR), 7: Balance (INR)
      date: 2,
      narration: 4,
      reference: 3,
      debit: 5,
      credit: 6,
      balance: 7,
      dateFormat: "DD/MM/YYYY",
      skipRows: 1,
    },
    preprocessRules: {
      skipRowPatterns: [
        "Legends",
        "CR - Credit",
        "DR - Debit",
        "Account No",
        "Account Name",
        "Account Type",
        "IFSC",
        "Opening Balance",
        "Closing Balance",
      ],
      skipSubtotalRows: true,
      amountParsingMode: "standard",
    },
    detectionRules: {
      headerPatterns: ["S No", "Transaction Remarks", "Withdrawal Amount", "Deposit Amount"],
      columnCount: { min: 8, max: 8 },
      ifscPrefix: "ICIC",
    },
    fileFormat: "csv",
  },
];
