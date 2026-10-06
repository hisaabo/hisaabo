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

/** Write a file owner-only (0600), refusing to follow a symlink at the target. */
export function writeFileSafe(file: string, data: string | Uint8Array): void {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) {
      fatalError(`Refusing to write to a symlink: ${file}`, EXIT.USAGE);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  fs.writeFileSync(file, data, { mode: 0o600 });
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
