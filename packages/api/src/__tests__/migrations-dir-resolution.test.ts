/**
 * migrations-dir-resolution.test.ts — Protects the tenant-migration path
 * resolution logic that crashed production.
 *
 * BACKGROUND:
 *   packages/api/tsup.config.ts inlines @hisaabo/db into packages/api/dist/.
 *   Before the fix, migrate.ts used `resolve(__dirname, "..", "drizzle-tenant")`
 *   which pointed at /app/packages/api/drizzle-tenant/ (nonexistent) inside
 *   the bundled runtime, causing the first user's magic-link verify to crash
 *   with `Can't find meta/_journal.json file`.
 *
 * INVARIANTS PROTECTED:
 *   1. `buildMigrationsDirCandidates` returns candidates in the correct
 *      priority order: HISAABO_MIGRATIONS_DIR override → db package root →
 *      __dirname hop (api/dist → db/) → cwd fallback.
 *   2. `pickExistingMigrationsDir` selects the FIRST candidate whose
 *      meta/_journal.json exists, not just the first candidate.
 *   3. When no candidate exists, it returns the first candidate so the
 *      eventual drizzle error message points at the expected location
 *      (helps operators diagnose missing-bundle issues quickly).
 *   4. The override always wins when set, even if other candidates exist —
 *      critical so operators can pin the path in unusual deploys.
 *
 * These are pure functions; no DB needed.
 */

import { describe, it, expect } from "vitest";
import {
  buildMigrationsDirCandidates,
  pickExistingMigrationsDir,
} from "@hisaabo/db";

const SUB = "drizzle-tenant";

describe("buildMigrationsDirCandidates", () => {
  const base = {
    dbPkgRoot: "/app/packages/db",
    currentDir: "/app/packages/api/dist",
    cwd: "/app",
  };

  it("includes the override as the FIRST candidate when set", () => {
    const candidates = buildMigrationsDirCandidates(SUB, {
      ...base,
      override: "/etc/hisaabo/migrations",
    });
    expect(candidates[0]).toBe("/etc/hisaabo/migrations/drizzle-tenant");
  });

  it("omits the override slot entirely when the env var is undefined/null/empty", () => {
    // Real layout: developer running tsx from source, no env override set.
    // Candidate list must still work without a gap.
    for (const ovr of [undefined, null, ""] as const) {
      const candidates = buildMigrationsDirCandidates(SUB, { ...base, override: ovr });
      // First candidate must be DB_PKG_ROOT/<subdir> — the dev + migrate-cli
      // path that has been correct since day one.
      expect(candidates[0]).toBe("/app/packages/db/drizzle-tenant");
    }
  });

  it("includes the api/dist → db hop as a fallback for the bundled-API layout", () => {
    // This is the production-crash case: @hisaabo/db inlined into api/dist,
    // __dirname = /app/packages/api/dist. The hop `/app/packages/api/dist/../../db`
    // resolves to `/app/packages/db` — matches where the Dockerfile ships
    // migrations.
    const candidates = buildMigrationsDirCandidates(SUB, {
      ...base,
      override: null,
    });
    expect(candidates).toContain("/app/packages/db/drizzle-tenant");
  });

  it("includes a monorepo cwd fallback that covers common deploy shapes", () => {
    const candidates = buildMigrationsDirCandidates(SUB, {
      dbPkgRoot: "/nonsense",
      currentDir: "/nonsense/deep/nested",
      cwd: "/srv/app",
      override: null,
    });
    expect(candidates).toContain("/srv/app/packages/db/drizzle-tenant");
  });

  it("keeps candidate ordering stable: override > db root > api→db hop > cwd", () => {
    // Order matters because pickExistingMigrationsDir stops at the first hit.
    // An operator setting HISAABO_MIGRATIONS_DIR must override everything.
    const candidates = buildMigrationsDirCandidates(SUB, {
      dbPkgRoot: "/a",
      currentDir: "/b/c/d",
      cwd: "/e",
      override: "/z",
    });
    expect(candidates).toEqual([
      "/z/drizzle-tenant",
      "/a/drizzle-tenant",
      "/b/db/drizzle-tenant", // /b/c/d/../../db = /b/db (two levels up)
      "/e/packages/db/drizzle-tenant",
    ]);
  });
});

describe("pickExistingMigrationsDir", () => {
  const SAMPLE = ["/override/x", "/db/x", "/hop/x", "/cwd/x"];

  it("returns the first candidate whose meta/_journal.json exists (via injected probe)", () => {
    // Simulate: override path has no migrations on disk, but DB_PKG_ROOT does.
    // Classic dev-vs-override conflict — the override must win ONLY if it
    // actually has the files, otherwise we fall through.
    const probe = (p: string) => p === "/db/x/meta/_journal.json";
    expect(pickExistingMigrationsDir(SAMPLE, probe)).toBe("/db/x");
  });

  it("selects the api→db hop candidate — the production-crash regression case", () => {
    // This models the exact bundled-API layout: the only place _journal.json
    // lives is the hop candidate. Must NOT fall through to the cwd fallback,
    // which may point at a stale path.
    const probe = (p: string) => p === "/hop/x/meta/_journal.json";
    expect(pickExistingMigrationsDir(SAMPLE, probe)).toBe("/hop/x");
  });

  it("returns the first candidate when none exist, so the error points at the expected path", () => {
    // Negative path: every probe fails. The function must NOT throw here —
    // it returns the primary candidate so drizzle's subsequent error message
    // names the path we expected, not the last-checked fallback. Changing
    // this contract would obscure misconfigured deploys.
    const probe = () => false;
    expect(pickExistingMigrationsDir(SAMPLE, probe)).toBe("/override/x");
  });

  it("honors the exact file probed — meta/_journal.json, not the directory", () => {
    // Regression guard: the check must be specific. A directory that exists
    // but lacks the journal file should NOT be selected.
    const calls: string[] = [];
    const probe = (p: string) => {
      calls.push(p);
      return false;
    };
    pickExistingMigrationsDir(["/only/one"], probe);
    expect(calls).toEqual(["/only/one/meta/_journal.json"]);
  });
});
