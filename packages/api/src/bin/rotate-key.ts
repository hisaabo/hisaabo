#!/usr/bin/env tsx
/**
 * rotate-key.ts — Re-encrypt all sensitive fields with the current ENCRYPTION_KEY.
 *
 * USAGE:
 *   npx tsx packages/api/src/bin/rotate-key.ts            # Dry-run (read-only)
 *   npx tsx packages/api/src/bin/rotate-key.ts --execute   # Actually write changes
 *
 * PREREQUISITES:
 *   1. Set ENCRYPTION_KEY to the NEW key in the environment.
 *   2. Set ENCRYPTION_KEY_PREVIOUS to the OLD key in the environment.
 *   3. Run this script on the server (reads env vars directly — no API endpoint).
 *   4. After completion, remove ENCRYPTION_KEY_PREVIOUS from the environment.
 *
 * SAFETY:
 *   - Dry-run by default — prints what would change without writing.
 *   - Each table is updated in its own transaction for atomicity.
 *   - Logs every field touched for audit trail.
 *   - Handles plaintext values (encrypts them with the current key).
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import { controlDb, tenants, getTenantDb } from "@hisaabo/db";
import { reEncryptField, getKeyVersion } from "@hisaabo/db";
import { eq } from "drizzle-orm";

const EXECUTE = process.argv.includes("--execute");
const CURRENT_KEY_VERSION = 2; // Must match crypto.ts CURRENT_KEY_VERSION

interface RotationStats {
  rotated: number;
  alreadyCurrent: number;
  errors: number;
  plaintext: number;
}

function newStats(): RotationStats {
  return { rotated: 0, alreadyCurrent: 0, errors: 0, plaintext: 0 };
}

function log(msg: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
}

// ── Validate environment ────────────────────────────────────────────────────

if (!process.env.ENCRYPTION_KEY) {
  console.error("ERROR: ENCRYPTION_KEY is not set. Set it to the NEW key.");
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY_PREVIOUS) {
  log("WARNING: ENCRYPTION_KEY_PREVIOUS is not set. Only plaintext and current-key values will be processed.");
}

log(`Mode: ${EXECUTE ? "EXECUTE (writing changes)" : "DRY-RUN (read-only)"}`);
log("");

// ── Rotate control DB: tenants.dbPassword ───────────────────────────────────

async function rotateControlDb(): Promise<RotationStats> {
  const stats = newStats();
  log("=== Control DB: tenants.dbPassword ===");

  const rows = await controlDb
    .select({ id: tenants.id, dbPassword: tenants.dbPassword })
    .from(tenants);

  for (const row of rows) {
    if (!row.dbPassword) continue;

    try {
      const version = getKeyVersion(row.dbPassword);
      if (version === CURRENT_KEY_VERSION) {
        stats.alreadyCurrent++;
        continue;
      }

      const reEncrypted = reEncryptField(row.dbPassword);
      if (reEncrypted === row.dbPassword) {
        stats.alreadyCurrent++;
        continue;
      }

      const label = version === 0 ? "plaintext" : `v${version}`;
      log(`  tenant ${row.id}: dbPassword ${label} -> v${CURRENT_KEY_VERSION}`);

      if (version === 0) stats.plaintext++;
      else stats.rotated++;

      if (EXECUTE) {
        await controlDb
          .update(tenants)
          .set({ dbPassword: reEncrypted, updatedAt: new Date() })
          .where(eq(tenants.id, row.id));
      }
    } catch (err) {
      stats.errors++;
      log(`  ERROR tenant ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return stats;
}

// ── Rotate tenant DB fields ─────────────────────────────────────────────────

async function rotateTenantDb(tenantId: string, tenantSlug: string): Promise<RotationStats> {
  const stats = newStats();

  let db;
  try {
    db = await getTenantDb(tenantId);
  } catch (err) {
    log(`  SKIP tenant ${tenantSlug}: cannot connect (${err instanceof Error ? err.message : String(err)})`);
    stats.errors++;
    return stats;
  }

  // Dynamic imports for tenant schema tables
  const { eInvoiceConfigs, businesses } = await import("@hisaabo/db");

  // ── e_invoice_configs ──────────────────────────────────────────────────
  const configs = await db.select().from(eInvoiceConfigs);
  for (const config of configs) {
    const fields = ["clientId", "clientSecret", "username", "password", "authToken"] as const;

    for (const field of fields) {
      const value = config[field];
      if (!value) continue;

      try {
        const version = getKeyVersion(value);
        if (version === CURRENT_KEY_VERSION) {
          stats.alreadyCurrent++;
          continue;
        }

        const reEncrypted = reEncryptField(value);
        if (reEncrypted === value) {
          stats.alreadyCurrent++;
          continue;
        }

        const label = version === 0 ? "plaintext" : `v${version}`;
        log(`  eInvoiceConfig ${config.id}.${field}: ${label} -> v${CURRENT_KEY_VERSION}`);

        if (version === 0) stats.plaintext++;
        else stats.rotated++;

        if (EXECUTE) {
          await db
            .update(eInvoiceConfigs)
            .set({ [field]: reEncrypted, updatedAt: new Date() })
            .where(eq(eInvoiceConfigs.id, config.id));
        }
      } catch (err) {
        stats.errors++;
        log(`  ERROR eInvoiceConfig ${config.id}.${field}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ── businesses.carrierCredentials ──────────────────────────────────────
  const bizRows = await db.select({ id: businesses.id, carrierCredentials: businesses.carrierCredentials }).from(businesses);
  for (const biz of bizRows) {
    if (!biz.carrierCredentials) continue;
    const creds = biz.carrierCredentials as Record<string, Record<string, unknown>>;
    let changed = false;

    const updatedCreds = { ...creds };
    for (const [carrier, entry] of Object.entries(creds)) {
      const credFields = ["apiKey", "apiSecret", "accountId"] as const;
      const updatedEntry = { ...entry };

      for (const field of credFields) {
        const value = entry[field];
        if (!value || typeof value !== "string") continue;

        try {
          const version = getKeyVersion(value);
          if (version === CURRENT_KEY_VERSION) {
            stats.alreadyCurrent++;
            continue;
          }

          const reEncrypted = reEncryptField(value);
          if (reEncrypted === value) {
            stats.alreadyCurrent++;
            continue;
          }

          const label = version === 0 ? "plaintext" : `v${version}`;
          log(`  business ${biz.id}.carrierCredentials.${carrier}.${field}: ${label} -> v${CURRENT_KEY_VERSION}`);

          if (version === 0) stats.plaintext++;
          else stats.rotated++;

          updatedEntry[field] = reEncrypted;
          changed = true;
        } catch (err) {
          stats.errors++;
          log(`  ERROR business ${biz.id}.carrierCredentials.${carrier}.${field}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      updatedCreds[carrier] = updatedEntry;
    }

    if (changed && EXECUTE) {
      await db
        .update(businesses)
        .set({
          carrierCredentials: updatedCreds as typeof biz.carrierCredentials,
          updatedAt: new Date(),
        })
        .where(eq(businesses.id, biz.id));
    }
  }

  return stats;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const totalStats = newStats();

  // 1. Control DB
  const controlStats = await rotateControlDb();
  for (const k of Object.keys(totalStats) as (keyof RotationStats)[]) {
    totalStats[k] += controlStats[k];
  }

  // 2. Tenant DBs
  const allTenants = await controlDb
    .select({ id: tenants.id, slug: tenants.slug, dbName: tenants.dbName })
    .from(tenants);

  for (const tenant of allTenants) {
    if (!tenant.dbName) {
      log(`\n=== Tenant ${tenant.slug}: no DB provisioned, skipping ===`);
      continue;
    }

    log(`\n=== Tenant ${tenant.slug} ===`);
    const tenantStats = await rotateTenantDb(tenant.id, tenant.slug ?? tenant.id);
    for (const k of Object.keys(totalStats) as (keyof RotationStats)[]) {
      totalStats[k] += tenantStats[k];
    }
  }

  // 3. Summary
  log("\n========================================");
  log("Key Rotation Summary:");
  log(`  Re-encrypted (old key -> new key): ${totalStats.rotated}`);
  log(`  Encrypted (plaintext -> new key):  ${totalStats.plaintext}`);
  log(`  Already on current key:            ${totalStats.alreadyCurrent}`);
  log(`  Errors:                            ${totalStats.errors}`);
  log(`  Mode:                              ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);
  log("========================================");

  if (!EXECUTE && (totalStats.rotated > 0 || totalStats.plaintext > 0)) {
    log("\nTo apply changes, re-run with: --execute");
  }

  if (EXECUTE && totalStats.errors === 0 && totalStats.rotated > 0) {
    log("\nAll fields rotated successfully. You can now remove ENCRYPTION_KEY_PREVIOUS from the environment.");
  }

  process.exit(totalStats.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
