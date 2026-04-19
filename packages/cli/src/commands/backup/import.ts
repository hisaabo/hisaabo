/**
 * hisaabo restore — upload a .tar.gz backup archive to an empty tenant.
 *
 * Flow:
 *   1. Verify file exists, is readable, non-zero
 *   2. Resolve tenant slug → UUID if needed
 *   3. Confirmation prompt (unless --yes)
 *   4. Call selfImport.request to get a signed upload URL
 *   5. Stream POST with Content-Type: application/gzip; show upload progress
 *   6. Parse response JSON and print summary
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import * as readline from "node:readline";

import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireTenantAuth } from "../../config.js";
import { fatalError, success, warn, hasColor, isInteractive, EXIT } from "../../output.js";
import chalk from "chalk";

// ── Exit codes specific to backup/restore ─────────────────────────────────────
// 0 success, 1 auth failure, 2 rate limited, 3 target not empty,
// 4 file missing/corrupt, 5 server error
const EXIT_AUTH = 1;
const EXIT_TARGET_NOT_EMPTY = 3;
const EXIT_FILE_ERROR = 4;
const EXIT_SERVER_ERROR = 5;

// ── UUID detection ────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// ── Tenant resolution ─────────────────────────────────────────────────────────

interface TenantEntry {
  id: string;
  name: string;
  slug: string;
  role: string;
}

async function resolveTenant(client: HisaaboClient, slugOrId: string): Promise<{ id: string; slug: string }> {
  if (isUuid(slugOrId)) {
    return { id: slugOrId, slug: slugOrId };
  }

  const tenants = await client.tenant.list() as TenantEntry[];
  const match = tenants.find((t) => t.slug === slugOrId);
  if (!match) {
    fatalError(`Tenant "${slugOrId}" not found. Run: hisaabo tenant list`, EXIT.NOT_FOUND);
  }
  return { id: match.id, slug: match.slug };
}

// ── Progress display ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function printUploadProgress(uploaded: number, total: number, elapsed: number): void {
  if (!isInteractive()) return;
  const speed = elapsed > 0 ? uploaded / (elapsed / 1000) : 0;
  const pct = total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : 0;
  const msg = `  ${formatBytes(uploaded)} / ${formatBytes(total)}  ${pct}%  ${formatSpeed(speed)}  (${(elapsed / 1000).toFixed(1)}s)`;
  process.stdout.write(`\r${msg}                    `);
}

function clearProgress(): void {
  if (!isInteractive()) return;
  process.stdout.write("\r" + " ".repeat(80) + "\r");
}

// ── Confirmation prompt ───────────────────────────────────────────────────────

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

// ── Import response types ─────────────────────────────────────────────────────

interface Compatibility {
  appVersionMatch: boolean;
  schemaChecksumMatch: boolean;
  sourceAppVersion: string;
  targetAppVersion: string;
  sourceSchemaChecksum: string;
  targetSchemaChecksum: string;
}

interface ImportSuccessResponse {
  ok: true;
  rowsInserted: Record<string, number>;
  rowsSkipped: Record<string, number>;
  warnings: string[];
  durationMs: number;
  compatibility?: Compatibility;
}

interface ImportFailedResponse {
  ok: false;
  errors: string[];
  warnings: string[];
  durationMs: number;
  compatibility?: Compatibility;
}

function printCompatibility(compat: Compatibility | undefined): void {
  if (!compat) return;
  if (compat.appVersionMatch && compat.schemaChecksumMatch) return;
  const label = hasColor() ? chalk.yellow("Best-effort restore") : "Best-effort restore";
  console.log(`  ${label}: backup was produced against a different build.`);
  if (!compat.appVersionMatch) {
    console.log(
      `    App version: backup ${compat.sourceAppVersion} → server ${compat.targetAppVersion}`,
    );
  }
  if (!compat.schemaChecksumMatch) {
    console.log(
      `    Schema fingerprint differs — table shape has changed since this backup was taken.`,
    );
  }
  console.log(`    Spot-check a few invoices and reports before relying on the data.`);
}

// ── Restore command ───────────────────────────────────────────────────────────

export interface RestoreOpts {
  tenant: string;
  input: string;
  yes?: boolean;
}

export async function restoreCommand(opts: RestoreOpts): Promise<void> {
  const cfg = requireTenantAuth();
  const client = new HisaaboClient(cfg);

  // 1. Verify file exists, readable, non-zero
  let fileStats: { size: number };
  try {
    fileStats = await stat(opts.input);
  } catch {
    fatalError(`File not found or not readable: ${opts.input}`, EXIT_FILE_ERROR);
  }

  if (fileStats.size === 0) {
    fatalError(`File is empty: ${opts.input}`, EXIT_FILE_ERROR);
  }

  // 2. Resolve tenant
  let tenantId: string;
  let tenantSlug: string;
  try {
    const resolved = await resolveTenant(client, opts.tenant);
    tenantId = resolved.id;
    tenantSlug = resolved.slug;
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") {
        fatalError("Not authenticated. Run `hisaabo login` first.", EXIT_AUTH);
      }
      if (err.code === "network_error") {
        fatalError(err.message, EXIT_SERVER_ERROR);
      }
    }
    throw e;
  }

  // 3. Confirmation prompt
  if (!opts.yes) {
    if (process.stdin.isTTY) {
      const proceed = await confirm(
        `  This will import all data from \`${opts.input}\` into tenant \`${tenantSlug}\`.\n` +
        `  Target tenant must be empty. Proceed? [y/N]: `,
      );
      if (!proceed) {
        console.log("  Cancelled.");
        process.exit(0);
      }
    } else {
      warn("Non-interactive mode: pass --yes to skip confirmation.");
      process.exit(0);
    }
  }

  // 4. Request import token
  let uploadUrl: string;
  try {
    const result = await client.selfImport.request({ tenantId });
    // Server returns a relative URL: /api/selfImport/:tenantId?token=...
    uploadUrl = result.url.startsWith("/")
      ? `${cfg.apiUrl}${result.url}`
      : result.url;
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") {
        fatalError("Not authenticated. Run `hisaabo login` first.", EXIT_AUTH);
      }
      if (err.code === "forbidden") {
        fatalError("You must be the tenant owner to import data.", EXIT_AUTH);
      }
      // PRECONDITION_FAILED maps to api_error; message contains TARGET_NOT_EMPTY
      if (err.code === "api_error" && err.message.includes("TARGET_NOT_EMPTY")) {
        fatalError(
          "Target tenant is not empty. Restore only works on an empty tenant.",
          EXIT_TARGET_NOT_EMPTY,
        );
      }
      if (err.code === "network_error") {
        fatalError(err.message, EXIT_SERVER_ERROR);
      }
      fatalError(e.message, EXIT_SERVER_ERROR);
    }
    fatalError(String(e instanceof Error ? e.message : e), EXIT_SERVER_ERROR);
  }

  // 5. Upload the file with progress
  if (hasColor()) {
    process.stdout.write(chalk.dim(`  Uploading ${opts.input} (${formatBytes(fileStats.size)})...\n`));
  } else {
    process.stdout.write(`  Uploading ${opts.input} (${formatBytes(fileStats.size)})...\n`);
  }

  const startTime = Date.now();
  let uploaded = 0;
  let progressInterval: ReturnType<typeof setInterval> | undefined;

  progressInterval = setInterval(() => {
    printUploadProgress(uploaded, fileStats.size, Date.now() - startTime);
  }, 250);

  let responseBody: ImportSuccessResponse | ImportFailedResponse;

  try {
    // Build a ReadableStream from the file — do not buffer into memory
    const nodeReadStream = createReadStream(opts.input);
    const webReadable = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeReadStream.on("data", (chunk: Buffer | string) => {
          const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          uploaded += buf.length;
          controller.enqueue(new Uint8Array(buf));
        });
        nodeReadStream.on("end", () => controller.close());
        nodeReadStream.on("error", (err) => controller.error(err));
      },
      cancel() {
        nodeReadStream.destroy();
      },
    });

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cfg.token}`,
        "x-client-type": "cli",
        "Content-Type": "application/gzip",
        "Content-Length": String(fileStats.size),
      },
      body: webReadable,
      // @ts-expect-error -- Node 18+ fetch needs duplex for request body streaming
      duplex: "half",
    });

    clearInterval(progressInterval);
    progressInterval = undefined;
    clearProgress();

    const raw = await response.json() as unknown;

    if (!response.ok) {
      // Check for TARGET_NOT_EMPTY at the HTTP layer (409)
      if (response.status === 409) {
        const body = raw as Record<string, unknown>;
        if (typeof body["error"] === "string" && body["error"].includes("TARGET_NOT_EMPTY")) {
          fatalError(
            "Target tenant is not empty. Restore only works on an empty tenant.",
            EXIT_TARGET_NOT_EMPTY,
          );
        }
      }
      const errBody = raw as Record<string, unknown>;
      const errMsg = String(errBody["error"] ?? errBody["message"] ?? `HTTP ${response.status}`);
      fatalError(`Upload failed: ${errMsg}`, EXIT_SERVER_ERROR);
    }

    responseBody = raw as ImportSuccessResponse | ImportFailedResponse;

  } catch (e) {
    if (progressInterval !== undefined) {
      clearInterval(progressInterval);
    }
    clearProgress();
    if (e instanceof HisaaboApiError && e.hisaaboError.code === "network_error") {
      fatalError(`Upload failed: ${e.hisaaboError.message}`, EXIT_SERVER_ERROR);
    }
    // Re-throw if it's already a process.exit (fatalError)
    if (e instanceof Error && e.message === "process.exit") throw e;
    fatalError(`Upload failed: ${String(e instanceof Error ? e.message : e)}`, EXIT_SERVER_ERROR);
  }

  // 6. Print result
  if (!responseBody.ok) {
    const failed = responseBody as ImportFailedResponse;
    process.stderr.write("\nImport failed:\n");
    for (const err of failed.errors) {
      process.stderr.write(`  - ${err}\n`);
    }
    printCompatibility(failed.compatibility);
    process.exit(EXIT_SERVER_ERROR);
  }

  const done = responseBody as ImportSuccessResponse;

  success(`Import completed in ${(done.durationMs / 1000).toFixed(1)}s`);
  printCompatibility(done.compatibility);

  // Print rows inserted per table
  const tables = Object.entries(done.rowsInserted).filter(([, n]) => n > 0);
  if (tables.length > 0) {
    console.log("  Rows inserted:");
    for (const [table, count] of tables) {
      console.log(`    ${table}: ${count}`);
    }
  }

  const skippedTables = Object.entries(done.rowsSkipped ?? {}).filter(([, n]) => n > 0);
  if (skippedTables.length > 0) {
    console.log("  Rows skipped:");
    for (const [table, count] of skippedTables) {
      console.log(`    ${table}: ${count}`);
    }
  }

  if (done.warnings && done.warnings.length > 0) {
    console.log(`  Warnings (${done.warnings.length}):`);
    for (const w of done.warnings) {
      warn(w);
    }
  }
}
