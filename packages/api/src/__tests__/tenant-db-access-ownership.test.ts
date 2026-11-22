/**
 * tenant-db-access-ownership.test.ts — the access pass must not report success
 * when it changed nothing.
 *
 * As a role that is neither the database owner nor a superuser, GRANT/REVOKE ON
 * DATABASE only emit a WARNING ("no privileges were granted/could be revoked")
 * and return success, leaving the ACL open. restrictExistingTenantDatabases
 * verifies the catalog after each database and counts such a database as
 * `failed`, with the reason.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { cleanupTenantDatabase, restrictExistingTenantDatabases, restrictTenantDatabaseAccess } from "@hisaabo/db";
import { createTenant } from "./helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "./helpers/test-db.js";

const controlUrl = process.env.CONTROL_DATABASE_URL!;
const control = new URL(controlUrl);
const controlDbName = control.pathname.slice(1);
const admin = postgres(Object.assign(new URL(controlUrl), { pathname: "/postgres" }).toString(), {
  max: 2,
  onnotice: () => {},
});

const id = randomBytes(4).toString("hex");
const ctl = { user: `ctl_nox_${id}`, password: randomBytes(12).toString("hex") };
const foreign = { dbName: `tenant_nox_f_${id}`, dbUser: `tenant_nox_f_${id}_user` }; // owned by the superuser
const owned = { dbName: `tenant_nox_o_${id}`, dbUser: `tenant_nox_o_${id}_user` }; // owned by the control role

/** The operator preflight query from docs/UPGRADING.md (keep in sync). */
const PREFLIGHT = `
  SELECT t.slug, t.db_name, pg_get_userbyid(d.datdba) AS owner
  FROM tenants t
  JOIN pg_database d ON d.datname = t.db_name
  WHERE NOT pg_has_role(current_user, d.datdba, 'USAGE')`;

const urlAs = (user: string, password: string, db: string) => {
  const u = new URL(controlUrl);
  u.username = user;
  u.password = password;
  u.pathname = `/${db}`;
  return u.toString();
};

async function publicEntries(db: string): Promise<number> {
  const rows = await admin`
    SELECT a.privilege_type FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
    WHERE d.datname = ${db} AND a.grantee = 0`;
  return rows.length;
}

beforeAll(async () => {
  await truncateAllTables();
  await admin.unsafe(`CREATE USER "${ctl.user}" WITH PASSWORD '${ctl.password}'`);
  for (const t of [foreign, owned]) await admin.unsafe(`CREATE USER "${t.dbUser}"`);
  await admin.unsafe(`CREATE DATABASE "${foreign.dbName}"`);
  await admin.unsafe(`CREATE DATABASE "${owned.dbName}" OWNER "${ctl.user}"`);
  // the pass reads `tenants` as the control role
  await getControlDb().execute(sql`GRANT SELECT ON tenants TO ${sql.identifier(ctl.user)}`);
  const base = { dbHost: control.hostname, dbPort: control.port || "5432" };
  await createTenant({ slug: "nox-foreign", dbName: foreign.dbName, dbUser: foreign.dbUser, dbPassword: "x", ...base });
  await createTenant({ slug: "nox-owned", dbName: owned.dbName, dbUser: owned.dbUser, dbPassword: "x", ...base });
}, 30_000);

afterAll(async () => {
  await getControlDb().execute(sql`REVOKE SELECT ON tenants FROM ${sql.identifier(ctl.user)}`).catch(() => {});
  for (const t of [foreign, owned]) await cleanupTenantDatabase(t.dbName, t.dbUser);
  await admin.unsafe(`DROP USER IF EXISTS "${ctl.user}"`);
  await admin.end({ timeout: 2 });
  await truncateAllTables();
  await closeTestDb();
});

describe("the control role does not own the database", () => {
  it("the preflight query lists exactly the databases the control role cannot act as owner of", async () => {
    const asCtl = postgres(urlAs(ctl.user, ctl.password, controlDbName), { max: 1, onnotice: () => {} });
    try {
      const rows = await asCtl.unsafe(PREFLIGHT);
      expect(rows.map((r) => r.db_name)).toEqual([foreign.dbName]);
      expect(rows[0]!.owner).toBe(control.username);
    } finally {
      await asCtl.end({ timeout: 2 });
    }
    // a superuser/owner role gets no rows
    expect(await getControlDb().execute(sql.raw(PREFLIGHT))).toHaveLength(0);
  });

  it("restrictTenantDatabaseAccess throws instead of returning when the privilege change had no effect", async () => {
    const asCtl = postgres(urlAs(ctl.user, ctl.password, "postgres"), { max: 1, onnotice: () => {} });
    try {
      expect(await publicEntries(foreign.dbName)).toBeGreaterThan(0);
      await expect(restrictTenantDatabaseAccess(asCtl, foreign.dbName, foreign.dbUser)).rejects.toThrow(/PUBLIC can still connect/);
      expect(await publicEntries(foreign.dbName)).toBeGreaterThan(0);
      // a database the role owns works
      await expect(restrictTenantDatabaseAccess(asCtl, owned.dbName, owned.dbUser)).resolves.toBeUndefined();
    } finally {
      await asCtl.end({ timeout: 2 });
    }
  });

  it("the pass counts the database it could not change as failed, with the reason, and the one it owns as restricted", async () => {
    // reopen the owned database so the pass has something to do
    await admin.unsafe(`GRANT CONNECT, TEMPORARY ON DATABASE "${owned.dbName}" TO PUBLIC`);

    const report = await restrictExistingTenantDatabases({ controlUrl: urlAs(ctl.user, ctl.password, controlDbName) });

    expect(report).toMatchObject({ total: 2, restricted: 1, failed: 1 });
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]!.slug).toBe("nox-foreign");
    expect(report.failures[0]!.error).toMatch(/PUBLIC can still connect/);
    expect(report.failures[0]!.error).toMatch(/neither the database owner/);
    // what the report says is what the catalog says
    expect(await publicEntries(foreign.dbName)).toBeGreaterThan(0);
    expect(await publicEntries(owned.dbName)).toBe(0);
  });
});
