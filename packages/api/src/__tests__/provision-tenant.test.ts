/**
 * provision-tenant.test.ts — safety of tenant DB provisioning.
 *
 *  - scramSha256Verifier produces a valid Postgres verifier (never plaintext in SQL)
 *  - a failed provisioning never drops a pre-existing database or role
 *  - multi-tenant provisioning refuses to run without an encryption key
 */
import { describe, it, expect, afterEach } from "vitest";
import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { provisionTenantDatabase, scramSha256Verifier } from "@hisaabo/db";

const adminUrl = new URL(process.env.CONTROL_DATABASE_URL!);
adminUrl.pathname = "/postgres";
const admin = postgres(adminUrl.toString(), { max: 2, onnotice: () => {} });

const suffix = randomBytes(4).toString("hex");
const ENV_KEYS = ["MULTI_TENANT", "ENCRYPTION_KEY", "DB_ENCRYPTION_KEY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function dbExists(name: string) {
  const r = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  return r.length > 0;
}
async function roleExists(name: string) {
  const r = await admin`SELECT 1 FROM pg_roles WHERE rolname = ${name}`;
  return r.length > 0;
}

describe("scramSha256Verifier", () => {
  it("has the Postgres SCRAM-SHA-256 verifier format", () => {
    const v = scramSha256Verifier("pw");
    expect(v).toMatch(/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(v).not.toContain("pw$");
    expect(scramSha256Verifier("pw")).not.toBe(v); // random salt
  });

  it("lets a role created with the verifier authenticate with the plaintext password", async () => {
    const role = `scram_test_${suffix}`;
    const password = randomBytes(32).toString("base64url");
    const verifier = scramSha256Verifier(password);
    await admin.unsafe(`CREATE USER "${role}" WITH PASSWORD '${verifier}'`);
    try {
      // Postgres stores a well-formed verifier as-is (a malformed one would be
      // treated as plaintext and re-hashed with a different salt).
      const stored = await admin`SELECT rolpassword FROM pg_authid WHERE rolname = ${role}`;
      expect(stored[0].rolpassword).toBe(verifier);

      const u = new URL(adminUrl.toString());
      u.username = role;
      u.password = password;
      const asRole = postgres(u.toString(), { max: 1, onnotice: () => {} });
      try {
        const [row] = await asRole`SELECT current_user AS u`;
        expect(row.u).toBe(role);
      } finally {
        await asRole.end();
      }
      // NOTE: the connect above only proves SCRAM auth when pg_hba.conf enforces
      // scram-sha-256 for TCP; the local test server uses `trust`, in which case
      // the pg_authid equality check above is the real proof.
    } finally {
      await admin.unsafe(`DROP USER IF EXISTS "${role}"`);
    }
  });
});

describe("provisionTenantDatabase failure safety", () => {
  it("does not drop a pre-existing database when CREATE DATABASE fails", async () => {
    const slug = `pre${suffix}`;
    const dbName = `tenant_${slug}`;
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    try {
      await expect(provisionTenantDatabase("t1", slug)).rejects.toThrow();
      expect(await dbExists(dbName)).toBe(true);
      expect(await roleExists(`${dbName}_user`)).toBe(false);
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    }
  });

  it("does not drop a pre-existing role when CREATE USER fails, but removes the DB it created", async () => {
    const slug = `rol${suffix}`;
    const dbName = `tenant_${slug}`;
    const user = `${dbName}_user`;
    await admin.unsafe(`CREATE USER "${user}" WITH PASSWORD 'x'`);
    try {
      await expect(provisionTenantDatabase("t2", slug)).rejects.toThrow();
      expect(await roleExists(user)).toBe(true);
      expect(await dbExists(dbName)).toBe(false);
    } finally {
      await admin.unsafe(`DROP USER IF EXISTS "${user}"`);
    }
  });

  it("refuses to provision in multi-tenant mode without an encryption key", async () => {
    process.env.MULTI_TENANT = "true";
    delete process.env.ENCRYPTION_KEY;
    delete process.env.DB_ENCRYPTION_KEY;
    const slug = `nok${suffix}`;
    await expect(provisionTenantDatabase("t3", slug)).rejects.toThrow(/ENCRYPTION_KEY/);
    expect(await dbExists(`tenant_${slug}`)).toBe(false);
  });
});
