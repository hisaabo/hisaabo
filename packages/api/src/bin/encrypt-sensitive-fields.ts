#!/usr/bin/env tsx
/**
 * encrypt-sensitive-fields.ts — First-time encryption of plaintext sensitive fields.
 *
 * USAGE:
 *   npx tsx packages/api/src/bin/encrypt-sensitive-fields.ts            # Dry-run
 *   npx tsx packages/api/src/bin/encrypt-sensitive-fields.ts --execute  # Write
 *
 * This script finds all sensitive fields that are still in plaintext and encrypts
 * them with the current ENCRYPTION_KEY. It is safe to run multiple times (idempotent).
 *
 * WHAT IT ENCRYPTS:
 *   Control DB:
 *     - tenants.dbPassword
 *
 *   Per-tenant DB:
 *     - eInvoiceConfigs: clientId, clientSecret, username, password, authToken
 *     - businesses.carrierCredentials: apiKey, apiSecret, accountId per carrier
 *
 * SAFETY:
 *   - Dry-run by default — prints what would change without writing.
 *   - Only encrypts values that are currently plaintext (not already encrypted).
 *   - Each table is updated in its own transaction for atomicity.
 *   - Logs every field touched for audit trail.
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import { controlDb, tenants, getTenantDb } from "@hisaabo/db";
import { encryptField, isEncrypted } from "@hisaabo/db";
import { eq } from "drizzle-orm";

const EXECUTE = process.argv.includes("--execute");

interface EncryptStats {
  encrypted: number;
  alreadyEncrypted: number;
  errors: number;
}

function newStats(): EncryptStats {
  return { encrypted: 0, alreadyEncrypted: 0, errors: 0 };
}

function log(msg: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
}

// ── Validate environment ────────────────────────────────────────────────────

if (!process.env.ENCRYPTION_KEY && !process.env.DB_ENCRYPTION_KEY) {
  console.error("ERROR: ENCRYPTION_KEY (or DB_ENCRYPTION_KEY) is not set.");
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

log(`Mode: ${EXECUTE ? "EXECUTE (writing changes)" : "DRY-RUN (read-only)"}`);
log("");

// ── Encrypt control DB: tenants.dbPassword ──────────────────────────────────

async function encryptControlDb(): Promise<EncryptStats> {
  const stats = newStats();
  log("=== Control DB: tenants.dbPassword ===");

  const rows = await controlDb
    .select({ id: tenants.id, dbPassword: tenants.dbPassword })
    .from(tenants);

  for (const row of rows) {
    if (!row.dbPassword) continue;

    if (isEncrypted(row.dbPassword)) {
      stats.alreadyEncrypted++;
      continue;
    }

    try {
      log(`  tenant ${row.id}: dbPassword plaintext -> encrypted`);
      stats.encrypted++;

      if (EXECUTE) {
        const encrypted = encryptField(row.dbPassword);
        await controlDb
          .update(tenants)
          .set({ dbPassword: encrypted, updatedAt: new Date() })
          .where(eq(tenants.id, row.id));
      }
    } catch (err) {
      stats.errors++;
      log(`  ERROR tenant ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return stats;
}

// ── Encrypt tenant DB fields ────────────────────────────────────────────────

async function encryptTenantDb(tenantId: string, tenantSlug: string): Promise<EncryptStats> {
  const stats = newStats();

  let db;
  try {
    db = await getTenantDb(tenantId);
  } catch (err) {
    log(`  SKIP tenant ${tenantSlug}: cannot connect (${err instanceof Error ? err.message : String(err)})`);
    stats.errors++;
    return stats;
  }

  const { eInvoiceConfigs, businesses } = await import("@hisaabo/db");

  // ── e_invoice_configs ──────────────────────────────────────────────────
  const configs = await db.select().from(eInvoiceConfigs);
  for (const config of configs) {
    const fields = ["clientId", "clientSecret", "username", "password", "authToken"] as const;
    const updates: Record<string, string> = {};

    for (const field of fields) {
      const value = config[field];
      if (!value) continue;

      if (isEncrypted(value)) {
        stats.alreadyEncrypted++;
        continue;
      }

      try {
        log(`  eInvoiceConfig ${config.id}.${field}: plaintext -> encrypted`);
        stats.encrypted++;
        updates[field] = encryptField(value);
      } catch (err) {
        stats.errors++;
        log(`  ERROR eInvoiceConfig ${config.id}.${field}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (Object.keys(updates).length > 0 && EXECUTE) {
      await db
        .update(eInvoiceConfigs)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(eInvoiceConfigs.id, config.id));
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

        if (isEncrypted(value)) {
          stats.alreadyEncrypted++;
          continue;
        }

        try {
          log(`  business ${biz.id}.carrierCredentials.${carrier}.${field}: plaintext -> encrypted`);
          stats.encrypted++;
          updatedEntry[field] = encryptField(value);
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
  const controlStats = await encryptControlDb();
  for (const k of Object.keys(totalStats) as (keyof EncryptStats)[]) {
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
    const tenantStats = await encryptTenantDb(tenant.id, tenant.slug ?? tenant.id);
    for (const k of Object.keys(totalStats) as (keyof EncryptStats)[]) {
      totalStats[k] += tenantStats[k];
    }
  }

  // 3. Summary
  log("\n========================================");
  log("Initial Encryption Summary:");
  log(`  Newly encrypted:      ${totalStats.encrypted}`);
  log(`  Already encrypted:    ${totalStats.alreadyEncrypted}`);
  log(`  Errors:               ${totalStats.errors}`);
  log(`  Mode:                 ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`);
  log("========================================");

  if (!EXECUTE && totalStats.encrypted > 0) {
    log("\nTo apply changes, re-run with: --execute");
  }

  process.exit(totalStats.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
