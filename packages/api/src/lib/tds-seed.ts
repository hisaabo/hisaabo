import { tdsSectionConfigs } from "@hisaabo/db";
import { TDS_TAX_CODES } from "@hisaabo/shared";

/**
 * Seed default statutory TDS sections for a business.
 *
 * Uses the statutory registry (TDS_TAX_CODES) to populate current active
 * TDS section configurations for the business with onConflictDoNothing
 * for idempotency.
 */
export async function seedTdsSections(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  businessId: string,
): Promise<void> {
  const currentCodes = TDS_TAX_CODES.filter((entry) => entry.status === "current");
  const values = currentCodes.map((entry) => ({
    businessId,
    sectionCode: entry.code,
    sectionLabel: entry.label,
    effectiveFrom: entry.effectiveFrom
      ? new Date(`${entry.effectiveFrom}T00:00:00.000Z`)
      : new Date("2026-04-01T00:00:00.000Z"),
    effectiveTo: null,
    status: "active",
    version: 1,
  }));

  if (values.length > 0) {
    await tx.insert(tdsSectionConfigs).values(values).onConflictDoNothing();
  }
}
