/**
 * Overwrites the custom cache-trigger migration SQL files with the output of
 * renderCacheTriggerMigration(). Usage:
 *   tsx scripts/gen-cache-trigger-migration.ts            # rewrite
 * Create the (empty) journal entries first with
 *   drizzle-kit generate --custom --name=cache_invalidation_triggers [--config ...]
 */
import { readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCacheTriggerMigration } from "../src/cache-triggers.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const dir of ["drizzle", "drizzle-control"]) {
  const files = readdirSync(resolve(root, dir)).filter((f) => /^\d{4}_cache_invalidation_triggers\.sql$/.test(f));
  for (const f of files) {
    writeFileSync(resolve(root, dir, f), renderCacheTriggerMigration());
    console.log(`wrote ${dir}/${f}`);
  }
}
