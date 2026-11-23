/**
 * tenant-test-dbs.ts: throwaway tenant databases for multi-tenant pool tests.
 *
 * Creates `count` empty databases on the test server (each with a tiny `kv`
 * table), registers each as an active row in the control database's `tenants`
 * table so `getTenantDb(id)` can resolve it, and cleans everything up. Nothing
 * outside the names it created is touched, so it is safe on the shared test
 * server.
 */
import postgres from "postgres";
import { randomBytes } from "node:crypto";

const quiet = () => {};

/**
 * Postgres refuses CREATE DATABASE while another session is using the template
 * (55006) and any connection when the server is momentarily full (53300). On a
 * server shared with other test workers both are transient, so retry them.
 */
async function transient<T>(fn: () => Promise<T>, attempts = 40, delayMs = 250): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: string }).code;
      if ((code !== "55006" && code !== "53300") || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export interface TenantTestDbs {
  /** Database names, index-aligned with `ids`. */
  names: string[];
  /** Tenant ids (rows in the control `tenants` table). */
  ids: string[];
  /** Connection URL for any database on the test server. */
  urlFor(database: string): string;
  /** Superuser connection to the server's `postgres` database. */
  admin: postgres.Sql;
  /** The server's `max_connections`, so tests can size what they hold open (and skip on a server too small for them). */
  maxConnections: number;
  /** Number of server connections currently open to any of these databases. */
  openConnections(): Promise<number>;
  cleanup(): Promise<void>;
}

export async function createTenantTestDbs(count: number): Promise<TenantTestDbs> {
  const controlUrl = process.env.CONTROL_DATABASE_URL!;
  const base = new URL(controlUrl);
  const urlFor = (database: string) => {
    const u = new URL(base.toString());
    u.pathname = `/${database}`;
    return u.toString();
  };
  const admin = postgres(urlFor("postgres"), { max: 1, onnotice: quiet });
  const control = postgres(controlUrl, { max: 1, onnotice: quiet });

  const [{ max_connections }] = await transient(() => admin`show max_connections`);
  const maxConnections = Number(max_connections);

  const suffix = randomBytes(4).toString("hex");
  const names: string[] = [];
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = `tp_${suffix}_${i}`;
    await transient(() => admin.unsafe(`CREATE DATABASE "${name}"`));
    names.push(name);
    await transient(async () => {
      const t = postgres(urlFor(name), { max: 1, onnotice: quiet });
      try {
        await t.unsafe(`CREATE TABLE kv (id serial PRIMARY KEY, v text NOT NULL)`);
      } finally {
        await t.end();
      }
    });
    const id = crypto.randomUUID();
    ids.push(id);
    await control`
      INSERT INTO tenants (id, name, slug, db_name, db_host, db_port, db_user, db_password, status)
      VALUES (${id}, ${name}, ${name}, ${name}, ${base.hostname}, ${base.port || "5432"},
              ${decodeURIComponent(base.username)}, ${decodeURIComponent(base.password)}, 'active')`;
  }

  return {
    names,
    ids,
    urlFor,
    admin,
    maxConnections,
    async openConnections() {
      const r = await admin`select count(*)::int as c from pg_stat_activity where datname like ${`tp\\_${suffix}\\_%`}`;
      return r[0].c as number;
    },
    async cleanup() {
      if (ids.length) await control`DELETE FROM tenants WHERE id IN ${control(ids)}`;
      for (const name of names) await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await control.end({ timeout: 2 });
      await admin.end({ timeout: 2 });
    },
  };
}
