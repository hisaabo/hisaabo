import { tdsSectionConfigs } from "@hisaabo/db";
import { TDS_TAX_CODES } from "@hisaabo/shared";

/** Row shape written to / returned from `tds_section_configs`. */
export type TdsSectionConfigRow = typeof tdsSectionConfigs.$inferSelect;

/** Insert shape of a registry-derived default section (no id/timestamps). */
export type TdsSectionConfigInsert = Pick<
  typeof tdsSectionConfigs.$inferInsert,
  "businessId" | "sectionCode" | "sectionLabel" | "effectiveFrom" | "effectiveTo" | "status" | "version"
>;

const REGISTRY_FALLBACK_EFFECTIVE_FROM = "2026-04-01";

/**
 * Registry-derived default TDS sections for a business: every current
 * statutory code, active, version 1. Pure — no I/O — so read-only callers
 * (`tdsSection.list`) can present the defaults without writing anything.
 */
export function defaultTdsSectionRows(businessId: string): TdsSectionConfigInsert[] {
  return TDS_TAX_CODES
    .filter((entry) => entry.status === "current")
    .map((entry) => ({
      businessId,
      sectionCode: entry.code,
      sectionLabel: entry.label,
      effectiveFrom: new Date(`${entry.effectiveFrom ?? REGISTRY_FALLBACK_EFFECTIVE_FROM}T00:00:00.000Z`),
      effectiveTo: null,
      status: "active",
      version: 1,
    }));
}

/**
 * The defaults in the exact shape `tdsSection.list` returns for stored rows.
 * Ids are synthetic (`registry:<code>`) because nothing is persisted; the
 * first TDS receipt (or `business.create`) writes the real rows.
 */
export function defaultTdsSectionConfigs(businessId: string): TdsSectionConfigRow[] {
  return defaultTdsSectionRows(businessId).map((row) => ({
    id: `registry:${row.sectionCode}`,
    businessId: row.businessId,
    sectionCode: row.sectionCode,
    sectionLabel: row.sectionLabel,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo ?? null,
    status: row.status ?? "active",
    version: row.version ?? 1,
    createdAt: row.effectiveFrom,
    updatedAt: row.effectiveFrom,
  }));
}

/**
 * Seed default statutory TDS sections for a business.
 *
 * Uses the statutory registry (TDS_TAX_CODES) to populate current active
 * TDS section configurations for the business with onConflictDoNothing
 * for idempotency. Writes — call only from mutations (business.create, the
 * payment create/update path), never from a query.
 */
export async function seedTdsSections(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  businessId: string,
): Promise<void> {
  const values = defaultTdsSectionRows(businessId);

  if (values.length > 0) {
    await tx.insert(tdsSectionConfigs).values(values).onConflictDoNothing();
  }
}
