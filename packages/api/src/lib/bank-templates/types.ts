/**
 * types.ts — Static bank template definition type.
 *
 * WHY THIS FILE EXISTS:
 * Bank templates live as code-defined constants that are seeded into the DB
 * per business. This type describes the shape of a static template definition
 * before it is persisted, keeping the registry and DB schema in sync.
 */

/**
 * Static template definition — lives in code, seeded into DB per business.
 */
export interface BankTemplateDefinition {
  bankSlug: string;
  bankDisplayName: string;
  version: number;
  versionNote?: string;
  columnMapping: {
    date: number;
    narration: number;
    debit?: number;
    credit?: number;
    amount?: number;
    type?: number;
    reference?: number;
    balance?: number;
    dateFormat: string;
    skipRows: number;
    amountSignConvention?: "debit_positive" | "credit_positive";
  };
  preprocessRules: {
    extraHeaderRows?: number;
    skipRowPatterns?: string[];
    amountParsingMode?: "standard" | "dr_cr_suffix" | "parentheses_negative" | "signed";
    skipSubtotalRows?: boolean;
    encoding?: string;
  };
  detectionRules: {
    headerPatterns?: string[];
    columnCount?: { min: number; max: number };
    firstRowPatterns?: string[];
    ifscPrefix?: string;
  };
  fileFormat: "csv" | "xlsx" | "pdf";
}
