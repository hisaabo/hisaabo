/**
 * Who may connect to a tenant database.
 *
 * `CREATE DATABASE` grants CONNECT and TEMPORARY on the new database to PUBLIC
 * (every role in the cluster). Left alone, every tenant's role can therefore
 * open a session on every other tenant's database. Row data is still protected
 * by table privileges, but the open door exposes catalog metadata, lets a role
 * create temp tables and consume connections in a neighbour's database, and
 * removes a defence layer that the one-database-per-tenant design is meant to
 * provide.
 *
 * Two entry points close it:
 *   - restrictTenantDatabaseAccess(): called by provisionTenantDatabase for each
 *     NEW tenant database.
 *   - restrictExistingTenantDatabases(): idempotent pass over every database
 *     listed in `tenants`; run by the migration step so databases provisioned
 *     before 0.10.1 are closed too.
 *
 * Roles that keep access afterwards:
 *   - the tenant's own role (explicit GRANT, done here);
 *   - the database owner, which is the control/migration role that ran
 *     CREATE DATABASE (an owner keeps its own privileges), and any superuser.
 * Any other role an operator uses to reach a tenant database (backup, BI,
 * monitoring) now needs an explicit `GRANT CONNECT ON DATABASE ...`.
 */

import postgres from "postgres";

type LogFn = (level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void;

const SAFE_IDENT = /^[a-z0-9_]+$/;

/** Advisory lock id serialising passes (concurrent GRANT/REVOKE on one pg_database row can fail). */
export const TENANT_DB_ACCESS_LOCK_ID = 72919285;

/**
 * GRANT the tenant's own role CONNECT + TEMPORARY, then REVOKE both from PUBLIC.
 * Both run in one implicit transaction (a single simple-protocol round trip)
 * and the GRANT comes first, so the tenant role never loses access, even while
 * its application is connected to a live database. Idempotent.
 *
 * Works from a connection to ANY database in the cluster: privileges on a
 * database live in the shared catalog. Must run as the database owner (or a
 * member of the owning role) or a superuser. Both identifiers are re-validated
 * here because they are interpolated into SQL.
 *
 * The result is VERIFIED against the catalog, not assumed: a role that is
 * neither owner nor superuser gets only a WARNING ("no privileges were
 * granted/could be revoked") and a successful return, with the ACL unchanged.
 * So after the statement this throws unless the tenant role can CONNECT and no
 * PUBLIC entry is left in the ACL.
 */
export async function restrictTenantDatabaseAccess(
  sql: postgres.Sql,
  dbName: string,
  dbUser: string,
): Promise<void> {
  if (!SAFE_IDENT.test(dbName) || !SAFE_IDENT.test(dbUser)) {
    throw new Error("Refusing to change database privileges: unsafe identifier");
  }
  await sql.unsafe(
    `GRANT CONNECT, TEMPORARY ON DATABASE "${dbName}" TO "${dbUser}"; ` +
      `REVOKE CONNECT, TEMPORARY ON DATABASE "${dbName}" FROM PUBLIC`,
  );
  const problem = await verifyDatabaseAccess(sql, dbName, dbUser);
  if (problem) throw new Error(problem);
}

/**
 * Checks the catalog: PUBLIC must hold nothing on the database (a NULL `datacl`
 * means the default ACL, which includes PUBLIC CONNECT/TEMPORARY) and, when
 * `dbUser` is given, that role must be able to CONNECT. Returns a reason, or
 * null when the database is closed as intended.
 */
async function verifyDatabaseAccess(
  sql: postgres.Sql,
  dbName: string,
  dbUser: string | null,
): Promise<string | null> {
  const [row] = await sql<{ owner: string; public_open: boolean }[]>`
    SELECT pg_get_userbyid(d.datdba) AS owner,
           EXISTS (
             SELECT 1 FROM aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a WHERE a.grantee = 0
           ) AS public_open
    FROM pg_database d WHERE d.datname = ${dbName}::name`;
  if (!row) return `database "${dbName}" not found in pg_database after the privilege change`;
  if (row.public_open) {
    return (
      `PUBLIC can still connect to "${dbName}": the privilege change had no effect. Postgres only warns when the ` +
      `connected role is neither the database owner ("${row.owner}") nor a superuser; run as the owner or a superuser`
    );
  }
  if (dbUser) {
    const [r] = await sql<{ ok: boolean }[]>`SELECT has_database_privilege(${dbUser}::name, ${dbName}::name, 'CONNECT') AS ok`;
    if (!r?.ok) return `role "${dbUser}" cannot CONNECT to "${dbName}" after the privilege change`;
  }
  return null;
}

export interface TenantDbAccessReport {
  /** Tenants that have a database (`db_name` set). */
  total: number;
  /** Databases verified closed to PUBLIC with the tenant role able to connect (including ones that already were). */
  restricted: number;
  /** Rows skipped: no `db_user`, so there is no role to keep access for. */
  skipped: number;
  /** Rows whose database no longer exists: nothing to restrict. */
  missing: number;
  /** Databases that could not be restricted, or where the change had no effect (see `failures`). */
  failed: number;
  failures: { tenantId: string; slug: string; error: string }[];
}

interface TenantAccessRow {
  id: string;
  slug: string;
  db_name: string | null;
  db_host: string | null;
  db_port: string | null;
  db_user: string | null;
}

const sqlState = (err: unknown): string | undefined => (err as { code?: string } | null)?.code;

/**
 * Connection string for the control credentials against `host:port`. Reuses
 * the control URL as-is (its database, query parameters) when the tenant lives
 * on the same server, otherwise the `postgres` maintenance database there, the
 * same database provisioning uses.
 */
function adminUrlFor(controlUrl: string, host: string, port: string): string {
  const u = new URL(controlUrl);
  const sameServer = u.hostname === host && (u.port || "5432") === port;
  if (!sameServer) {
    u.hostname = host;
    u.port = port;
    u.pathname = "/postgres";
  }
  return u.toString();
}

/**
 * Close every database listed in `tenants` to PUBLIC and keep access for its
 * own role (see the file header). Safe to re-run: REVOKE of an absent grant and
 * GRANT of a held one are no-ops. Per-database failures are collected, never
 * thrown, so one broken tenant cannot stop the others (or the boot).
 *
 * Uses one connection per distinct database server, not one per tenant. A
 * session-level advisory lock on the control database serialises concurrent
 * runs (several replicas booting together).
 */
export async function restrictExistingTenantDatabases(opts: {
  controlUrl: string;
  logger?: LogFn;
}): Promise<TenantDbAccessReport> {
  const log: LogFn = opts.logger ?? (() => {});
  const report: TenantDbAccessReport = {
    total: 0, restricted: 0, skipped: 0, missing: 0, failed: 0, failures: [],
  };

  const control = postgres(opts.controlUrl, {
    max: 1, idle_timeout: 0, connect_timeout: 15, onnotice: () => {},
  });
  const servers = new Map<string, postgres.Sql>();
  let locked = false;
  try {
    await control`SELECT pg_advisory_lock(${TENANT_DB_ACCESS_LOCK_ID})`;
    locked = true;

    const rows = await control<TenantAccessRow[]>`
      SELECT id, slug, db_name, db_host, db_port, db_user
      FROM tenants
      WHERE db_name IS NOT NULL
      ORDER BY created_at, id
    `;
    report.total = rows.length;

    for (const t of rows) {
      const fail = (error: string) => {
        report.failed++;
        report.failures.push({ tenantId: t.id, slug: t.slug, error });
        log("error", "tenant database access: could not restrict database", { tenantId: t.id, slug: t.slug, error });
      };

      if (!t.db_user) {
        report.skipped++;
        log("warn", "tenant database access: tenant has no db_user, left unchanged", { tenantId: t.id, slug: t.slug });
        continue;
      }
      if (!SAFE_IDENT.test(t.db_name!) || !SAFE_IDENT.test(t.db_user)) {
        fail("database or role name contains characters outside [a-z0-9_]");
        continue;
      }

      let server: postgres.Sql;
      try {
        const host = t.db_host || "localhost";
        const port = t.db_port || "5432";
        if (!/^[a-zA-Z0-9.-]+$/.test(host) || !/^\d{1,5}$/.test(port)) {
          throw new Error(`invalid host or port: ${host}:${port}`);
        }
        const key = `${host}:${port}`;
        let existing = servers.get(key);
        if (!existing) {
          existing = postgres(adminUrlFor(opts.controlUrl, host, port), {
            max: 1, idle_timeout: 0, connect_timeout: 15, onnotice: () => {},
          });
          servers.set(key, existing);
        }
        server = existing;
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
        continue;
      }

      try {
        await restrictTenantDatabaseAccess(server, t.db_name!, t.db_user);
        report.restricted++;
      } catch (err) {
        const code = sqlState(err);
        if (code === "3D000") {
          // invalid_catalog_name: the database was dropped; nothing to restrict.
          report.missing++;
          log("warn", "tenant database access: database does not exist, skipped", { tenantId: t.id, slug: t.slug });
        } else if (code === "42704") {
          // undefined_object: the tenant's role is gone, so nobody legitimate
          // needs the PUBLIC door; close it anyway.
          try {
            await server.unsafe(`REVOKE CONNECT, TEMPORARY ON DATABASE "${t.db_name}" FROM PUBLIC`);
            const problem = await verifyDatabaseAccess(server, t.db_name!, null);
            if (problem) {
              fail(problem);
            } else {
              report.restricted++;
              log("warn", "tenant database access: tenant role does not exist, closed to PUBLIC only", { tenantId: t.id, slug: t.slug });
            }
          } catch (err2) {
            fail(err2 instanceof Error ? err2.message : String(err2));
          }
        } else {
          fail(err instanceof Error ? err.message : String(err));
        }
      }
    }
  } finally {
    await Promise.all([...servers.values()].map((s) => s.end({ timeout: 5 }).catch(() => {})));
    if (locked) await control`SELECT pg_advisory_unlock(${TENANT_DB_ACCESS_LOCK_ID})`.catch(() => {});
    await control.end({ timeout: 5 }).catch(() => {});
  }

  return report;
}
