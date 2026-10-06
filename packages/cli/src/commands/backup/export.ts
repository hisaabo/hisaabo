/**
 * hisaabo export — download a full tenant backup as a .tar.gz archive.
 *
 * Flow:
 *   1. Resolve tenant slug → UUID if needed (via tenant.list)
 *   2. Call selfExport.request to get a signed download URL
 *   3. Stream GET response body to the output file
 *   4. Print sha256 + size on success
 */

import { createWriteStream } from "node:fs";
import { lstat, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { HisaaboClient, HisaaboApiError, transferTimeoutMs } from "../../client.js";
import { requireTenantAuth } from "../../config.js";
import { fatalError, success, hasColor, isInteractive, EXIT } from "../../output.js";
import { resolveSameOriginUrl } from "../../url.js";
import chalk from "chalk";

// ── Exit codes specific to backup/restore ─────────────────────────────────────
// 0 success, 1 auth failure, 2 rate limited, 3 target not empty,
// 4 file missing/corrupt, 5 server error
const EXIT_AUTH = 1;
const EXIT_RATE_LIMITED = 2;
const EXIT_SERVER_ERROR = 5;

// ── UUID detection ────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// ── Tenant resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a slug or UUID to a tenant UUID.
 * If the input is already a UUID, return it as-is.
 * Otherwise look it up via tenant.list and match by slug.
 */
async function resolveTenantId(client: HisaaboClient, slugOrId: string): Promise<string> {
  if (isUuid(slugOrId)) {
    return slugOrId;
  }

  const tenants = await client.tenant.list();
  const match = tenants.find((t) => t.tenantSlug === slugOrId);
  if (!match) {
    fatalError(`Tenant "${slugOrId}" not found. Run: hisaabo tenant list`, EXIT.NOT_FOUND);
  }
  return match.tenantId;
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

function printProgress(bytes: number, elapsed: number): void {
  if (!isInteractive()) return;
  const speed = elapsed > 0 ? bytes / (elapsed / 1000) : 0;
  const msg = `  ${formatBytes(bytes)} downloaded  ${formatSpeed(speed)}  (${(elapsed / 1000).toFixed(1)}s)`;
  process.stdout.write(`\r${msg}                    `);
}

function clearProgress(): void {
  if (!isInteractive()) return;
  process.stdout.write("\r" + " ".repeat(72) + "\r");
}

// ── Export command ────────────────────────────────────────────────────────────

export interface ExportOpts {
  tenant: string;
  output: string;
  force?: boolean;
  yes?: boolean;
}

export async function exportCommand(opts: ExportOpts): Promise<void> {
  const cfg = requireTenantAuth();
  const client = new HisaaboClient(cfg);

  // 1. Resolve tenant
  let tenantId: string;
  try {
    tenantId = await resolveTenantId(client, opts.tenant);
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
    // fatalError calls from resolveTenantId already exit; rethrow others
    throw e;
  }

  // 2. Request export token
  let exportUrl: string;
  try {
    const result = await client.selfExport.request({ tenantId });
    // Server returns a relative URL: /api/export/:tenantId?token=...
    // Anything off-origin is refused so the bearer token is never sent elsewhere.
    exportUrl = resolveSameOriginUrl(result.url, cfg.apiUrl);
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") {
        fatalError("Not authenticated. Run `hisaabo login` first.", EXIT_AUTH);
      }
      if (err.code === "forbidden") {
        fatalError("You must be the tenant owner to export data.", EXIT_AUTH);
      }
      if (err.code === "rate_limited") {
        fatalError("Export limit reached (2/day). Try again tomorrow.", EXIT_RATE_LIMITED);
      }
      if (err.code === "network_error") {
        fatalError(err.message, EXIT_SERVER_ERROR);
      }
      fatalError(e.message, EXIT_SERVER_ERROR);
    }
    fatalError(String(e instanceof Error ? e.message : e), EXIT_SERVER_ERROR);
  }

  // 3. Download the archive with streaming progress
  const outPath = opts.output;
  let fileSize = 0;
  const sha256 = createHash("sha256");
  const startTime = Date.now();
  let progressInterval: ReturnType<typeof setInterval> | undefined;

  if (hasColor()) {
    process.stdout.write(chalk.dim(`  Downloading backup to ${outPath}...\n`));
  } else {
    process.stdout.write(`  Downloading backup to ${outPath}...\n`);
  }

  // Never write through a symlink; never clobber an existing file without --force.
  try {
    const existing = await lstat(outPath);
    if (existing.isSymbolicLink()) {
      fatalError(`Refusing to write to a symlink: ${outPath}`, EXIT.USAGE);
    }
    if (!opts.force) {
      fatalError(`${outPath} already exists. Use --force to overwrite.`, EXIT.USAGE);
    }
    if (!existing.isFile()) {
      fatalError(`${outPath} is not a regular file`, EXIT.USAGE);
    }
    await unlink(outPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
  }

  // 'wx' fails if something appeared at the path since the check above.
  const writeStream = createWriteStream(outPath, { flags: "wx", mode: 0o600 });
  const opened = await new Promise<Error | null>((resolve) => {
    writeStream.once("open", () => resolve(null));
    writeStream.once("error", (err) => resolve(err));
  });
  if (opened) {
    fatalError(`Cannot create ${outPath}: ${opened.message}`, EXIT.USAGE);
  }

  // Abort if no bytes arrive for the idle window (the whole transfer may be long).
  const abort = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const bumpIdle = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abort.abort(), transferTimeoutMs());
  };
  bumpIdle();

  try {
    const response = await fetch(exportUrl, {
      headers: {
        "Authorization": `Bearer ${cfg.token}`,
        "x-client-type": "cli",
      },
      redirect: "error",
      signal: abort.signal,
    });

    if (!response.ok) {
      writeStream.close();
      await unlink(outPath).catch(() => undefined);
      fatalError(`Download failed: HTTP ${response.status}`, EXIT_SERVER_ERROR);
    }

    if (!response.body) {
      writeStream.close();
      await unlink(outPath).catch(() => undefined);
      fatalError("Download failed: empty response body", EXIT_SERVER_ERROR);
    }

    // Start progress display
    progressInterval = setInterval(() => {
      printProgress(fileSize, Date.now() - startTime);
    }, 250);

    // Stream response body → write stream + sha256 hasher
    const reader = response.body.getReader();
    await new Promise<void>((resolve, reject) => {
      writeStream.on("error", reject);

      const pump = (): void => {
        reader.read().then(({ done, value }) => {
          if (done) {
            writeStream.end(() => resolve());
            return;
          }
          bumpIdle();
          sha256.update(value);
          fileSize += value.length;
          if (!writeStream.write(value)) {
            writeStream.once("drain", pump);
          } else {
            pump();
          }
        }).catch(reject);
      };

      pump();
    });

  } catch (e) {
    if (idleTimer) clearTimeout(idleTimer);
    if (progressInterval !== undefined) {
      clearInterval(progressInterval);
    }
    clearProgress();
    // Clean up partial file
    writeStream.destroy();
    await unlink(outPath).catch(() => undefined);
    if (e instanceof HisaaboApiError && e.hisaaboError.code === "network_error") {
      fatalError(`Download failed: ${e.hisaaboError.message}`, EXIT_SERVER_ERROR);
    }
    fatalError(`Download failed: ${String(e instanceof Error ? e.message : e)}`, EXIT_SERVER_ERROR);
  }

  if (idleTimer) clearTimeout(idleTimer);
  if (progressInterval !== undefined) {
    clearInterval(progressInterval);
  }
  clearProgress();

  const digest = sha256.digest("hex");

  // Verify file was written
  let writtenSize: number;
  try {
    const info = await stat(outPath);
    writtenSize = info.size;
  } catch {
    fatalError("Failed to read output file after download", EXIT_SERVER_ERROR);
  }

  if (writtenSize === 0) {
    await unlink(outPath).catch(() => undefined);
    fatalError("Download produced an empty file", EXIT_SERVER_ERROR);
  }

  success(`Backup saved to ${outPath}`);
  console.log(`  Size:   ${formatBytes(writtenSize)}`);
  console.log(`  SHA256: ${digest}`);
  console.log(`  Time:   ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}
