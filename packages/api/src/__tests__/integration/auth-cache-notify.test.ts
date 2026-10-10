/**
 * Cross-process path: a writer that is NOT this process (CLI, manual SQL,
 * another replica) changes control-DB rows on a SEPARATE connection. The DB
 * triggers NOTIFY, the cache listener applies the event, and the very next
 * call in this process sees the change — without any in-process invalidation.
 *
 * Needs the triggers (CI builds the DB with `db:push`): ensureCacheTriggers().
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { createHash, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { apiKeys, sessions } from "@hisaabo/db";
import { createUser, createTenant, addMember, createBusiness, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb, ensureCacheTriggers } from "../helpers/test-db.js";
import { createContext } from "../../context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { startCacheListener, type CacheListener } from "../../lib/cache/index.js";
import { membershipCache } from "../../lib/authz.js";

const factory = createCallerFactory(appRouter);
const URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;

let tenant: TestTenant;
let biz: TestBusiness;
let listener: CacheListener;
let external: ReturnType<typeof postgres>; // "the CLI": a second, independent connection

async function as(auth: { cookie?: string; bearer?: string }) {
  const headers = new Headers({ "x-requested-with": "hisaabo", "x-business-id": biz.id });
  if (auth.cookie) headers.set("cookie", `session_id=${auth.cookie}`);
  if (auth.bearer) headers.set("authorization", `Bearer ${auth.bearer}`);
  const req = new Request("http://localhost:3000/api/trpc/x", { method: "POST", headers });
  return factory(await createContext({ req, resHeaders: new Headers(), info: {} as never }));
}

async function insertSession(userId: string, tenantId: string): Promise<string> {
  const id = nanoid(64);
  await getControlDb().insert(sessions).values({
    id,
    userId,
    tenantId,
    authMethod: "cookie",
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });
  return id;
}

async function member(role: "admin" | "accountant" | "owner" = "admin") {
  const user = await createUser();
  await addMember(tenant.id, user.id, role);
  return { user, session: await insertSession(user.id, tenant.id) };
}

/** Poll until `probe` stops throwing / returns true (NOTIFY is async, ms-scale). */
async function eventually(probe: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await probe().catch(() => false)) return;
    if (Date.now() > end) throw new Error("condition not reached before timeout (NOTIFY not delivered?)");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const rejectsWith = async (p: Promise<unknown>, code: string) =>
  p.then(
    () => false,
    (e: { code?: string }) => e.code === code,
  );

const partyInput = { type: "customer" as const, name: "Notify Party" };

beforeAll(async () => {
  await ensureCacheTriggers();
  tenant = await createTenant({ plan: "business" });
  const owner = await createUser();
  await addMember(tenant.id, owner.id, "owner");
  biz = await createBusiness(getTenantTestDb(), owner.id);
  external = postgres(URL, { max: 1, onnotice: () => {} });
  listener = await startCacheListener({ connectionString: URL, watchdogIntervalMs: 60_000 });
  expect(listener.healthy()).toBe(true);
});

afterAll(async () => {
  await listener?.stop();
  await external?.end({ timeout: 1 });
  await truncateAllTables();
  await closeTestDb();
});

describe("external writes invalidate caches via NOTIFY (no in-process call)", () => {
  it("tenant_members role UPDATE -> permission denied on a following call", async () => {
    const { user, session } = await member("admin");
    await expect((await as({ cookie: session })).party.create(partyInput)).resolves.toBeTruthy(); // warm
    expect(membershipCache.get(`${tenant.id}:${user.id}`)?.role).toBe("admin");

    await external`update tenant_members set role = 'accountant' where tenant_id = ${tenant.id} and user_id = ${user.id}`;

    await eventually(async () => rejectsWith((await as({ cookie: session })).party.create(partyInput), "FORBIDDEN"));
  });

  it("tenant_members DELETE -> FORBIDDEN on a following call", async () => {
    const { user, session } = await member("admin");
    await expect((await as({ cookie: session })).party.list({ page: 1, limit: 5 })).resolves.toBeTruthy();
    await external`delete from tenant_members where tenant_id = ${tenant.id} and user_id = ${user.id}`;
    await eventually(async () => !membershipCache.get(`${tenant.id}:${user.id}`));
    await expect((await as({ cookie: session })).party.list({ page: 1, limit: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("tenants.status UPDATE -> 'Organization is not active'", async () => {
    const t = await createTenant({ plan: "business" });
    const u = await createUser();
    await addMember(t.id, u.id, "owner");
    const b = await createBusiness(getTenantTestDb(), u.id);
    const s = await insertSession(u.id, t.id);
    const call = async () => {
      const headers = new Headers({ "x-requested-with": "hisaabo", "x-business-id": b.id, cookie: `session_id=${s}` });
      const req = new Request("http://localhost:3000/api/trpc/x", { method: "POST", headers });
      return factory(await createContext({ req, resHeaders: new Headers(), info: {} as never }));
    };
    await expect((await call()).party.list({ page: 1, limit: 5 })).resolves.toBeTruthy();
    await external`update tenants set status = 'suspended' where id = ${t.id}`;
    await eventually(async () => rejectsWith((await call()).party.list({ page: 1, limit: 5 }), "FORBIDDEN"));
  });

  it("sessions DELETE -> session UNAUTHORIZED on a following call", async () => {
    const { session } = await member("admin");
    await expect((await as({ cookie: session })).tenant.list()).resolves.toBeTruthy();
    await external`delete from sessions where id = ${session}`;
    await eventually(async () => rejectsWith((await as({ cookie: session })).tenant.list(), "UNAUTHORIZED"));
  });

  it("api_keys DELETE -> key UNAUTHORIZED on a following call", async () => {
    const { user } = await member("admin");
    const raw = `hisaabo_key_${randomBytes(32).toString("base64url")}`;
    const [row] = await getControlDb()
      .insert(apiKeys)
      .values({
        userId: user.id,
        tenantId: tenant.id,
        keyHash: createHash("sha256").update(raw).digest("hex"),
        keyPrefix: raw.slice(0, 20),
        name: "cli",
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning({ id: apiKeys.id });
    await expect((await as({ bearer: raw })).tenant.list()).resolves.toBeTruthy();
    await external`delete from api_keys where id = ${row!.id}`;
    await eventually(async () => rejectsWith((await as({ bearer: raw })).tenant.list(), "UNAUTHORIZED"));
  });

  it("users.name / users.email UPDATE -> every session sees it", async () => {
    const { user, session } = await member("admin");
    expect((await (await as({ cookie: session })).auth.me()).user?.name).toBe("Test User");
    await external`update users set name = 'CLI Renamed', email = ${`cli.${user.id.slice(0, 8)}@example.in`} where id = ${user.id}`;
    await eventually(async () => (await (await as({ cookie: session })).auth.me()).user?.name === "CLI Renamed");
    expect((await (await as({ cookie: session })).auth.me()).user?.email).toBe(`cli.${user.id.slice(0, 8)}@example.in`);
  });

  it("system_config maintenance upsert (the CLI) -> blocked on a following call, without waiting 30s", async () => {
    const { session } = await member("admin");
    await expect((await as({ cookie: session })).party.list({ page: 1, limit: 5 })).resolves.toBeTruthy();
    await external`insert into system_config (key, value) values ('maintenance', ${external.json({ enabled: true, message: "cli on", startsAt: null, endsAt: null })})
      on conflict (key) do update set value = excluded.value`;
    await eventually(async () => rejectsWith((await as({ cookie: session })).party.list({ page: 1, limit: 5 }), "PRECONDITION_FAILED"));

    await external`delete from system_config where key = 'maintenance'`;
    await eventually(async () => (await as({ cookie: session })).party.list({ page: 1, limit: 5 }).then(() => true));
  });

  it("a rolled-back external write does NOT invalidate (NOTIFY fires on commit only)", async () => {
    const { user, session } = await member("admin");
    await expect((await as({ cookie: session })).party.list({ page: 1, limit: 5 })).resolves.toBeTruthy();
    expect(membershipCache.get(`${tenant.id}:${user.id}`)).toBeTruthy();
    await external
      .begin(async (tx) => {
        await tx`update tenant_members set role = 'seller' where tenant_id = ${tenant.id} and user_id = ${user.id}`;
        throw new Error("rollback");
      })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    expect(membershipCache.get(`${tenant.id}:${user.id}`)?.role).toBe("admin");
  });
});
