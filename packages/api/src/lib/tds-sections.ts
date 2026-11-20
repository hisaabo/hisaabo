/**
 * tds-sections.ts — server-side helpers behind customer-receipt TDS:
 *   - business-local (IST) effective-date comparison for TDS section configs
 *   - resolving the configured section a receipt may use
 *   - guaranteeing the "TDS Receivable" (1600) account exists before a TDS
 *     receipt is written
 */

import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { chartOfAccounts, tdsSectionConfigs } from "@hisaabo/db";
import { seedTdsSections } from "./tds-seed.js";

/** Hisaabo is an Indian business tool: business-local dates are IST. */
export const BUSINESS_TIME_ZONE = "Asia/Kolkata";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The calendar date (YYYY-MM-DD) an instant falls on in business-local time.
 * Dates are stored as timestamptz instants; the web client sends a date-only
 * receipt (1 Apr) as the browser's local midnight, i.e. 2026-03-31T18:30Z for
 * an IST user. Comparing instants would call that "before 1 Apr"; comparing
 * business-local calendar dates does not.
 */
export function businessLocalDate(instant: Date): string {
  return dayFormatter.format(instant);
}

/** Is the section config effective on the business-local date of `paymentDate`? */
export function isSectionEffectiveOn(
  config: { effectiveFrom: Date; effectiveTo: Date | null },
  paymentDate: Date,
): boolean {
  const day = businessLocalDate(paymentDate);
  if (businessLocalDate(config.effectiveFrom) > day) return false;
  if (config.effectiveTo && businessLocalDate(config.effectiveTo) < day) return false;
  return true;
}

// Drizzle transaction / db handle — the same loose typing seedTdsSections uses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function loadActiveSections(tx: Db, businessId: string, code: string) {
  return (await tx
    .select({
      id: tdsSectionConfigs.id,
      effectiveFrom: tdsSectionConfigs.effectiveFrom,
      effectiveTo: tdsSectionConfigs.effectiveTo,
    })
    .from(tdsSectionConfigs)
    .where(and(
      eq(tdsSectionConfigs.businessId, businessId),
      eq(tdsSectionConfigs.sectionCode, code),
      eq(tdsSectionConfigs.status, "active"),
    ))) as Array<{ id: string; effectiveFrom: Date; effectiveTo: Date | null }>;
}

/**
 * Find an active config for `sectionCode` effective on `paymentDate` (IST).
 * A business that has never had any section rows (created before TDS support,
 * or restored from an older backup) is seeded from the registry on first use —
 * this runs inside a mutation, never a query.
 */
export async function findEffectiveTdsSection(
  tx: Db,
  businessId: string,
  sectionCode: string,
  paymentDate: Date,
): Promise<{ id: string } | undefined> {
  const code = sectionCode.trim().toUpperCase();
  let rows = await loadActiveSections(tx, businessId, code);
  let match = rows.find((row) => isSectionEffectiveOn(row, paymentDate));
  if (match) return match;

  const [anyConfig] = await tx
    .select({ id: tdsSectionConfigs.id })
    .from(tdsSectionConfigs)
    .where(eq(tdsSectionConfigs.businessId, businessId))
    .limit(1);
  if (!anyConfig) {
    await seedTdsSections(tx, businessId);
    rows = await loadActiveSections(tx, businessId, code);
    match = rows.find((row) => isSectionEffectiveOn(row, paymentDate));
  }
  return match;
}

export const TDS_RECEIVABLE_CODE = "1600";
export const TDS_RECEIVABLE_NAME = "TDS Receivable";

/**
 * Make sure the business has a system, active, asset-type "TDS Receivable"
 * (1600) account before a TDS receipt posts into it.
 *
 *  - missing                         → create it (system account)
 *  - system account, deactivated      → reactivate it
 *  - user-created / non-asset account → reject: TDS must never be silently
 *    posted into an account the user repurposed for something else
 *
 * `chart_of_accounts` is unique on (business_id, code), so the insert is
 * `ON CONFLICT DO NOTHING` and the follow-up read decides what to do.
 */
export async function ensureTdsReceivableAccount(tx: Db, businessId: string): Promise<void> {
  await tx
    .insert(chartOfAccounts)
    .values({
      businessId,
      code: TDS_RECEIVABLE_CODE,
      name: TDS_RECEIVABLE_NAME,
      accountType: "asset",
      isSystem: true,
      isActive: true,
    })
    .onConflictDoNothing({ target: [chartOfAccounts.businessId, chartOfAccounts.code] });

  const [account] = await tx
    .select({
      id: chartOfAccounts.id,
      isSystem: chartOfAccounts.isSystem,
      isActive: chartOfAccounts.isActive,
      accountType: chartOfAccounts.accountType,
      name: chartOfAccounts.name,
    })
    .from(chartOfAccounts)
    .where(and(
      eq(chartOfAccounts.businessId, businessId),
      eq(chartOfAccounts.code, TDS_RECEIVABLE_CODE),
    ))
    .limit(1);

  if (!account || !account.isSystem || account.accountType !== "asset") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        `Account code ${TDS_RECEIVABLE_CODE} is already used by "${account?.name ?? "another account"}", ` +
        `which is not the system "${TDS_RECEIVABLE_NAME}" account, so TDS cannot be recorded. ` +
        `Delete that account from the Chart of Accounts (move or void its entries first) and try again.`,
    });
  }

  if (!account.isActive) {
    await tx
      .update(chartOfAccounts)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(chartOfAccounts.id, account.id));
  }
}
