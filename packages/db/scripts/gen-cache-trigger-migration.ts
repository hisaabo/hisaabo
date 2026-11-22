/**
 * Overwrites the NEWEST custom cache-trigger migration SQL file in each directory
 * with the output of renderCacheTriggerMigration(). Older ones are history (they
 * were applied as written and must not be edited); the install is idempotent, so
 * every change to expectedCacheTriggers ships as a NEW full re-install migration
 * whose name ends in cache_invalidation_triggers. Usage:
 *   tsx scripts/gen-cache-trigger-migration.ts            # rewrite the newest
 * Create the (empty) journal entries first with
 *   drizzle-kit generate --custom --name=<something>_cache_invalidation_triggers [--config ...]
 */
import { readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCacheTriggerMigration } from "../src/cache-triggers.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const dir of ["drizzle", "drizzle-control"]) {
  const files = readdirSync(resolve(root, dir))
    .filter((f) => /^\d{4}_(?:.+_)?cache_invalidation_triggers\.sql$/.test(f))
    .sort();
  const newest = files[files.length - 1];
  if (newest) {
    writeFileSync(resolve(root, dir, newest), renderCacheTriggerMigration());
    console.log(`wrote ${dir}/${newest}`);
  }
}
