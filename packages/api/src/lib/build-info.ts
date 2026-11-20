/**
 * build-info.ts — single source of truth for "which build is this process?".
 *
 * Release images bake two values in at build time (see Dockerfile,
 * Dockerfile.once and .github/workflows/release.yml):
 *
 *   HISAABO_VERSION  release version, e.g. `0.9.0` (a leading `v` is tolerated
 *                    and stripped: a bare `v0.9.0` tag must never produce
 *                    `vv0.9.0` in a UI or disagree with the export manifest)
 *   HISAABO_COMMIT   full git SHA the image was built from
 *
 * Everything that reports a version (startup log, admin TUI, the
 * authenticated `auth.me` payload, the self-export manifest) reads it from
 * here so they can never disagree.
 *
 * Fallbacks: no HISAABO_VERSION (or the Dockerfile default `dev`) -> this
 * package's own package.json, which `pnpm release` keeps in lockstep with the
 * tag. No HISAABO_COMMIT -> `"unknown"`. The commit is deliberately NOT
 * discovered at runtime (`git rev-parse`): images exclude .git, and a guess
 * from a checkout that is not the build source would be worse than "unknown".
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildInfo {
  /** Release version without a leading `v`, e.g. `0.9.0` or `0.10.0-rc.1`. */
  version: string;
  /** Full lowercase git SHA, or `"unknown"` when the build did not record one. */
  commit: string;
}

export const UNKNOWN_COMMIT = "unknown";

/** Short form used in logs and the admin TUI (matches the `sha-<12>` image tag). */
export const SHORT_COMMIT_LENGTH = 12;

const COMMIT_RE = /^[0-9a-f]{7,40}$/;

/** `"v0.9.0"` -> `"0.9.0"`; empty and the Dockerfile placeholder `"dev"` -> `null`. */
export function normalizeVersion(raw: string | undefined | null): string | null {
  const v = raw?.trim().replace(/^v/, "");
  return v && v !== "dev" ? v : null;
}

/** A plausible hex SHA (lowercased), otherwise `"unknown"`. */
export function normalizeCommit(raw: string | undefined | null): string {
  const c = raw?.trim().toLowerCase();
  return c && COMMIT_RE.test(c) ? c : UNKNOWN_COMMIT;
}

export function shortCommit(commit: string, length: number = SHORT_COMMIT_LENGTH): string {
  return commit === UNKNOWN_COMMIT ? commit : commit.slice(0, length);
}

/** Version from the API package's own package.json (`"0.0.0"` if unreadable). */
export function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/lib/build-info.ts (dev, tests), dist/server.js and dist/bin/admin.js
  // (bundled) all resolve to packages/api/package.json via one of these.
  const candidates = [
    resolve(here, "..", "..", "package.json"),
    resolve(here, "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(p, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "@hisaabo/api" && typeof pkg.version === "string") return pkg.version;
    } catch {
      // try the next candidate
    }
  }
  return "0.0.0";
}

export function resolveBuildInfo(
  env: Record<string, string | undefined> = process.env,
  packageVersion: () => string = readPackageVersion,
): BuildInfo {
  return {
    version: normalizeVersion(env.HISAABO_VERSION) ?? packageVersion(),
    commit: normalizeCommit(env.HISAABO_COMMIT),
  };
}

/** `{ version, commit }` of this process, resolved once at module load. */
export const buildInfo: Readonly<BuildInfo> = Object.freeze(resolveBuildInfo());
