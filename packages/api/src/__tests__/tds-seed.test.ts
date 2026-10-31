import { describe, expect, it, vi } from "vitest";
import { TDS_TAX_CODES } from "@hisaabo/shared";
import { seedTdsSections } from "../lib/tds-seed.js";

describe("seedTdsSections", () => {
  it("seeds current statutory TDS sections idempotently", async () => {
    const insertedValues: any[] = [];
    const mockTx = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((vals) => {
          insertedValues.push(...vals);
          return {
            onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
          };
        }),
      }),
    };

    const businessId = "00000000-0000-0000-0000-000000000001";
    await seedTdsSections(mockTx, businessId);

    const currentTaxCodes = TDS_TAX_CODES.filter((c) => c.status === "current");
    expect(insertedValues.length).toBe(currentTaxCodes.length);
    expect(insertedValues.length).toBeGreaterThan(0);

    // Verify all rows belong to the requested business
    expect(insertedValues.every((row) => row.businessId === businessId)).toBe(true);
    expect(insertedValues.every((row) => row.status === "active")).toBe(true);
    expect(insertedValues.every((row) => row.version === 1)).toBe(true);

    // Verify section code and label match the registry
    const code1001 = insertedValues.find((row) => row.sectionCode === "1001");
    expect(code1001).toBeDefined();
    expect(code1001.sectionLabel).toBe("Payment to government employees other than union government employees");
  });
});
