/**
 * TDS section-code registry.
 *
 * The numeric codes and old-to-new relationships are taken from Razorpay's
 * published tax-code reference. Legacy entries are intentionally marked as
 * historicalValidity: "unverified": the reference identifies the predecessor
 * section, but does not establish the complete financial-year validity period.
 */

export const TDS_TAX_CODE_SOURCE =
  "https://razorpay.com/docs/payroll/tax-verifications/tax-codes";

export type TdsTaxCodeStatus = "current" | "legacy";
export type TdsHistoricalValidity = "verified" | "unverified";

export interface TdsTaxCode {
  code: string;
  label: string;
  status: TdsTaxCodeStatus;
  historicalValidity: TdsHistoricalValidity;
  effectiveFrom?: "2026-04-01";
  legacyCodes?: readonly string[];
  source: string;
}

type TdsCodeDefinition = readonly [code: string, label: string, oldCode: string];

const CURRENT_TDS_CODES: readonly TdsCodeDefinition[] = [
  ["1001", "Payment to government employees other than union government employees", "192"],
  ["1002", "Payment of employees other than government employees", "192"],
  ["1004", "Payment of accumulated balance due to an employee", "192A"],
  ["1005", "Commission or brokerage - insurance", "194D"],
  ["1006", "Commission or brokerage - others", "194H"],
  ["1008", "Rent on machinery - specified person", "194I(a)"],
  ["1009", "Rent other than machinery - specified person", "194I(b)"],
  ["1011", "Payment on any consideration (not in kind) under agreement referred to in section 67(14)", "194-IA"],
  ["1012", "Payment of compensation on acquisition of certain immovable property", "194LA"],
  ["1013", "Income in respect of units of a specified mutual fund or units from administrator of specified undertaking or specified company", "194K"],
  ["1014", "Interest from units of a business trust to a resident unit holder", "194LBA"],
  ["1015", "Dividend from units of a business trust to a resident unit holder", "194LBA"],
  ["1016", "Renting income from units of a business trust (REIT) to a resident unit holder", "194LBA"],
  ["1017", "Income in respect of units of an investment fund specified in section 224", "194LBB"],
  ["1018", "Income in respect of an investment in a securitisation trust specified in section 221", "194LBC"],
  ["1019", "Interest on securities", "193"],
  ["1020", "Interest other than on securities - senior citizen", "194A"],
  ["1021", "Interest other than on securities - other than senior citizen", "194A"],
  ["1022", "Interest other than interest on securities", "194A"],
  ["1023", "Contract payment - contractor is individual or HUF", "194C"],
  ["1024", "Contract payment - contractor is other than individual or HUF", "194C"],
  ["1026", "Fees for technical services (not professional), royalty for cinematographic films or call centre operations - specified person", "194J(a)"],
  ["1027", "Fees for professional services or sum referred to in section 26(2)(h) - specified person", "194J(b)"],
  ["1028", "Remuneration, fees or commission to a director of a company - specified person", "194J(b)"],
  ["1029", "Dividends (including on preference shares) declared", "194"],
  ["1030", "Sum under a life insurance policy (including bonus)", "194DA"],
  ["1031", "Sum for purchase of any goods", "194Q"],
  ["1032", "Payment to specified senior citizen", "194P"],
  ["1033", "Benefit or perquisite arising from business or profession of any resident", "194R"],
  ["1035", "Sale of goods or provision of services by e-commerce participant facilitated by e-commerce operator", "194-O"],
  ["1037", "Consideration for transfer of a virtual digital asset (other than individual or HUF)", "194S"],
  ["1058", "Winnings from lottery, crossword puzzle, card game, gambling or betting", "194B"],
  ["1060", "Winnings from online game", "194BA"],
  ["1062", "Winnings from horse race", "194BB"],
  ["1063", "Income to person stocking, distributing, purchasing or selling lottery tickets", "194G"],
  ["1064", "Cash payment by bank/post office/co-operative society - deductee is co-operative society", "194N"],
  ["1065", "Cash payment by bank/post office/co-operative society - deductee is other than co-operative society", "194N"],
  ["1066", "Amount referred to in section 80CCA(2)(a) of the Income-tax Act, 1961", "194EE"],
  ["1067", "Salary, remuneration, commission, bonus or interest to a partner of the firm", "194T"],
];

const legacyCodes = new Map<string, TdsTaxCode>();
for (const [, , oldCode] of CURRENT_TDS_CODES) {
  const code = oldCode.toUpperCase();
  if (!legacyCodes.has(code)) {
    legacyCodes.set(code, {
      code,
      label: `Legacy section ${oldCode}`,
      status: "legacy",
      historicalValidity: "unverified",
      source: TDS_TAX_CODE_SOURCE,
    });
  }
}

const legacyCodesByCurrentCode = new Map<string, string[]>();
for (const [code, , oldCode] of CURRENT_TDS_CODES) {
  const existing = legacyCodesByCurrentCode.get(code) ?? [];
  existing.push(oldCode);
  legacyCodesByCurrentCode.set(code, existing);
}

export const TDS_TAX_CODES: readonly TdsTaxCode[] = [
  ...CURRENT_TDS_CODES.map(([code, label]) => ({
    code,
    label,
    status: "current" as const,
    historicalValidity: "verified" as const,
    effectiveFrom: "2026-04-01" as const,
    legacyCodes: legacyCodesByCurrentCode.get(code),
    source: TDS_TAX_CODE_SOURCE,
  })),
  ...Array.from(legacyCodes.values()),
];

const taxCodesByCode = new Map(TDS_TAX_CODES.map((entry) => [entry.code, entry]));

export function normalizeTdsTaxCode(value: string): string {
  return value.trim().toUpperCase();
}

export function getTdsTaxCode(value: string): TdsTaxCode | undefined {
  return taxCodesByCode.get(normalizeTdsTaxCode(value));
}

export function classifyTdsTaxCode(value: string):
  | { originalCode: string; normalizedCode: string; kind: "current"; entry: TdsTaxCode }
  | { originalCode: string; normalizedCode: string; kind: "legacy-review"; entry: TdsTaxCode }
  | { originalCode: string; normalizedCode: string; kind: "unknown" } {
  const entry = getTdsTaxCode(value);
  const normalizedCode = normalizeTdsTaxCode(value);
  const result = { originalCode: value, normalizedCode };
  if (!entry) return { ...result, kind: "unknown" };
  if (entry.status === "legacy") return { ...result, kind: "legacy-review", entry };
  return { ...result, kind: "current", entry };
}
