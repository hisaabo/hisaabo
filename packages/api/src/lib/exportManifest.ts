/**
 * exportManifest.ts — single source of truth for the self-export manifest
 * compatibility fields (`appVersion`, `schemaChecksum`).
 *
 * Both `exportStream.ts` (writer) and `importEngine.ts` (reader) import from
 * here, so the version and schema fingerprint always match between the
 * exporter and the validator running in the same process.
 *
 * APP_VERSION is the build version from `./build-info.js` (HISAABO_VERSION baked
 * into release images, else this package's package.json). It never carries a
 * leading `v`, so it matches the web UI and the image tags' `X.Y.Z` form.
 *
 * SCHEMA_CHECKSUM is a stable hash over the TABLE_REGISTRY — table names and
 * their redacted-field sets. Any schema change that touches the registry
 * (adding a table, changing redacted fields) shifts the hash and the importer
 * will emit a "best-effort" warning for backups taken against the old shape.
 */
import { createHash } from "node:crypto";
import { buildInfo } from "./build-info.js";
import { TABLE_REGISTRY } from "./tableRegistry.js";

// ── App version ───────────────────────────────────────────────────────────────
export const APP_VERSION = buildInfo.version;

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
