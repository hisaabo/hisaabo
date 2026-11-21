/**
 * Guard for the per-worker test database scheme (helpers/worker-db-config.ts).
 *
 * The API suite runs files in parallel, each worker against a clone of the
 * `db:push`-ed test database. Those clones are only a valid replacement for
 * "the pushed database" if they are indistinguishable from it: same schema,
 * same triggers/functions/enums, and no rows. This file proves that by
 * comparing the Postgres catalogs row for row, and that each worker really is
 * talking to its own clone.
 */
import { describe, it, expect, afterAll, inject } from "vitest";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import {
  databaseNameOf,
  templateDatabaseUrl,
  withDatabase,
  workerDbName,
} from "../helpers/worker-db-config.js";
import { connectAdmin, createWorkerDatabase, dropDatabase } from "../helpers/worker-db.js";

type Row = Record<string, unknown>;
type Snapshot = Record<string, Row[]>;

const NON_SYSTEM = `n.nspname !~ '^pg_' and n.nspname <> 'information_schema'`;

/** Every structural object a "freshly pushed schema" consists of, in a stable order. */
const STRUCTURE_QUERIES: Record<string, string> = {
  schemas: `
    select n.nspname from pg_namespace n where ${NON_SYSTEM} order by 1`,
  relations: `
    select n.nspname, c.relname, c.relkind::text, c.relpersistence::text, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where ${NON_SYSTEM} and c.relkind in ('r','p','v','m','S','f') order by 1, 2`,
  columns: `
    select n.nspname, c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) as type,
           a.attnotnull, pg_get_expr(d.adbin, d.adrelid) as "default", a.attidentity::text, a.attgenerated::text
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where ${NON_SYSTEM} and c.relkind in ('r','p','v','m','f') and a.attnum > 0 and not a.attisdropped
    order by 1, 2, 3`,
  indexes: `
    select schemaname, tablename, indexname, indexdef from pg_indexes
    where schemaname !~ '^pg_' and schemaname <> 'information_schema' order by 1, 2, 3`,
  constraints: `
    select n.nspname, conrelid::regclass::text as rel, con.conname, con.contype::text,
           pg_get_constraintdef(con.oid) as def, con.condeferrable, con.condeferred, con.convalidated
    from pg_constraint con join pg_namespace n on n.oid = con.connamespace
    where ${NON_SYSTEM} order by 1, 2, 3`,
  enums: `
    select n.nspname, t.typname, e.enumsortorder::float8 as sort, e.enumlabel
    from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
    where ${NON_SYSTEM} order by 1, 2, 3`,
  domains: `
    select n.nspname, t.typname, format_type(t.typbasetype, t.typtypmod) as base, t.typnotnull
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where ${NON_SYSTEM} and t.typtype = 'd' order by 1, 2`,
  sequences: `
    select schemaname, sequencename, data_type::text, start_value, min_value, max_value, increment_by, cycle, cache_size
    from pg_sequences where schemaname !~ '^pg_' and schemaname <> 'information_schema' order by 1, 2`,
  views: `
    select schemaname, viewname, definition from pg_views
    where schemaname !~ '^pg_' and schemaname <> 'information_schema' order by 1, 2`,
  extensions: `select extname, extversion from pg_extension order by 1`,
};

/** Objects tests themselves install into a worker database (ensureCacheTriggers, ensureQueueSchema). */
const INSTALLED_OBJECT_QUERIES: Record<string, string> = {
  triggers: `
    select tgrelid::regclass::text as rel, tgname, pg_get_triggerdef(oid) as def, tgenabled::text
    from pg_trigger where not tgisinternal order by 1, 2`,
  functions: `
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where ${NON_SYSTEM} and p.prokind in ('f','p') order by 1, 2, 3`,
};

async function snapshot(sql: postgres.Sql, queries: Record<string, string>): Promise<Snapshot> {
  const out: Snapshot = {};
  for (const [name, q] of Object.entries(queries)) {
    out[name] = (await sql.unsafe(q)) as unknown as Row[];
  }
  return out;
}

/** Exact row count of every table outside the system schemas, keyed "schema.table". */
async function rowCounts(sql: postgres.Sql): Promise<Record<string, number>> {
  const tables = await sql<{ schema: string; name: string }[]>`
    select n.nspname as schema, c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and c.relkind in ('r','p')
    order by 1, 2`;
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const [r] = await sql.unsafe(`select count(*)::int as n from "${t.schema}"."${t.name}"`);
    counts[`${t.schema}.${t.name}`] = r.n as number;
  }
  return counts;
}

/** Open a short-lived connection, run fn, always close. */
async function withDb<T>(url: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(url, { max: 1, idle_timeout: 0, connect_timeout: 10, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 2 });
  }
}

describe("per-worker test database", () => {
  const plan = inject("hisaaboWorkerDbs");

  it("this worker's connection settings all point at its own database", async () => {
    const current = await withDb(process.env.DATABASE_URL!, async (sql) => (await sql`select current_database() as db`)[0].db as string);
    const expected = plan
      ? workerDbName(plan, process.env.VITEST_POOL_ID!)
      : databaseNameOf(templateDatabaseUrl());
    expect(current).toBe(expected);
    for (const key of ["DATABASE_URL", "CONTROL_DATABASE_URL", "TEST_DATABASE_URL"] as const) {
      expect(databaseNameOf(process.env[key]!), key).toBe(expected);
    }
    if (plan) {
      // A clone, never the template itself: nobody may run tests against the template while others clone it.
      expect(current).not.toBe(plan.template);
      expect(current.startsWith(`${plan.template}_w`)).toBe(true);
    }
  });

  // API_TEST_WORKERS=1: nothing is cloned (the test above already proved the worker uses the
  // configured database itself), so there is no clone to compare.
  if (!plan) return;

  describe("clone equals the database it was cloned from", () => {
    const cloneName = `${plan.template}_guard_${randomBytes(3).toString("hex")}`;
    let admin: postgres.Sql;
    let template: Snapshot;
    let clone: Snapshot;
    let templateCounts: Record<string, number>;
    let cloneCounts: Record<string, number>;

    afterAll(async () => {
      if (!admin) return;
      await dropDatabase(admin, cloneName);
      await admin.end({ timeout: 2 });
    });

    it("builds a fresh clone the way global-setup does and reads both catalogs", async () => {
      const templateUrl = withDatabase(templateDatabaseUrl(), plan!.template);
      admin = await connectAdmin(templateUrl);
      // Same function global-setup.ts calls for every worker slot.
      await createWorkerDatabase(admin, templateUrl, plan!.template, cloneName);

      const cloneUrl = withDatabase(templateUrl, cloneName);
      clone = await withDb(cloneUrl, async (sql) => ({
        ...(await snapshot(sql, STRUCTURE_QUERIES)),
        ...(await snapshot(sql, INSTALLED_OBJECT_QUERIES)),
      }));
      cloneCounts = await withDb(cloneUrl, rowCounts);
      // Template last: it is read-only here and other runs retry cloning while we are connected.
      [template, templateCounts] = await withDb(templateUrl, async (sql) => [
        { ...(await snapshot(sql, STRUCTURE_QUERIES)), ...(await snapshot(sql, INSTALLED_OBJECT_QUERIES)) },
        await rowCounts(sql),
      ] as const);

      // The comparison below is meaningless on an empty catalog.
      expect(template.columns.length).toBeGreaterThan(100);
      expect(template.indexes.length).toBeGreaterThan(50);
      expect(template.constraints.length).toBeGreaterThan(50);
    });

    for (const key of [...Object.keys(STRUCTURE_QUERIES), ...Object.keys(INSTALLED_OBJECT_QUERIES)]) {
      it(`catalog "${key}" is identical, row for row`, () => {
        expect(clone[key]).toEqual(template[key]);
      });
    }

    it("has the same set of tables as the template", () => {
      expect(Object.keys(cloneCounts)).toEqual(Object.keys(templateCounts));
    });

    it("has zero rows in every pushed (public) table", () => {
      const nonEmpty = Object.entries(cloneCounts).filter(([t, n]) => t.startsWith("public.") && n > 0);
      expect(nonEmpty).toEqual([]);
    });

    it("keeps non-public schemas (migration metadata, queue schema) exactly as cloned", () => {
      const pick = (c: Record<string, number>) =>
        Object.fromEntries(Object.entries(c).filter(([t]) => !t.startsWith("public.")));
      expect(pick(cloneCounts)).toEqual(pick(templateCounts));
    });

    it("this worker's own database has the template's pushed schema", async () => {
      // Tables, columns, indexes, constraints and enums of the live worker database. Triggers/functions
      // and the queue schema are excluded: suites install those into their worker database on demand.
      const live = await withDb(process.env.DATABASE_URL!, (sql) => snapshot(sql, STRUCTURE_QUERIES));
      const inPublic = (r: Row) => (r.nspname ?? r.schemaname) === "public";
      for (const key of ["relations", "columns", "indexes", "constraints", "enums", "sequences"]) {
        expect(live[key].filter(inPublic), key).toEqual(template[key].filter(inPublic));
      }
    });
  });
});
