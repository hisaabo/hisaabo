/**
 * teardown.ts — Playwright globalTeardown: safety net for the per-worker
 * databases and the generated auth state.
 *
 * harness/stack.mjs already drops its databases when it is told to stop. This
 * covers the case where it was killed outright (SIGKILL after its grace period,
 * out-of-memory kill, ...) before it could. It runs on success, failure and
 * interrupt; E2E_KEEP_DB=1 keeps everything for debugging. Never touches the
 * template database (DATABASE_URL's own), only `<name>_w<k>`.
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { adminDatabaseUrl, baseDatabaseName, quoteIdent } from "./topology.cjs";

export default async function globalTeardown() {
  if (process.env.E2E_DEV === "1" || process.env.E2E_KEEP_DB === "1") return;

  // Per-worker databases (the dev stack, E2E_DEV=1, uses DATABASE_URL directly and creates none).
  const sql = postgres(adminDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    const base = baseDatabaseName();
    const stale = await sql<{ datname: string }[]>`
      select datname from pg_database
      where datname ~ ${`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_w[0-9]+$`}`;
    for (const { datname } of stale) {
      await sql.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(datname)} WITH (FORCE)`);
    }
  } catch (err) {
    console.error(`[e2e-teardown] could not drop worker databases: ${(err as Error).message}`);
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Session cookies / seed ids of the stacks that no longer exist.
  fs.rmSync(path.join(__dirname, "../.auth"), { recursive: true, force: true });
}
