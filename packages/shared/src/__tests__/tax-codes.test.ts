import { describe, expect, it } from "vitest";
import {
  TDS_TAX_CODES,
  TDS_TAX_CODE_SOURCE,
  classifyTdsTaxCode,
  getTdsTaxCode,
} from "../tax-codes.js";

describe("TDS tax-code registry", () => {
  const expectedMappings: Record<string, readonly string[]> = {
    "1001": ["192"], "1002": ["192"], "1004": ["192A"],
    "1005": ["194D"], "1006": ["194H"], "1008": ["194I(a)"],
    "1009": ["194I(b)"], "1011": ["194-IA"], "1012": ["194LA"],
    "1013": ["194K"], "1014": ["194LBA"], "1015": ["194LBA"],
    "1016": ["194LBA"], "1017": ["194LBB"], "1018": ["194LBC"],
    "1019": ["193"], "1020": ["194A"], "1021": ["194A"],
    "1022": ["194A"], "1023": ["194C"], "1024": ["194C"],
    "1026": ["194J(a)"], "1027": ["194J(b)"], "1028": ["194J(b)"],
    "1029": ["194"], "1030": ["194DA"], "1031": ["194Q"],
    "1032": ["194P"], "1033": ["194R"], "1035": ["194-O"],
    "1037": ["194S"], "1058": ["194B"], "1060": ["194BA"],
    "1062": ["194BB"], "1063": ["194G"], "1064": ["194N"],
    "1065": ["194N"], "1066": ["194EE"], "1067": ["194T"],
  };
  const expectedLabels: Record<string, string> = {
    "1001": "Payment to government employees other than union government employees",
    "1002": "Payment of employees other than government employees",
    "1004": "Payment of accumulated balance due to an employee",
    "1005": "Commission or brokerage - insurance",
    "1006": "Commission or brokerage - others",
    "1008": "Rent on machinery - specified person",
    "1009": "Rent other than machinery - specified person",
    "1011": "Payment on any consideration (not in kind) under agreement referred to in section 67(14)",
    "1012": "Payment of compensation on acquisition of certain immovable property",
    "1013": "Income in respect of units of a specified mutual fund or units from administrator of specified undertaking or specified company",
    "1014": "Interest from units of a business trust to a resident unit holder",
    "1015": "Dividend from units of a business trust to a resident unit holder",
    "1016": "Renting income from units of a business trust (REIT) to a resident unit holder",
    "1017": "Income in respect of units of an investment fund specified in section 224",
    "1018": "Income in respect of an investment in a securitisation trust specified in section 221",
    "1019": "Interest on securities",
    "1020": "Interest other than on securities - senior citizen",
    "1021": "Interest other than on securities - other than senior citizen",
    "1022": "Interest other than interest on securities",
    "1023": "Contract payment - contractor is individual or HUF",
    "1024": "Contract payment - contractor is other than individual or HUF",
    "1026": "Fees for technical services (not professional), royalty for cinematographic films or call centre operations - specified person",
    "1027": "Fees for professional services or sum referred to in section 26(2)(h) - specified person",
    "1028": "Remuneration, fees or commission to a director of a company - specified person",
    "1029": "Dividends (including on preference shares) declared",
    "1030": "Sum under a life insurance policy (including bonus)",
    "1031": "Sum for purchase of any goods",
    "1032": "Payment to specified senior citizen",
    "1033": "Benefit or perquisite arising from business or profession of any resident",
    "1035": "Sale of goods or provision of services by e-commerce participant facilitated by e-commerce operator",
    "1037": "Consideration for transfer of a virtual digital asset (other than individual or HUF)",
    "1058": "Winnings from lottery, crossword puzzle, card game, gambling or betting",
    "1060": "Winnings from online game",
    "1062": "Winnings from horse race",
    "1063": "Income to person stocking, distributing, purchasing or selling lottery tickets",
    "1064": "Cash payment by bank/post office/co-operative society - deductee is co-operative society",
    "1065": "Cash payment by bank/post office/co-operative society - deductee is other than co-operative society",
    "1066": "Amount referred to in section 80CCA(2)(a) of the Income-tax Act, 1961",
    "1067": "Salary, remuneration, commission, bonus or interest to a partner of the firm",
  };

  it("contains the complete current numeric code set documented by Razorpay", () => {
    const current = TDS_TAX_CODES.filter((entry) => entry.status === "current");

    expect(current).toHaveLength(39);
    expect(current.map((entry) => entry.code).sort()).toEqual(Object.keys(expectedMappings).sort());
    for (const entry of current) {
      expect(entry.effectiveFrom).toBe("2026-04-01");
      expect(entry.legacyCodes).toEqual(expectedMappings[entry.code]);
      expect(entry.label).toBe(expectedLabels[entry.code]);
      expect(entry.source).toBe(TDS_TAX_CODE_SOURCE);
      expect(entry.label.length).toBeGreaterThan(0);
    }
    expect(getTdsTaxCode("1068")).toBeUndefined();
  });

  it("retains every mapped legacy identifier without asserting an invented validity period", () => {
    const expectedLegacyCodes = [...new Set(Object.values(expectedMappings).flat().map((code) => code.toUpperCase()))].sort();
    const legacy = TDS_TAX_CODES.filter((entry) => entry.status === "legacy");

    expect(legacy.map((entry) => entry.code).sort()).toEqual(expectedLegacyCodes);
    for (const code of expectedLegacyCodes) {
      expect(getTdsTaxCode(code)).toMatchObject({
        code,
        status: "legacy",
        historicalValidity: "unverified",
        source: TDS_TAX_CODE_SOURCE,
      });
    }
  });

  it("classifies a historical import for review while preserving the original value", () => {
    const result = classifyTdsTaxCode(" 194c ");

    expect(result).toMatchObject({
      originalCode: " 194c ",
      normalizedCode: "194C",
      kind: "legacy-review",
    });
  });

  it("rejects unknown codes without treating TCS codes as TDS", () => {
    expect(classifyTdsTaxCode("9999")).toMatchObject({ kind: "unknown" });
    expect(classifyTdsTaxCode("1068")).toMatchObject({ kind: "unknown" });
  });
});
