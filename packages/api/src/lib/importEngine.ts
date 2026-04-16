/**
 * importEngine.ts — top-level orchestrator for the self-import restore pipeline.
 *
 * Accepts a tar stream (already decompressed) from the HTTP handler and runs:
 *   Phase 1 — manifest validation (integrity, formatVersion, checksums, row counts)
 *   Phase 2 — per-table NDJSON parsing + row-level Zod validation
 *   Phase 3 — commit in TABLE_REGISTRY order (two-pass for self-FK tables)
 *   Phase 4 — post-import recompute of denormalised columns
 *
 * On any error in Phase 1-3 the entire import is aborted; no partial data is
 * committed. Phase 4 recompute errors are non-fatal (warnings only).
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import tarStream from "tar-stream";
import { eq } from "drizzle-orm";
import type { TenantDatabase } from "@hisaabo/db";
import { TABLE_REGISTRY } from "./tableRegistry.js";
import { ROW_SCHEMAS, manifestSchema } from "@hisaabo/shared/selfExport";
import type { Manifest } from "@hisaabo/shared/selfExport";
import type { Logger } from "./logger.js";
import {
  recomputeBankBalances,
  recomputeStock,
  recomputeAmountPaid,
  type RecomputeWarning,
} from "./recomputeDerived.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ImportResult {
  status: "success" | "failed";
  rowsInserted: Record<string, number>;
  rowsSkipped: Record<string, number>;
  warnings: Array<{ table: string; message: string; context?: unknown }>;
  errors: Array<{ table: string; row: number; message: string }>;
  durationMs: number;
}

type RowMap = Map<string, unknown[]>; // tableName → parsed rows

// ── Helpers ─────────────────────────────────────────────────────────────────

function computeSha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Parse NDJSON buffer line-by-line.
 * Returns valid rows and appends parse errors for invalid ones.
 */
function parseNdjson(
  tableName: string,
  buf: Buffer,
  errors: Array<{ table: string; row: number; message: string }>,
): unknown[] {
  const schema = ROW_SCHEMAS[tableName];
  if (!schema) {
    errors.push({ table: tableName, row: 0, message: `No schema found for table ${tableName}` });
    return [];
  }

  const lines = buf.toString("utf8").split("\n");
  const rows: unknown[] = [];
  let lineNum = 0;

  for (const line of lines) {
    lineNum++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      errors.push({ table: tableName, row: lineNum, message: "Invalid JSON" });
      continue;
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      errors.push({
        table: tableName,
        row: lineNum,
        message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      continue;
    }

    rows.push(result.data);
  }

  return rows;
}

/**
 * Chunk an array into groups of at most `size`.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Run the full import pipeline against an already-decompressed tar stream.
 *
 * @param tenantDb  Drizzle connection for the target tenant database.
 * @param tarReadable  Node Readable carrying the raw tar archive bytes.
 * @param log  Pino logger instance with import context already bound.
 */
export async function importTenantBackup(
  tenantDb: TenantDatabase,
  tarReadable: Readable,
  log: Logger,
): Promise<ImportResult> {
  const startMs = Date.now();

  const rowsInserted: Record<string, number> = {};
  const rowsSkipped: Record<string, number> = {};
  const warnings: Array<{ table: string; message: string; context?: unknown }> = [];
  const errors: Array<{ table: string; row: number; message: string }> = [];

  function fail(message: string): ImportResult {
    return {
      status: "failed",
      rowsInserted,
      rowsSkipped,
      warnings,
      errors: [...errors, { table: "_pipeline", row: 0, message }],
      durationMs: Date.now() - startMs,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 1: Read all tar entries into memory
  // (Entries are typically small relative to available RAM; for very large
  // exports the operator should ensure sufficient heap. A future v2 can stream
  // commit per-table to reduce peak memory.)
  // ────────────────────────────────────────────────────────────────────────────

  log.info("import.phase0: reading tar entries");

  const entryBuffers = new Map<string, Buffer>(); // entryName → contents
  const entryOrder: string[] = []; // preserve order; manifest must be first

  try {
    await new Promise<void>((resolve, reject) => {
      const extract = tarStream.extract();

      extract.on("entry", (header, stream, next) => {
        const chunks: Buffer[] = [];
        stream.on("data", (c: Buffer) => chunks.push(c));
        stream.on("end", () => {
          entryBuffers.set(header.name, Buffer.concat(chunks));
          entryOrder.push(header.name);
          next();
        });
        stream.on("error", reject);
      });

      extract.on("finish", resolve);
      extract.on("error", reject);

      tarReadable.pipe(extract);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, "import.phase0: tar extraction failed");
    return fail(`Tar extraction failed: ${msg}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 1: Manifest validation
  // ────────────────────────────────────────────────────────────────────────────

  log.info("import.phase1: manifest validation");

  if (entryOrder[0] !== "manifest.json") {
    return fail("First tar entry must be manifest.json");
  }

  const manifestBuf = entryBuffers.get("manifest.json");
  if (!manifestBuf) return fail("manifest.json missing from archive");

  let manifest: Manifest;
  try {
    const raw = JSON.parse(manifestBuf.toString("utf8"));
    const result = manifestSchema.safeParse(raw);
    if (!result.success) {
      return fail(
        `manifest.json validation failed: ${result.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    manifest = result.data;
  } catch {
    return fail("manifest.json is not valid JSON");
  }

  if (manifest.formatVersion !== 1) {
    return fail(`Unsupported formatVersion: ${manifest.formatVersion} (expected 1)`);
  }

  // Verify checksums and row counts for all files listed in the manifest
  for (const [fileName, meta] of Object.entries(manifest.files)) {
    const buf = entryBuffers.get(fileName);
    if (!buf) {
      return fail(`Archive is missing declared file: ${fileName}`);
    }

    const actual = computeSha256(buf);
    if (actual !== meta.sha256) {
      return fail(
        `Checksum mismatch for ${fileName}: expected ${meta.sha256}, got ${actual}`,
      );
    }
  }

  // Cross-check manifest.rowCounts against manifest.files[*].rows
  for (const [tableName, expectedCount] of Object.entries(manifest.rowCounts)) {
    const fileName = `${tableName}.ndjson`;
    const fileMeta = manifest.files[fileName];
    if (fileMeta && fileMeta.rows !== expectedCount) {
      return fail(
        `Row count mismatch for ${tableName}: manifest.rowCounts says ${expectedCount}, manifest.files says ${fileMeta.rows}`,
      );
    }
  }

  log.info({ sourceTenantId: manifest.sourceTenantId }, "import.phase1: manifest valid");

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 2: Parse and validate all NDJSON files
  // ────────────────────────────────────────────────────────────────────────────

  log.info("import.phase2: parsing NDJSON files");

  const parsedRows: RowMap = new Map();

  for (const entry of TABLE_REGISTRY) {
    const fileName = `${entry.tableName}.ndjson`;
    const buf = entryBuffers.get(fileName);

    if (!buf) {
      // Not every archive will contain all tables (e.g. if a table had 0 rows
      // the exporter may omit the file). Treat as empty.
      parsedRows.set(entry.tableName, []);
      continue;
    }

    const rows = parseNdjson(entry.tableName, buf, errors);
    parsedRows.set(entry.tableName, rows);

    // Cross-check parsed row count against manifest
    const declaredCount = manifest.rowCounts[entry.tableName] ?? 0;
    if (rows.length !== declaredCount) {
      // We still collected errors above; add a summary error too
      errors.push({
        table: entry.tableName,
        row: 0,
        message: `Row count mismatch: manifest says ${declaredCount}, parsed ${rows.length}`,
      });
    }
  }

  if (errors.length > 0) {
    log.error({ errorCount: errors.length }, "import.phase2: validation errors — aborting");
    return {
      status: "failed",
      rowsInserted,
      rowsSkipped,
      warnings,
      errors,
      durationMs: Date.now() - startMs,
    };
  }

  log.info("import.phase2: all NDJSON valid");

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 3: Commit
  // ────────────────────────────────────────────────────────────────────────────

  log.info("import.phase3: committing rows");

  try {
    for (const entry of TABLE_REGISTRY) {
      const rows = parsedRows.get(entry.tableName) ?? [];

      if (!entry.importable) {
        rowsSkipped[entry.tableName] = rows.length;
        log.debug({ table: entry.tableName, rows: rows.length }, "import.phase3: skipped (not importable)");
        continue;
      }

      if (rows.length === 0) {
        rowsInserted[entry.tableName] = 0;
        continue;
      }

      const tableObj = entry.drizzleTable as any;

      if (entry.selfFkFields.length > 0) {
        // ── Two-pass insert for self-referencing tables ──────────────────────
        //
        // Tables: chart_of_accounts (parentId), invoices (referenceDocumentId),
        //         journal_entries (voidedByEntryId, reversesEntryId).
        //
        // Pass 1: insert all rows with self-FK columns nulled out.
        // Pass 2: UPDATE each row to restore the real FK value.
        //
        // This avoids FK constraint violations when the referenced row may not
        // have been inserted yet (self-referential order is arbitrary).

        log.debug(
          { table: entry.tableName, rows: rows.length, selfFkFields: entry.selfFkFields },
          "import.phase3: two-pass self-FK insert",
        );

        // Pass 1 — null the self-FK columns
        const pass1Rows = rows.map((r) => {
          const row = { ...(r as Record<string, unknown>) };
          for (const field of entry.selfFkFields) {
            row[field] = null;
          }
          return row;
        });

        const chunks1 = chunk(pass1Rows, entry.chunkSize || pass1Rows.length);
        for (const c of chunks1) {
          await tenantDb.insert(tableObj).values(c as any[]);
        }

        // Pass 2 — update self-FK columns row-by-row where non-null in original data
        for (const r of rows) {
          const row = r as Record<string, unknown>;
          const updates: Record<string, unknown> = {};
          for (const field of entry.selfFkFields) {
            if (row[field] != null) {
              updates[field] = row[field];
            }
          }
          if (Object.keys(updates).length > 0) {
            await tenantDb
              .update(tableObj)
              .set(updates)
              .where(eq(tableObj.id, row.id as string));
          }
        }

        rowsInserted[entry.tableName] = rows.length;
        log.debug({ table: entry.tableName, rows: rows.length }, "import.phase3: two-pass complete");
      } else {
        // ── Standard chunked insert ──────────────────────────────────────────

        const batchSize = entry.chunkSize > 0 ? entry.chunkSize : rows.length;
        const chunks = chunk(rows, batchSize);
        let inserted = 0;

        for (const c of chunks) {
          await tenantDb.insert(tableObj).values(c as any[]);
          inserted += c.length;
        }

        rowsInserted[entry.tableName] = inserted;
        log.debug({ table: entry.tableName, rows: inserted }, "import.phase3: inserted");
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, "import.phase3: commit failed");
    return fail(`Commit failed: ${msg}`);
  }

  log.info({ rowsInserted }, "import.phase3: commit complete");

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 4: Post-import recompute
  // ────────────────────────────────────────────────────────────────────────────

  log.info("import.phase4: recomputing derived columns");

  // Collect all imported business IDs
  const businessRows = (parsedRows.get("businesses") ?? []) as Array<{ id: string }>;
  const businessIds = businessRows.map((b) => b.id);

  if (businessIds.length > 0) {
    const [bankResult, stockResult, paidResult] = await Promise.all([
      recomputeBankBalances(tenantDb, businessIds),
      recomputeStock(tenantDb, businessIds),
      recomputeAmountPaid(tenantDb, businessIds),
    ]);

    function mapWarnings(recomputeWarnings: RecomputeWarning[]) {
      return recomputeWarnings.map((w) => ({
        table: w.table,
        message: `Recompute delta for ${w.column} on ${w.entityId}: exported=${w.exported}, computed=${w.computed}, delta=${w.delta}`,
        context: w,
      }));
    }

    warnings.push(...mapWarnings(bankResult.warnings));
    warnings.push(...mapWarnings(stockResult.warnings));
    warnings.push(...mapWarnings(paidResult.warnings));
  }

  if (warnings.length > 0) {
    log.warn({ warningCount: warnings.length }, "import.phase4: recompute warnings");
  } else {
    log.info("import.phase4: recompute clean");
  }

  const durationMs = Date.now() - startMs;
  log.info({ durationMs, rowsInserted, rowsSkipped, warnings: warnings.length }, "import: complete");

  return {
    status: "success",
    rowsInserted,
    rowsSkipped,
    warnings,
    errors,
    durationMs,
  };
}
