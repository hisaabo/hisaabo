import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import { stripControlChars } from "@hisaabo/shared";
import { fatalError, EXIT } from "./output.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Exit with a usage error unless `value` is a UUID. Use before interpolating into URL paths. */
export function requireUuid(value: string, label = "id"): string {
  if (!isUuid(value)) {
    fatalError(`Invalid ${label}: expected a UUID`, EXIT.USAGE);
  }
  return value;
}

/** Reduce a server-supplied name to a safe single path component. */
export function safeFilename(name: string, fallback = "download"): string {
  const base = path.basename(String(name).replace(/\\/g, "/")).replace(/[^A-Za-z0-9._-]/g, "_");
  const trimmed = base.replace(/^\.+/, "");
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Cap on any single downloaded artifact (PDF, CSV) written by the CLI. */
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Write a downloaded artifact (server data) to a user-chosen path. This is the CLI's
 * one intentional network-to-disk sink for small exports; large streams use
 * `commands/backup/export.ts` (exclusive-create, 0600).
 *
 * Guards: size cap, optional magic-prefix check, owner-only mode (0600), symlink
 * refused atomically via O_NOFOLLOW (no lstat-then-write race), and the opened
 * descriptor must be a regular file. An existing regular file is overwritten.
 */
export function writeFileSafe(
  file: string,
  data: string | Uint8Array,
  opts: { magic?: string } = {},
): void {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf-8") : Buffer.from(data);
  if (bytes.length > MAX_DOWNLOAD_BYTES) {
    fatalError(`Refusing to write ${Math.round(bytes.length / 1024 / 1024)} MB; max ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB`, EXIT.USAGE);
  }
  if (opts.magic !== undefined && bytes.subarray(0, opts.magic.length).toString("latin1") !== opts.magic) {
    fatalError(`Unexpected response: not a ${opts.magic.replace(/[^A-Za-z]/g, "")} file`, EXIT.GENERAL);
  }
  let fd: number;
  try {
    // O_NOFOLLOW is undefined on Windows (no symlink following by default there); `?? 0` is a no-op.
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | noFollow, 0o600);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ELOOP") fatalError(`Refusing to write to a symlink: ${file}`, EXIT.USAGE);
    throw e;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) fatalError(`Refusing to write to a non-regular file: ${file}`, EXIT.USAGE);
    fs.ftruncateSync(fd, 0);
    fs.fchmodSync(fd, 0o600);
    let off = 0;
    while (off < bytes.length) off += fs.writeSync(fd, bytes, off, bytes.length - off);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Fail-closed confirmation for destructive actions: --yes proceeds, a TTY is
 * prompted, anything else (agents, CI, pipes) refuses.
 */
export async function confirmOrExit(message: string, opts: { yes?: boolean }): Promise<void> {
  if (opts.yes) return;
  if (!process.stdin.isTTY) {
    fatalError("Refusing destructive action non-interactively; pass --yes", EXIT.USAGE);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`  ${stripControlChars(message).trimStart()} (y/N): `, resolve);
  });
  rl.close();
  if (answer.trim().toLowerCase() !== "y") {
    console.log("  Cancelled.");
    process.exit(0);
  }
}
