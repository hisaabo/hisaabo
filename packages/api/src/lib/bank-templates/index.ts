/**
 * index.ts — Bank template registry and seed function.
 *
 * WHY THIS FILE EXISTS:
 * Centralises all bank template definitions and provides the idempotent seed
 * function called lazily on first bank statement upload for a business.
 * Using a lazy seed rather than a global migration means new templates added
 * in code are seeded on next upload, with no migration required.
 */

import { bankStatementTemplates } from "@hisaabo/db";
import { and, eq } from "drizzle-orm";

import { SBI_TEMPLATES } from "./banks/sbi.js";
import { HDFC_TEMPLATES } from "./banks/hdfc.js";
import { ICICI_TEMPLATES } from "./banks/icici.js";
import { AXIS_TEMPLATES } from "./banks/axis.js";
import { KOTAK_TEMPLATES } from "./banks/kotak.js";
import { PNB_TEMPLATES } from "./banks/pnb.js";
import { BOB_TEMPLATES } from "./banks/bob.js";
import { UNION_TEMPLATES } from "./banks/union.js";
import { IDBI_TEMPLATES } from "./banks/idbi.js";
import { INDUSIND_TEMPLATES } from "./banks/indusind.js";

export { type BankTemplateDefinition } from "./types.js";
export { preprocessRows } from "./preprocess.js";
export { detectBankTemplate, type DetectionResult, type DetectionWarning } from "./detect.js";

/**
 * All built-in bank templates in registry order.
 * Add new bank arrays here to include them in seeding.
 */
export const ALL_BANK_TEMPLATES = [
  ...SBI_TEMPLATES,
  ...HDFC_TEMPLATES,
  ...ICICI_TEMPLATES,
  ...AXIS_TEMPLATES,
  ...KOTAK_TEMPLATES,
  ...PNB_TEMPLATES,
  ...BOB_TEMPLATES,
  ...UNION_TEMPLATES,
  ...IDBI_TEMPLATES,
  ...INDUSIND_TEMPLATES,
];

/**
 * Seed built-in bank templates for a business.
 * Idempotent: skips templates that already exist (matched by bankSlug + version + fileFormat).
 * Call this lazily on first bank statement upload so new templates added in code
 * are available on next upload without a separate migration step.
 */
export async function seedBankTemplates(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, // Drizzle transaction or db instance
  businessId: string,
): Promise<void> {
  // Load existing seeded templates for this business in one query
  const existing: Array<{ bankSlug: string; version: number; fileFormat: string }> = await tx
    .select({
      bankSlug: bankStatementTemplates.bankSlug,
      version: bankStatementTemplates.version,
      fileFormat: bankStatementTemplates.fileFormat,
    })
    .from(bankStatementTemplates)
    .where(
      and(
        eq(bankStatementTemplates.businessId, businessId),
        eq(bankStatementTemplates.isSeeded, true),
      ),
    );

  // Build a set of already-seeded keys
  const seededKeys = new Set(
    existing.map((t) => `${t.bankSlug}:${t.version}:${t.fileFormat}`),
  );

  // Collect templates that need inserting
  const toInsert = ALL_BANK_TEMPLATES.filter(
    (t) => !seededKeys.has(`${t.bankSlug}:${t.version}:${t.fileFormat}`),
  );

  if (toInsert.length === 0) return;

  await tx.insert(bankStatementTemplates).values(
    toInsert.map((t) => ({
      businessId,
      bankSlug: t.bankSlug,
      bankDisplayName: t.bankDisplayName,
      version: t.version,
      label: t.versionNote ?? null,
      isSeeded: true,
      forkedFromId: null,
      columnMapping: t.columnMapping,
      preprocessRules: Object.keys(t.preprocessRules).length > 0 ? t.preprocessRules : null,
      detectionRules: Object.keys(t.detectionRules).length > 0 ? t.detectionRules : null,
      fileFormat: t.fileFormat,
      isActive: true,
    })),
  );
}
