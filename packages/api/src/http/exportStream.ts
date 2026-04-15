/**
 * GET /api/export/:tenantId?token=<signed-token>
 *
 * Streams all tenant data as a gzipped tar archive (NDJSON per table).
 *
 * Paging approach: LIMIT/OFFSET with stable ORDER BY id, 5000 rows per page.
 * This is simpler than postgres.js cursor API through the Drizzle abstraction layer,
 * and is sufficient for typical tenant sizes. For very large tables (>500k rows),
 * the stable ORDER BY id keeps pages deterministic.
 *
 * Logging: export start and completion are written to the structured logger.
 * Tenant audit log is NOT written (this is control-plane activity).
 */

import { createGzip } from "node:zlib";
import { createHash } from "node:crypto";
import { mkdtemp, rm, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import tarStream from "tar-stream";
import { sql, getTableColumns } from "drizzle-orm";
import { controlDb, getTenantDb, tenants, businesses } from "@hisaabo/db";
import { TABLE_REGISTRY } from "@hisaabo/shared/selfExport";
import type { Manifest } from "@hisaabo/shared/selfExport";
import { verifyExportToken } from "../lib/exportToken.js";
import { logger } from "../lib/logger.js";

// App version — keep in sync with root package.json
const APP_VERSION = "0.7.5";

// ── Schema checksum ───────────────────────────────────────────────────────────
// Stable hash of table registry used by the importer to detect schema drift.
// Computed once at module load.
function computeSchemaChecksum(): string {
  const h = createHash("sha256");
  for (const entry of TABLE_REGISTRY) {
    h.update(entry.tableName);
    h.update([...entry.redactedFields].sort().join(","));
  }
  return `sha256:${h.digest("hex")}`;
}

const SCHEMA_CHECKSUM = computeSchemaChecksum();

// ── Snake → camel column map ──────────────────────────────────────────────────
/**
 * Build a map from snake_case SQL column name → camelCase TS property name
 * for a given Drizzle table object. The Drizzle column descriptor exposes
 * `.name` (the SQL column name, snake_case) while the object key in the table
 * is the camelCase TypeScript name.
 *
 * Example: { "business_id": "businessId", "opening_balance": "openingBalance" }
 */
function buildSnakeToCamelMap(drizzleTable: object): Map<string, string> {
  const columns = getTableColumns(drizzleTable as Parameters<typeof getTableColumns>[0]);
  const map = new Map<string, string>();
  for (const [camelKey, colDef] of Object.entries(columns)) {
    // colDef.name is the SQL-level (snake_case) column name
    map.set((colDef as { name: string }).name, camelKey);
  }
  return map;
}

// ── Timestamp normalizer ──────────────────────────────────────────────────────
/**
 * Postgres raw SQL (db.execute) returns timestamp values as plain strings in
 * postgres native format: "2026-04-15 19:42:06.406065+00" or
 * "2026-04-15 19:42:06.406065" (without timezone suffix).
 * These are NOT valid ISO-8601 (missing the 'T' separator and use '+00' instead
 * of 'Z'). Zod's z.string().datetime() rejects them.
 *
 * This regex matches postgres timestamp strings and converts them to ISO-8601.
 * It does NOT match UUID strings, numeric strings, or other values.
 */
const PG_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

function normalizeTimestamp(value: string): string {
  // Postgres native timestamp formats:
  //   "2026-04-15 19:58:10.71393+00"     (timestamptz, UTC)
  //   "2026-04-15 19:58:10.71393+05:30"  (timestamptz, IST)
  //   "2026-04-15 19:58:10.71393"        (timestamp without tz)
  //
  // Step 1: replace the space separator with 'T'
  let iso = value.replace(" ", "T");
  // Step 2: fix short timezone offsets like "+00" or "-05:30 absent colon"
  // The regex matches an offset at the end like "+00" or "+0530" (no colon).
  // We need to ensure the format is "+HH:MM" for Date parsing.
  iso = iso.replace(/([+-]\d{2})(?::?\d{2})?$/, (match, hours, rest) => {
    if (rest === undefined) {
      // "+00" → "+00:00"
      return `${hours}:00`;
    }
    // If it's already "+05:30" or "+0530", normalize
    if (match.includes(":")) return match;
    // "+0530" → "+05:30"
    return `${hours}:${match.slice(-2)}`;
  });
  // Also handle bare "+00" without minutes
  const d = new Date(iso);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }
  // Fallback: return as-is (should not happen for well-formed timestamps)
  return value;
}

// ── Row serializer ────────────────────────────────────────────────────────────
/**
 * Serialize a raw DB row to a JSON string ready for NDJSON output.
 * - Remaps snake_case column keys → camelCase TS keys using the drizzle table map.
 * - Redacted fields (camelCase) → null (checked AFTER key remapping).
 * - Dates → ISO-8601 strings (handles both JS Date objects and postgres string timestamps).
 * - Everything else passes through as-is (Drizzle already returns NUMERIC
 *   columns as strings and booleans as booleans).
 */
function serializeRow(
  row: Record<string, unknown>,
  redactedFields: string[],
  snakeToCamel: Map<string, string>,
): string {
  const out: Record<string, unknown> = {};
  for (const [snakeKey, value] of Object.entries(row)) {
    // Remap to camelCase; fall back to the original key if not found in map
    const camelKey = snakeToCamel.get(snakeKey) ?? snakeKey;
    if (redactedFields.includes(camelKey)) {
      out[camelKey] = null;
    } else if (value instanceof Date) {
      // Should rarely occur with raw db.execute, but handle just in case
      out[camelKey] = value.toISOString();
    } else if (typeof value === "string" && PG_TIMESTAMP_RE.test(value)) {
      // Postgres native timestamp format — convert to ISO-8601
      out[camelKey] = normalizeTimestamp(value);
    } else {
      out[camelKey] = value;
    }
  }
  return JSON.stringify(out);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Validate table name is safe for embedding in SQL (registry values only). */
function assertSafeTableName(name: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe table name: ${name}`);
  }
}

// ── Main export handler ───────────────────────────────────────────────────────
export function registerExportRoute(app: Hono): void {
  app.get("/api/export/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");
    const token = c.req.query("token");
    const startTime = Date.now();

    // ── Token verification ────────────────────────────────────────────────────
    if (!token) {
      return c.json({ error: "Missing token" }, 401);
    }

    const tokenPayload = verifyExportToken(token);
    if (!tokenPayload) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    if (tokenPayload.tenantId !== tenantId) {
      return c.json({ error: "Token tenant mismatch" }, 401);
    }

    // ── Resolve tenant metadata ───────────────────────────────────────────────
    const [tenant] = await controlDb
      .select({ slug: tenants.slug, status: tenants.status })
      .from(tenants)
      .where(sql`${tenants.id} = ${tenantId}`)
      .limit(1);

    if (!tenant || tenant.status !== "active") {
      return c.json({ error: "Organization not found" }, 404);
    }

    const tenantSlug = tenant.slug;
    const exportDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = `hisaabo-${tenantSlug}-${exportDate}.tar.gz`;

    logger.info(
      { tenantId, userId: tokenPayload.userId },
      "[selfExport] Export started",
    );

    // ── Temp directory ────────────────────────────────────────────────────────
    const tmpDir = await mkdtemp(path.join(tmpdir(), "hisaabo-export-"));

    async function cleanup(): Promise<void> {
      await rm(tmpDir, { recursive: true, force: true }).catch((err: unknown) => {
        logger.warn({ err, tmpDir }, "[selfExport] Failed to clean up temp dir");
      });
    }

    // ── Get tenant DB ─────────────────────────────────────────────────────────
    let db: Awaited<ReturnType<typeof getTenantDb>>;
    try {
      db = await getTenantDb(tenantId);
    } catch (err) {
      await cleanup();
      logger.error({ err, tenantId }, "[selfExport] Failed to connect to tenant DB");
      return c.json({ error: "Export failed" }, 500);
    }

    // ── Get business IDs for this tenant ──────────────────────────────────────
    const bizRows = await db.select({ id: businesses.id }).from(businesses);
    const businessIds = bizRows.map((b) => b.id);

    // ── Page through each table and write NDJSON files ─────────────────────────
    const PAGE_SIZE = 5000;

    interface FileMetadata {
      tableName: string;
      filePath: string;
      sha256: string;
      rows: number;
      bytes: number;
    }

    const fileMetadata: FileMetadata[] = [];
    let totalRows = 0;
    const redactedTableNames: string[] = [];

    for (const entry of TABLE_REGISTRY) {
      const { tableName, drizzleTable, redactedFields, scope } = entry;

      // Defensive: validate table name before embedding in SQL
      assertSafeTableName(tableName);

      if (redactedFields.length > 0 && !redactedTableNames.includes(tableName)) {
        redactedTableNames.push(tableName);
      }

      const filePath = path.join(tmpDir, `${tableName}.ndjson`);
      const fileHandle = await open(filePath, "w");
      const hasher = createHash("sha256");
      let rowCount = 0;
      let byteCount = 0;

      // Build the snake→camel map once per table (uses drizzle column metadata)
      const snakeToCamel = buildSnakeToCamelMap(drizzleTable as object);

      try {
        if (scope.type === "businesses") {
          // Businesses table — export all rows for this tenant (no WHERE filter)
          let offset = 0;
          let done = false;

          while (!done) {
            const rows = (await db.execute(
              sql`SELECT * FROM ${sql.raw(tableName)} ORDER BY id LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
            )) as Array<Record<string, unknown>>;

            for (const row of rows) {
              const line = serializeRow(row, redactedFields, snakeToCamel) + "\n";
              const buf = Buffer.from(line, "utf8");
              await fileHandle.write(buf);
              hasher.update(buf);
              byteCount += buf.length;
              rowCount++;
            }

            if (rows.length < PAGE_SIZE) {
              done = true;
            } else {
              offset += PAGE_SIZE;
            }
          }
        } else if (businessIds.length === 0) {
          // Empty tenant — write empty NDJSON file
        } else if (scope.type === "direct") {
          // Table has a direct business_id column
          const bizIdList = businessIds.map((id) => `'${id}'`).join(", ");
          const whereClause = sql.raw(`business_id IN (${bizIdList})`);

          let offset = 0;
          let done = false;

          while (!done) {
            const rows = (await db.execute(
              sql`SELECT * FROM ${sql.raw(tableName)} WHERE ${whereClause} ORDER BY id LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
            )) as Array<Record<string, unknown>>;

            for (const row of rows) {
              const line = serializeRow(row, redactedFields, snakeToCamel) + "\n";
              const buf = Buffer.from(line, "utf8");
              await fileHandle.write(buf);
              hasher.update(buf);
              byteCount += buf.length;
              rowCount++;
            }

            if (rows.length < PAGE_SIZE) {
              done = true;
            } else {
              offset += PAGE_SIZE;
            }
          }
        } else if (scope.type === "child") {
          // Table is a child of another table — scope via subquery
          // WHERE <parentFk> IN (SELECT id FROM <parentTable> WHERE business_id IN (<ids>))
          assertSafeTableName(scope.parentTable);
          assertSafeTableName(scope.parentFk);

          const bizIdList = businessIds.map((id) => `'${id}'`).join(", ");
          const whereClause = sql.raw(
            `${scope.parentFk} IN (SELECT id FROM ${scope.parentTable} WHERE business_id IN (${bizIdList}))`,
          );

          let offset = 0;
          let done = false;

          while (!done) {
            const rows = (await db.execute(
              sql`SELECT * FROM ${sql.raw(tableName)} WHERE ${whereClause} ORDER BY id LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
            )) as Array<Record<string, unknown>>;

            for (const row of rows) {
              const line = serializeRow(row, redactedFields, snakeToCamel) + "\n";
              const buf = Buffer.from(line, "utf8");
              await fileHandle.write(buf);
              hasher.update(buf);
              byteCount += buf.length;
              rowCount++;
            }

            if (rows.length < PAGE_SIZE) {
              done = true;
            } else {
              offset += PAGE_SIZE;
            }
          }
        }

        await fileHandle.close();
      } catch (err) {
        await fileHandle.close().catch(() => undefined);
        await cleanup();
        logger.error({ err, tableName }, "[selfExport] Error writing table");
        return c.json({ error: "Export failed" }, 500);
      }

      totalRows += rowCount;
      fileMetadata.push({
        tableName,
        filePath,
        sha256: hasher.digest("hex"),
        rows: rowCount,
        bytes: byteCount,
      });
    }

    // ── Build manifest ────────────────────────────────────────────────────────
    const rowCounts: Record<string, number> = {};
    const files: Manifest["files"] = {};

    for (const fm of fileMetadata) {
      rowCounts[fm.tableName] = fm.rows;
      files[`${fm.tableName}.ndjson`] = {
        sha256: fm.sha256,
        rows: fm.rows,
        bytes: fm.bytes,
      };
    }

    const manifest: Manifest = {
      format: "hisaabo-export",
      formatVersion: 1,
      appVersion: APP_VERSION,
      schemaChecksum: SCHEMA_CHECKSUM,
      exportedAt: new Date().toISOString(),
      sourceTenantId: tenantId,
      sourceTenantSlug: tenantSlug,
      businessIds,
      rowCounts,
      files,
      redacted: redactedTableNames,
    };

    const manifestBuf = Buffer.from(
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8",
    );
    const manifestPath = path.join(tmpDir, "manifest.json");
    const mfh = await open(manifestPath, "w");
    await mfh.writeFile(manifestBuf);
    await mfh.close();

    // ── Stream tar.gz to client ───────────────────────────────────────────────
    const tarPack = tarStream.pack();
    const gzip = createGzip({ level: 6 });
    const tarGzStream = tarPack.pipe(gzip);

    let clientGone = false;

    // Build tar contents asynchronously
    const tarBuildPromise = (async (): Promise<void> => {
      // Emit manifest first
      await new Promise<void>((resolve, reject) => {
        tarPack.entry(
          { name: "manifest.json", size: manifestBuf.length },
          manifestBuf,
          (err?: Error | null) => (err ? reject(err) : resolve()),
        );
      });

      // Emit each NDJSON file
      for (const fm of fileMetadata) {
        if (clientGone) break;

        await new Promise<void>((resolve, reject) => {
          const entry = tarPack.entry(
            { name: `${fm.tableName}.ndjson`, size: fm.bytes },
            (err?: Error | null) => (err ? reject(err) : resolve()),
          );

          if (fm.bytes === 0) {
            entry.end();
          } else {
            const readStream = createReadStream(fm.filePath);
            readStream.on("error", reject);
            entry.on("error", reject);
            readStream.pipe(entry);
          }
        });
      }

      tarPack.finalize();
    })();

    tarBuildPromise.catch((err: unknown) => {
      logger.error({ err }, "[selfExport] Tar build error");
      const e = err instanceof Error ? err : new Error(String(err));
      tarPack.destroy(e);
    });

    // ── Wrap Node stream into Web ReadableStream ──────────────────────────────
    let totalBytes = 0;
    const gzipHasher = createHash("sha256");

    const webReadable = new ReadableStream<Uint8Array>({
      start(controller) {
        tarGzStream.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          gzipHasher.update(chunk);
          controller.enqueue(chunk);
        });

        tarGzStream.on("end", () => {
          controller.close();
          const duration = Date.now() - startTime;
          logger.info(
            {
              tenantId,
              userId: tokenPayload.userId,
              duration_ms: duration,
              totalRows,
              totalBytes,
              fileHash: `sha256:${gzipHasher.digest("hex")}`,
            },
            "[selfExport] Export completed",
          );
          cleanup();
        });

        tarGzStream.on("error", (err: Error) => {
          controller.error(err);
          clientGone = true;
          logger.error({ err, tenantId }, "[selfExport] Stream error");
          cleanup();
        });
      },
      cancel() {
        clientGone = true;
        tarGzStream.destroy();
        cleanup();
        logger.info(
          { tenantId },
          "[selfExport] Client disconnected, export cancelled",
        );
      },
    });

    return new Response(webReadable, {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });
}
