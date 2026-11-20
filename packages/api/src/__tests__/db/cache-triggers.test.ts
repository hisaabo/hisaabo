import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  installCacheTriggers, verifyCacheTriggers, renderCacheTriggerMigration,
  CACHE_NOTIFY_CHANNEL, expectedCacheTriggers,
} from "@hisaabo/db";
import { createScratchControlDb, applyMigrationFile, DB_PKG, migrationFiles, type Scratch } from "./scratch-control-db";

describe("cache triggers: migration drift", () => {
  for (const dir of ["drizzle", "drizzle-control"] as const) {
    it(`${dir}/ cache trigger migration matches cache-triggers.ts`, () => {
      const f = migrationFiles(dir).find((n) => n.endsWith("_cache_invalidation_triggers.sql"));
      expect(f).toBeDefined();
      expect(readFileSync(resolve(DB_PKG, dir, f!), "utf-8")).toBe(renderCacheTriggerMigration());
    });
  }
  it("no payload-sensitive columns are passed to the notify function", () => {
    const all = expectedCacheTriggers.map((t) => t.body).join("\n");
    expect(all).not.toMatch(/'(key_hash|email|password|password_hash)'/);
    expect(all).not.toMatch(/ sessions FOR EACH ROW[^']*'id'/); // sessions.id is the secret token
    for (const t of expectedCacheTriggers.filter((x) => x.table === "sessions")) expect(t.body).not.toContain("'id'");
  });
});

describe("cache triggers: real database", () => {
  let scratch: Scratch;
  let listener: postgres.Sql;
  const received: Record<string, unknown>[] = [];

  beforeAll(async () => {
    // Previous schema (migrations 0000-0004), then apply the new ones.
    scratch = await createScratchControlDb(4);
    const pre = await scratch.sql`SELECT to_regclass('store_slugs') AS t`;
    expect(pre[0].t).toBeNull();
    for (const f of migrationFiles("drizzle-control").filter((n) => Number(n.slice(0, 4)) >= 5)) {
      await applyMigrationFile(scratch.sql, "drizzle-control", f);
    }
    listener = postgres(scratch.url, { max: 1, onnotice: () => {} });
    await listener.listen(CACHE_NOTIFY_CHANNEL, (p) => { received.push(JSON.parse(p)); });
  });
  afterAll(async () => {
    await listener?.end({ timeout: 2 });
    await scratch?.drop();
  });

  const settle = () => new Promise((r) => setTimeout(r, 250));

  it("migrations leave all triggers verified", async () => {
    expect(await verifyCacheTriggers(scratch.sql)).toEqual({ ok: true, missing: [] });
  });

  it("installCacheTriggers is idempotent; verify reports missing after drop", async () => {
    await installCacheTriggers(scratch.sql);
    await installCacheTriggers(scratch.sql);
    expect((await verifyCacheTriggers(scratch.sql)).ok).toBe(true);
    await scratch.sql.unsafe("DROP TRIGGER hisaabo_cache_users ON users");
    const v = await verifyCacheTriggers(scratch.sql);
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual(["users.hisaabo_cache_users"]);
    await installCacheTriggers(scratch.sql);
    expect((await verifyCacheTriggers(scratch.sql)).ok).toBe(true);
  });

  it("notifies on tenant_members update with ids only; last_used_at updates stay silent", async () => {
    const sql = scratch.sql;
    const [t] = await sql`INSERT INTO tenants (name, slug) VALUES ('T', ${"t-" + Math.random().toString(36).slice(2)}) RETURNING id`;
    const [u] = await sql`INSERT INTO users (email) VALUES (${Math.random() + "@x.test"}) RETURNING id`;
    const [m] = await sql`INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (${t.id}, ${u.id}, 'member') RETURNING id`;
    await settle();
    received.length = 0;

    await sql`UPDATE tenant_members SET role = 'admin' WHERE id = ${m.id}`;
    await settle();
    expect(received).toEqual([{ t: "tenant_members", op: "UPDATE", k: { tenant_id: t.id, user_id: u.id } }]);
    expect(JSON.stringify(received)).not.toMatch(/admin/);

    // hot paths: no notify
    received.length = 0;
    const sid = "secret-session-token-" + Math.random();
    await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${sid}, ${u.id}, now() + interval '1 day')`;
    await sql`INSERT INTO api_keys (user_id, tenant_id, key_hash, key_prefix, name) VALUES (${u.id}, ${t.id}, 'hash', 'pre', 'k')`;
    await settle();
    received.length = 0;
    await sql`UPDATE sessions SET last_used_at = now(), expires_at = now() + interval '2 days' WHERE id = ${sid}`;
    await sql`UPDATE api_keys SET last_used_at = now() WHERE user_id = ${u.id}`;
    await settle();
    expect(received).toEqual([]);

    // security-relevant: session expiry shortened, delete of live session, key revoke
    await sql`UPDATE sessions SET expires_at = now() + interval '1 hour' WHERE id = ${sid}`;
    await sql`DELETE FROM sessions WHERE id = ${sid}`;
    await sql`DELETE FROM api_keys WHERE user_id = ${u.id}`;
    await settle();
    expect(received.map((r) => r.t)).toEqual(["sessions", "sessions", "api_keys"]);
    expect(JSON.stringify(received)).not.toContain(sid);
    expect(JSON.stringify(received)).not.toContain("hash");

    // expired-session cleanup is silent
    received.length = 0;
    await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES ('old-' || ${Math.random()}, ${u.id}, now() - interval '1 day')`;
    await sql`DELETE FROM sessions WHERE expires_at < now()`;
    await settle();
    expect(received).toEqual([]);

    // rollback never notifies
    await sql.begin(async (tx) => {
      await tx`UPDATE tenant_members SET role = 'viewer' WHERE id = ${m.id}`;
      throw new Error("rollback");
    }).catch(() => {});
    await settle();
    expect(received).toEqual([]);
  });

  it("notifies on store_slugs insert/update/delete with slug only", async () => {
    const sql = scratch.sql;
    const [t] = await sql`INSERT INTO tenants (name, slug) VALUES ('T2', ${"t2-" + Math.random().toString(36).slice(2)}) RETURNING id`;
    received.length = 0;
    await sql`INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled) VALUES ('my-shop', ${t.id}, gen_random_uuid(), true)`;
    await sql`UPDATE store_slugs SET released_at = now() WHERE slug = 'my-shop'`;
    await sql`DELETE FROM store_slugs WHERE slug = 'my-shop'`;
    await settle();
    expect(received).toEqual([
      { t: "store_slugs", op: "INSERT", k: { slug: "my-shop" } },
      { t: "store_slugs", op: "UPDATE", k: { slug: "my-shop" } },
      { t: "store_slugs", op: "DELETE", k: { slug: "my-shop" } },
    ]);
  });

  it("store_slugs table: format CHECK, partial unique index scoped by tenant", async () => {
    const sql = scratch.sql;
    const mk = async (n: string) => (await sql`INSERT INTO tenants (name, slug) VALUES (${n}, ${n + Math.random().toString(36).slice(2)}) RETURNING id`)[0].id as string;
    const a = await mk("a"); const b = await mk("b");
    await expect(sql`INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled) VALUES ('Bad_Slug', ${a}, gen_random_uuid(), true)`).rejects.toThrow();
    const biz = (await sql`SELECT gen_random_uuid() AS id`)[0].id as string;
    await sql`INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled) VALUES ('shop-a1', ${a}, ${biz}, true)`;
    // same business_id in ANOTHER tenant must not conflict
    await sql`INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled) VALUES ('shop-b1', ${b}, ${biz}, true)`;
    // second live slug for same (tenant, business) conflicts
    await expect(sql`INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled) VALUES ('shop-a2', ${a}, ${biz}, true)`).rejects.toThrow();
    // released rows are exempt
    await sql`UPDATE store_slugs SET released_at = now() WHERE slug = 'shop-a1'`;
    await sql`INSERT INTO store_slugs (slug, tenant_id, business_id, store_enabled) VALUES ('shop-a2', ${a}, ${biz}, true)`;
    const idx = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'store_slugs' ORDER BY 1`;
    expect(idx.map((r) => r.indexname)).toEqual(["store_slugs_live_business_idx", "store_slugs_pkey"]);
  });
});
