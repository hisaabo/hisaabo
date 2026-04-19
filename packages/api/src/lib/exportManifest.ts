/**
 * exportManifest.ts — single source of truth for the self-export manifest
 * compatibility fields (`appVersion`, `schemaChecksum`).
 *
 * Both `exportStream.ts` (writer) and `importEngine.ts` (reader) import from
 * here, so the version and schema fingerprint always match between the
 * exporter and the validator running in the same process.
 *
 * APP_VERSION is read dynamically from the API package's own package.json at
 * module load. `pnpm release` bumps every package in lockstep, so this
 * reflects the true build version without hand-editing.
 *
 * SCHEMA_CHECKSUM is a stable hash over the TABLE_REGISTRY — table names and
 * their redacted-field sets. Any schema change that touches the registry
 * (adding a table, changing redacted fields) shifts the hash and the importer
 * will emit a "best-effort" warning for backups taken against the old shape.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TABLE_REGISTRY } from "./tableRegistry.js";

// ── App version ───────────────────────────────────────────────────────────────
//
// Walk up from this file to find the api package's package.json. Works in
// both source (tsx) and built (tsup → dist) layouts because we search upward
// rather than assuming a fixed relative path.
function readApiVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/lib → src → packages/api    (source)
  // dist    → packages/api          (built)
  const candidates = [
    resolve(here, "..", "..", "package.json"),
    resolve(here, "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, "utf8");
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      if (pkg.name === "@hisaabo/api" && typeof pkg.version === "string") {
        return pkg.version;
      }
    } catch {
      // try next candidate
    }
  }
  // Last resort so we never crash import/export on an unexpected layout.
  return "0.0.0";
}

export const APP_VERSION = readApiVersion();

// ── Schema checksum ───────────────────────────────────────────────────────────
function computeSchemaChecksum(): string {
  const h = createHash("sha256");
  for (const entry of TABLE_REGISTRY) {
    h.update(entry.tableName);
    h.update([...entry.redactedFields].sort().join(","));
  }
  return `sha256:${h.digest("hex")}`;
}

export const SCHEMA_CHECKSUM = computeSchemaChecksum();

// ── Compatibility result shape ────────────────────────────────────────────────
/**
 * Returned by the importer so the HTTP layer / UI / CLI can surface whether
 * the backup was produced by a compatible version + schema. When either
 * match is `false` the import is attempted on a best-effort basis and
 * warnings are added to the result.
 */
export interface Compatibility {
  appVersionMatch: boolean;
  schemaChecksumMatch: boolean;
  sourceAppVersion: string;
  targetAppVersion: string;
  sourceSchemaChecksum: string;
  targetSchemaChecksum: string;
}
