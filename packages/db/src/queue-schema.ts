/**
 * Installs / upgrades the pg-boss job queue schema (docs/architecture/queue.md).
 *
 * Runs from the migration step only — the API and worker start pg-boss with
 * `migrate: false`, so neither ever changes the schema at runtime. pg-boss is
 * imported lazily so modules that merely import migrate.ts (the API bundle
 * inlines @hisaabo/db) don't load it.
 */

export const QUEUE_SCHEMA = "pgboss";

/** Install or upgrade the pgboss schema. Idempotent; returns the schema version. */
export async function installQueueSchema(connectionString: string): Promise<number | null> {
  const { PgBoss } = await import("pg-boss");
  const boss = new PgBoss({
    connectionString,
    schema: QUEUE_SCHEMA,
    application_name: "hisaabo-migrate",
    max: 2,
    migrate: true,
    createSchema: true,
    supervise: false,
    schedule: false,
    registerInstance: false,
  });
  let failure: unknown = null;
  boss.on("error", (err) => { failure ??= err; });
  try {
    await boss.start();
    if (failure) throw failure;
    return await boss.schemaVersion();
  } finally {
    await boss.stop({ graceful: false, close: true }).catch(() => {});
  }
}
