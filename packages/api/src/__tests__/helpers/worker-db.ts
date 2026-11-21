/**
 * worker-db.ts — creating, wiping and dropping the per-worker test databases
 * (see worker-db-config.ts for the scheme). Used by global-setup.ts and by the
 * guard test that proves a clone equals the database it was cloned from.
 */
import postgres from "postgres";
import os from "node:os";
import {
  WORKER_DB_COMMENT_PREFIX,
  databaseNameOf,
  withDatabase,
} from "./worker-db-config.js";

const quote = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Short-lived superuser connection to a maintenance database on the same
 * server. `postgres` normally exists; `template1` is the fallback. NOT the
 * template itself: CREATE DATABASE ... TEMPLATE refuses while anyone is
 * connected to the template.
 */
export async function connectAdmin(templateUrl: string, max = 1): Promise<postgres.Sql> {
  let lastError: unknown;
  for (const maintenance of ["postgres", "template1"]) {
    const sql = postgres(withDatabase(templateUrl, maintenance), {
      max,
      idle_timeout: 0,
      connect_timeout: 10,
      onnotice: () => {},
    });
    try {
      await sql`select 1`;
      return sql;
    } catch (e) {
      lastError = e;
      await sql.end({ timeout: 1 }).catch(() => {});
    }
  }
  throw new Error(
    `Cannot connect to a maintenance database (postgres/template1) next to ${databaseNameOf(templateUrl)}: ${
      (lastError as Error)?.message ?? lastError
    }`,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * CREATE DATABASE <name> TEMPLATE <template>, retrying while another session
 * is still connected to the template (SQLSTATE 55006). Also tags the clone so
 * sweepStaleWorkerDatabases can recognise it.
 */
export async function cloneDatabase(
  admin: postgres.Sql,
  template: string,
  name: string,
  { attempts = 40, delayMs = 500 }: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await admin.unsafe(`CREATE DATABASE ${quote(name)} TEMPLATE ${quote(template)}`);
      break;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "55006" && i < attempts) {
        await sleep(delayMs);
        continue;
      }
      if (code === "55006") {
        throw new Error(
          `Cannot clone test database "${template}": other sessions are connected to it ` +
            `(Postgres only copies a template nobody is using). Stop whatever is running tests against it, ` +
            `or run with API_TEST_WORKERS=1 to use "${template}" directly.`,
        );
      }
      throw e;
    }
  }
  const owner = `${WORKER_DB_COMMENT_PREFIX} host=${os.hostname()} pid=${process.pid}`;
  await admin.unsafe(`COMMENT ON DATABASE ${quote(name)} IS ${literal(owner)}`);
}

/**
 * Remove every row from every table of the clone's `public` schema, so a
 * worker starts from the same state a freshly pushed schema has no matter what
 * earlier runs left behind in the template (the shared dev database collects
 * e.g. a system_config marker row). Schema objects, triggers and non-public
 * schemas (drizzle, pgboss) are left exactly as cloned.
 */
export async function wipePublicData(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, idle_timeout: 0, connect_timeout: 10, onnotice: () => {} });
  try {
    const tables = await sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public' order by tablename`;
    if (tables.length > 0) {
      await sql.unsafe(
        `TRUNCATE ${tables.map((t) => `public.${quote(t.tablename)}`).join(", ")} RESTART IDENTITY CASCADE`,
      );
    }
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/**
 * What global-setup.ts does for each worker slot: clone the template, then
 * wipe the clone's `public` data. One function so the guard test exercises
 * exactly the production path.
 */
export async function createWorkerDatabase(
  admin: postgres.Sql,
  templateUrl: string,
  template: string,
  name: string,
): Promise<void> {
  await cloneDatabase(admin, template, name);
  await wipePublicData(withDatabase(templateUrl, name));
}

export async function dropDatabase(admin: postgres.Sql, name: string): Promise<void> {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: exists but not ours — treat as alive.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Drop worker clones that a previous run leaked (killed with SIGKILL, power
 * loss...). Only databases that carry our comment marker, were made on THIS
 * host, and whose creating process is gone are touched, so a concurrent run's
 * live clones are never dropped.
 */
export async function sweepStaleWorkerDatabases(admin: postgres.Sql, template: string): Promise<string[]> {
  const rows = await admin<{ datname: string; comment: string }[]>`
    select d.datname, shobj_description(d.oid, 'pg_database') as comment
    from pg_database d
    where d.datname like ${template.replace(/[\\%_]/g, "\\$&") + "\\_w%"}`;
  const dropped: string[] = [];
  for (const r of rows) {
    const m = new RegExp(`^${WORKER_DB_COMMENT_PREFIX} host=(.+) pid=(\\d+)$`).exec(r.comment ?? "");
    if (!m || m[1] !== os.hostname() || pidAlive(Number(m[2]))) continue;
    await dropDatabase(admin, r.datname);
    dropped.push(r.datname);
  }
  return dropped;
}
