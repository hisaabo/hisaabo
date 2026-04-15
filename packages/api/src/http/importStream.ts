/**
 * importStream.ts — HTTP handler for the self-import restore endpoint.
 *
 * Route: POST /api/selfImport/:tenantId?token=<signed-token>
 *
 * Body format: raw application/gzip (NOT multipart/form-data).
 *
 * Rationale for raw gzip over multipart:
 *   1. Simpler streaming — no boundary parsing overhead or multipart buffering.
 *   2. The body IS the archive; no envelope needed.
 *   3. Client sets Content-Type: application/gzip and streams directly.
 *   4. Compatible with curl: `curl -X POST --data-binary @backup.tar.gz
 *      -H 'Content-Type: application/gzip' /api/selfImport/:tenantId?token=...`
 *
 * Pipeline: request body → node:zlib createGunzip → importEngine (tar parser).
 */
import { createGunzip } from "node:zlib";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { Hono } from "hono";
import { getTenantDb, businesses } from "@hisaabo/db";
import { count as sqlCount } from "drizzle-orm";
import { verifyImportToken } from "../lib/importToken.js";
import { importTenantBackup } from "../lib/importEngine.js";
import { logger } from "../lib/logger.js";

/**
 * Register the import upload route on a Hono app instance.
 * Called from server.ts next to registerExportRoute(app).
 *
 * Route: POST /api/selfImport/:tenantId
 */
export function registerImportRoute(app: Hono): void {
  app.post("/api/selfImport/:tenantId", async (c) => {
    const tenantId = c.req.param("tenantId");
    const token = c.req.query("token");

    if (!token) {
      return c.json({ error: "Missing token" }, 401);
    }

    // ── Token verification ────────────────────────────────────────────────
    const tokenResult = verifyImportToken(token);
    if (!tokenResult.ok) {
      return c.json({ error: `Token ${tokenResult.reason}` }, 401);
    }

    if (tokenResult.payload.tenantId !== tenantId) {
      return c.json({ error: "Token tenant mismatch" }, 401);
    }

    const { userId } = tokenResult.payload;

    // ── Re-check target tenant is empty ──────────────────────────────────
    // Checked again here because time may have elapsed since token issuance.
    let tenantDb: Awaited<ReturnType<typeof getTenantDb>>;
    try {
      tenantDb = await getTenantDb(tenantId);
    } catch (err) {
      logger.error({ err, tenantId }, "importStream: failed to get tenant DB");
      return c.json({ error: "Failed to connect to tenant database" }, 500);
    }

    const [countRow] = await tenantDb
      .select({ businessCount: sqlCount(businesses.id) })
      .from(businesses);

    if ((countRow?.businessCount ?? 0) > 0) {
      return c.json(
        {
          error: "TARGET_NOT_EMPTY",
          message: "Target tenant already has businesses. Import is only allowed to an empty tenant.",
        },
        409,
      );
    }

    // ── Content-type check ────────────────────────────────────────────────
    const contentType = c.req.header("content-type") ?? "";
    if (
      !contentType.includes("application/gzip") &&
      !contentType.includes("application/octet-stream")
    ) {
      return c.json({ error: "Expected Content-Type: application/gzip" }, 415);
    }

    // ── Read + hash the gzip body ─────────────────────────────────────────
    const rawBody = await c.req.arrayBuffer();
    if (rawBody.byteLength === 0) {
      return c.json({ error: "Empty body" }, 400);
    }

    const gzipBuf = Buffer.from(rawBody);
    const fileHash = `sha256:${createHash("sha256").update(gzipBuf).digest("hex")}`;
    const fileSize = gzipBuf.byteLength;

    const log = logger.child({
      tenantId,
      userId,
      fileSize,
      fileHash,
      route: "POST /api/selfImport/:tenantId",
    });

    log.info("importStream: starting import pipeline");

    // ── Decompress: gzip → raw tar stream ────────────────────────────────
    const gunzip = createGunzip();
    const gzipReadable = Readable.from(
      (function* () {
        yield gzipBuf;
      })(),
    );
    const tarReadable = gzipReadable.pipe(gunzip) as unknown as Readable;

    // ── Run the import engine ─────────────────────────────────────────────
    let result;
    try {
      result = await importTenantBackup(tenantDb as any, tarReadable, log);
    } catch (err) {
      log.error({ err }, "importStream: unhandled error in importTenantBackup");
      return c.json({ error: "Import pipeline failed unexpectedly" }, 500);
    }

    if (result.status === "failed") {
      log.error(
        { errorCount: result.errors.length, durationMs: result.durationMs },
        "importStream: import failed",
      );
      return c.json(
        {
          ok: false,
          errors: result.errors,
          warnings: result.warnings,
          durationMs: result.durationMs,
        },
        422,
      );
    }

    log.info(
      {
        rowsInserted: result.rowsInserted,
        rowsSkipped: result.rowsSkipped,
        warningCount: result.warnings.length,
        durationMs: result.durationMs,
      },
      "importStream: import succeeded",
    );

    return c.json({
      ok: true,
      rowsInserted: result.rowsInserted,
      rowsSkipped: result.rowsSkipped,
      warnings: result.warnings,
      durationMs: result.durationMs,
    });
  });
}
