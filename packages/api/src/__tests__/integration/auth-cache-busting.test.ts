/**
 * "Write -> the very next call sees it" for every cached auth / authz fact.
 *
 * Real DB, real createContext (so the session / access-token / API-key caches
 * are in the path), real tRPC middleware chain (so the authz caches are in the
 * path). For each write the cache is WARMED first (and, where it matters,
 * asserted to be warm via a query counter), then the write is done through the
 * real router / helper, then the VERY NEXT call must see it.
 *
 * Cache-bus semantics under test (lib/cache, lib/authz, lib/auth-caches):
 * invalidation after the write settled + no-resurrection of overlapping loads.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getTableName } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { nanoid } from "nanoid";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import {
  controlDb,
  getTenantDb,
  sessions,
  accessTokens,
  apiKeys,
  tenantMembers,
  tenants,
  users,
  magicLinkTokens,
  systemConfig,
} from "@hisaabo/db";
import {
  createUser,
  createTenant,
  addMember,
  createBusiness,
  type TestUser,
  type TestTenant,
  type TestBusiness,
} from "../helpers/fixtures.js";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createContext } from "../../context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { cacheBus } from "../../lib/cache/index.js";
import { membershipCache, getMembership } from "../../lib/authz.js";
import { enforceSessionLimit } from "../../lib/plan-limits.js";
import { rotateSessionsOnPrivilegeEvent } from "../../lib/session-rotation.js";
import { sessionHandle } from "../../routers/auth.js";
import { _resetApiKeyTouchThrottle } from "../../lib/auth-caches.js";

const factory = createCallerFactory(appRouter);

type Role = "owner" | "admin" | "seller" | "accountant" | "member";

let owner: TestUser;
let tenant: TestTenant;
let biz: TestBusiness;
let ownerSession: string;

// ── request helpers ──────────────────────────────────────────────────────────

interface Auth {
  cookie?: string;
  bearer?: string;
}

function buildReq(auth: Auth, businessId: string | null = biz?.id ?? null, method = "POST"): Request {
  const headers = new Headers({ "x-requested-with": "hisaabo" });
  if (auth.cookie) headers.set("cookie", `session_id=${auth.cookie}`);
  if (auth.bearer) headers.set("authorization", `Bearer ${auth.bearer}`);
  if (businessId) headers.set("x-business-id", businessId);
  return new Request("http://localhost:3000/api/trpc/x", { method, headers });
}

/** Real createContext -> real caller. Resolves the session/key like a request would. */
async function as(auth: Auth, businessId: string | null = biz?.id ?? null) {
  const ctx = await createContext({ req: buildReq(auth, businessId), resHeaders: new Headers(), info: {} as never });
  return factory(ctx);
}

async function insertSession(
  userId: string,
  tenantId: string | null,
  kind: "cookie" | "bearer" = "cookie",
  over: { expiresAt?: Date; maxExpiresAt?: Date | null } = {},
): Promise<string> {
  const id = nanoid(64);
  const now = Date.now();
  await getControlDb().insert(sessions).values({
    id,
    userId,
    tenantId,
    authMethod: kind,
    expiresAt: over.expiresAt ?? new Date(now + (kind === "bearer" ? 7 : 30) * 86_400_000),
    maxExpiresAt: over.maxExpiresAt !== undefined ? over.maxExpiresAt : kind === "bearer" ? new Date(now + 30 * 86_400_000) : null,
  });
  return id;
}

async function insertAccessToken(sessionId: string, expiresAt: Date): Promise<string> {
  const id = `at_${randomBytes(48).toString("base64url")}`;
  await getControlDb().insert(accessTokens).values({ id, sessionId, expiresAt });
  return id;
}

async function newMember(role: Role, tenantId = tenant.id) {
  const user = await createUser();
  await addMember(tenantId, user.id, role);
  const session = await insertSession(user.id, tenantId);
  return { user, session };
}

/** Counts selects (by table) on control + tenant drizzle instances while `fn` runs. */
async function recordSelects<T>(fn: () => Promise<T>): Promise<{ result: T; tables: string[]; updates: string[] }> {
  const tables: string[] = [];
  const updates: string[] = [];
  const tenantDb = await getTenantDb(tenant.id);
  const spies: Array<{ mockRestore: () => void }> = [];
  for (const db of new Set([controlDb as unknown as Record<string, unknown>, tenantDb as unknown as Record<string, unknown>])) {
    const origSelect = (db.select as (...a: unknown[]) => Record<string, unknown>).bind(db);
    spies.push(
      (vi.spyOn(db as never, "select" as never) as unknown as { mockImplementation: (f: unknown) => never; mockRestore: () => void }).mockImplementation(((...a: unknown[]) => {
        const b = origSelect(...a) as { from: (t: never) => unknown };
        const of = b.from.bind(b);
        b.from = (t: never) => {
          tables.push(getTableName(t));
          return of(t);
        };
        return b;
      }) as never),
    );
    const origUpdate = (db.update as (...a: unknown[]) => unknown).bind(db);
    spies.push(
      (vi.spyOn(db as never, "update" as never) as unknown as { mockImplementation: (f: unknown) => never; mockRestore: () => void }).mockImplementation(((t: never) => {
        updates.push(getTableName(t));
        return origUpdate(t);
      }) as never),
    );
  }
  try {
    const result = await fn();
    return { result, tables, updates };
  } finally {
    for (const s of spies) s.mockRestore();
  }
}

const CONTROL_AUTHZ_TABLES = ["tenant_members", "tenants", "businesses"];

beforeAll(async () => {
  owner = await createUser();
  tenant = await createTenant({ plan: "business" });
  await addMember(tenant.id, owner.id, "owner");
  biz = await createBusiness(getTenantTestDb(), owner.id);
  ownerSession = await insertSession(owner.id, tenant.id);
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const partyInput = { type: "customer" as const, name: "Cache Test Party" };

// ── 1. Authz: role / membership / tenant / creator ──────────────────────────

describe("authz caches: write -> next call sees it", () => {
  it("role downgrade (admin -> accountant) denies the very next procedure and CASL reflects the new role", async () => {
    const { user, session } = await newMember("admin");
    await expect((await as({ cookie: session })).party.create(partyInput)).resolves.toBeTruthy();

    // warm: a second call issues ZERO authz queries
    const warm = await recordSelects(async () => (await as({ cookie: session })).party.create(partyInput));
    expect(warm.tables.filter((t) => CONTROL_AUTHZ_TABLES.includes(t))).toEqual([]);
    expect(warm.tables).not.toContain("sessions");

    await (await as({ cookie: ownerSession })).tenant.updateMemberRole({ userId: user.id, role: "accountant" });

    await expect((await as({ cookie: session })).party.create(partyInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // accountant can still read parties (ability is the NEW role's, not "no access")
    await expect((await as({ cookie: session })).party.list({ page: 1, limit: 5 })).resolves.toBeTruthy();
    // and tenant-level admin gates (requireTenantRole) read the same new role
    await expect((await as({ cookie: session })).tenant.members()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("role upgrade is visible immediately too (no stale deny)", async () => {
    const { user, session } = await newMember("accountant");
    await expect((await as({ cookie: session })).party.create(partyInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await (await as({ cookie: ownerSession })).tenant.updateMemberRole({ userId: user.id, role: "admin" });
    await expect((await as({ cookie: session })).party.create(partyInput)).resolves.toBeTruthy();
  });

  it("member removed -> next call FORBIDDEN, session loses its tenant, API key is dead", async () => {
    const { user, session } = await newMember("admin");
    // an API key for the member (inserted directly: key is minted by the member)
    const raw = `hisaabo_key_${randomBytes(32).toString("base64url")}`;
    await getControlDb().insert(apiKeys).values({
      userId: user.id,
      tenantId: tenant.id,
      keyHash: createHash("sha256").update(raw).digest("hex"),
      keyPrefix: raw.slice(0, 20),
      name: "k",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    // warm session + key + authz
    await expect((await as({ cookie: session })).party.create(partyInput)).resolves.toBeTruthy();
    await expect((await as({ bearer: raw })).party.create(partyInput)).resolves.toBeTruthy();

    await (await as({ cookie: ownerSession })).tenant.removeMember({ userId: user.id });

    // the real session lost its tenant selection (cleaned up by removeMember)...
    await expect((await as({ cookie: session })).party.create(partyInput)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // ...and even a request still carrying the stale tenant (in-flight / pre-removal ctx) is FORBIDDEN
    const stale = factory({
      user: { id: user.id, email: user.email, name: user.name },
      tenantId: tenant.id,
      businessId: biz.id,
      req: buildReq({ cookie: session }),
      resHeaders: new Headers(),
      ipAddress: null,
    });
    await expect(stale.party.create(partyInput)).rejects.toMatchObject({ code: "FORBIDDEN", message: "Not a member of this organization" });
    // key revoked with the membership: unauthenticated
    await expect((await as({ bearer: raw })).party.create(partyInput)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const ctx = await createContext({ req: buildReq({ cookie: session }), resHeaders: new Headers(), info: {} as never });
    expect(ctx.tenantId).toBeNull();
  });

  it("business creator removed from the tenant -> business FORBIDDEN on the very next call", async () => {
    const creator = await createUser();
    await addMember(tenant.id, creator.id, "admin");
    const creatorBiz = await createBusiness(getTenantTestDb(), creator.id);
    const { session } = await newMember("admin");

    await expect((await as({ cookie: session }, creatorBiz.id)).party.create(partyInput)).resolves.toBeTruthy();
    await (await as({ cookie: ownerSession })).tenant.removeMember({ userId: creator.id });
    await expect((await as({ cookie: session }, creatorBiz.id)).party.create(partyInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Business not found",
    });
  });

  it("tenant suspended (event after the write) -> next call FORBIDDEN 'Organization is not active'; reactivation is seen too", async () => {
    const t2 = await createTenant({ plan: "business" });
    const o2 = await createUser();
    await addMember(t2.id, o2.id, "owner");
    const b2 = await createBusiness(getTenantTestDb(), o2.id);
    const s2 = await insertSession(o2.id, t2.id);
    await expect((await as({ cookie: s2 }, b2.id)).party.create(partyInput)).resolves.toBeTruthy();

    await getControlDb().update(tenants).set({ status: "suspended" }).where(eq(tenants.id, t2.id));
    cacheBus.invalidate({ kind: "tenant", tenantId: t2.id });
    await expect((await as({ cookie: s2 }, b2.id)).party.create(partyInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Organization is not active",
    });

    await getControlDb().update(tenants).set({ status: "active" }).where(eq(tenants.id, t2.id));
    // a denial is never cached: even WITHOUT an event the reactivated tenant works
    await expect((await as({ cookie: s2 }, b2.id)).party.create(partyInput)).resolves.toBeTruthy();
  });

  it("denials are never cached: a user who is added later is allowed on the next call (no event needed)", async () => {
    const user = await createUser();
    const session = await insertSession(user.id, tenant.id);
    await expect((await as({ cookie: session })).party.list({ page: 1, limit: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Not a member of this organization",
    });
    await addMember(tenant.id, user.id, "admin"); // raw insert, no cache event
    await expect((await as({ cookie: session })).party.list({ page: 1, limit: 5 })).resolves.toBeTruthy();
  });

  it("unknown business -> 'Business not found' every time (no negative caching), then works once it exists", async () => {
    const { session } = await newMember("admin");
    const futureBizId = randomUUID();
    await expect((await as({ cookie: session }, futureBizId)).party.list({ page: 1, limit: 5 })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Business not found",
    });
    await createBusiness(getTenantTestDb(), owner.id, { id: futureBizId });
    await expect((await as({ cookie: session }, futureBizId)).party.list({ page: 1, limit: 5 })).resolves.toBeTruthy();
  });

  it("tenant plan change is seen after the tenant event", async () => {
    const { enforceDataExport } = await import("../../lib/plan-limits.js");
    const t = await createTenant({ plan: "business" });
    await expect(enforceDataExport(t.id)).resolves.toBeUndefined();
    await getControlDb().update(tenants).set({ plan: "free" }).where(eq(tenants.id, t.id));
    cacheBus.invalidate({ kind: "tenant", tenantId: t.id });
    await expect(enforceDataExport(t.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ── 2. Query-count: N authorized procedures in one batch ────────────────────

describe("authz query count", () => {
  it("a tRPC batch of authorized procedures issues 0 authz/session queries after warm-up", async () => {
    const { session } = await newMember("admin");
    const procs = ["bankAccount.list", "account.list", "bankAccount.summary", "bankAccount.list", "account.list", "bankAccount.summary"];
    const url = `http://localhost:3000/api/trpc/${procs.join(",")}?batch=1&input=${encodeURIComponent(
      JSON.stringify(Object.fromEntries(procs.map((_, i) => [String(i), { json: null }]))),
    )}`;
    const runBatch = async () => {
      const req = new Request(url, {
        method: "GET",
        headers: { cookie: `session_id=${session}`, "x-requested-with": "hisaabo", "x-business-id": biz.id },
      });
      const res = await fetchRequestHandler({
        endpoint: "/api/trpc",
        req,
        router: appRouter,
        createContext: (o) => createContext(o),
      });
      return (await res.json()) as Array<{ result?: unknown; error?: { json: { message: string } } }>;
    };

    const first = await runBatch();
    expect(first.every((r) => r.result), JSON.stringify(first)).toBe(true);

    const warm = await recordSelects(runBatch);
    expect(warm.result.every((r) => r.result)).toBe(true);
    for (const forbidden of [...CONTROL_AUTHZ_TABLES, "sessions", "users", "api_keys"]) {
      expect(warm.tables.filter((t) => t === forbidden), `${forbidden} selects`).toEqual([]);
    }
    // and the session lastUsedAt write is not repeated on hits
    expect(warm.updates).toEqual([]);
  });
});

// ── 3. API keys ──────────────────────────────────────────────────────────────

describe("API key cache", () => {
  it("revoke -> the key's very next request is UNAUTHORIZED (warmed first)", async () => {
    const admin = await as({ cookie: ownerSession });
    const created = await admin.apiKey.create({ name: "revocable" });
    await expect((await as({ bearer: created.key })).party.create(partyInput)).resolves.toBeTruthy();
    // warm: no api_keys select on the second use
    const warm = await recordSelects(async () => (await as({ bearer: created.key })).party.create(partyInput));
    expect(warm.tables).not.toContain("api_keys");

    await admin.apiKey.revoke({ id: created.id });

    await expect((await as({ bearer: created.key })).party.create(partyInput)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect((await as({ bearer: created.key })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("role change kills the member's keys immediately", async () => {
    const { user, session } = await newMember("admin");
    const mine = await (await as({ cookie: session })).apiKey.create({ name: "mine" });
    await expect((await as({ bearer: mine.key })).party.create(partyInput)).resolves.toBeTruthy();
    await (await as({ cookie: ownerSession })).tenant.updateMemberRole({ userId: user.id, role: "seller" });
    await expect((await as({ bearer: mine.key })).party.create(partyInput)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("logoutAll kills the user's keys and sessions at once", async () => {
    const { session } = await newMember("admin");
    const other = await insertSession((await getControlDb().select().from(sessions).where(eq(sessions.id, session)))[0]!.userId, tenant.id);
    const mine = await (await as({ cookie: session })).apiKey.create({ name: "mine" });
    await expect((await as({ bearer: mine.key })).tenant.list()).resolves.toBeTruthy();
    await expect((await as({ cookie: other })).tenant.list()).resolves.toBeTruthy();

    await (await as({ cookie: session })).auth.logoutAll();

    await expect((await as({ bearer: mine.key })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect((await as({ cookie: other })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect((await as({ cookie: session })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("expiry is re-checked on a cache HIT", async () => {
    const { user } = await newMember("admin");
    const raw = `hisaabo_key_${randomBytes(32).toString("base64url")}`;
    await getControlDb().insert(apiKeys).values({
      userId: user.id,
      tenantId: tenant.id,
      keyHash: createHash("sha256").update(raw).digest("hex"),
      keyPrefix: raw.slice(0, 20),
      name: "short",
      expiresAt: new Date(Date.now() + 20_000),
    });
    await expect((await as({ bearer: raw })).tenant.list()).resolves.toBeTruthy(); // warm
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 25_000 }); // < 60s cache TTL, > key expiry
    await expect((await as({ bearer: raw })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("lastUsedAt is written at most once per 5 minutes per key (cache hits do no DB work)", async () => {
    _resetApiKeyTouchThrottle();
    const created = await (await as({ cookie: ownerSession })).apiKey.create({ name: "throttle" });
    const run = await recordSelects(async () => {
      for (let i = 0; i < 6; i++) await (await as({ bearer: created.key })).tenant.list();
    });
    expect(run.updates.filter((t) => t === "api_keys")).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 50)); // let the fire-and-forget UPDATE land
    const [row] = await getControlDb().select({ at: apiKeys.lastUsedAt }).from(apiKeys).where(eq(apiKeys.id, created.id));
    expect(row!.at).not.toBeNull();
  });
});

// ── 4. Sessions / access tokens ─────────────────────────────────────────────

describe("session cache", () => {
  it("bearer (refresh) session is served from cache on request #2; lastUsedAt/slide UPDATE ran once (regression: set-then-invalidate bug)", async () => {
    const { user } = await newMember("admin");
    const sid = await insertSession(user.id, tenant.id, "bearer");
    const run = await recordSelects(async () => {
      for (let i = 0; i < 4; i++) await createContext({ req: buildReq({ bearer: sid }), resHeaders: new Headers(), info: {} as never });
    });
    expect(run.tables.filter((t) => t === "sessions")).toHaveLength(1);
    expect(run.updates.filter((t) => t === "sessions")).toHaveLength(1);
  });

  it("logout -> next call UNAUTHORIZED (cookie)", async () => {
    const { session } = await newMember("admin");
    await expect((await as({ cookie: session })).tenant.list()).resolves.toBeTruthy();
    await (await as({ cookie: session })).auth.logout();
    await expect((await as({ cookie: session })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("logout -> next call UNAUTHORIZED (refresh bearer)", async () => {
    const { user } = await newMember("admin");
    const sid = await insertSession(user.id, tenant.id, "bearer");
    await expect((await as({ bearer: sid })).tenant.list()).resolves.toBeTruthy();
    await (await as({ bearer: sid })).auth.logout();
    await expect((await as({ bearer: sid })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("revokeSession kills the other session and its at_ tokens immediately", async () => {
    const { user, session } = await newMember("admin");
    const bearerSid = await insertSession(user.id, tenant.id, "bearer");
    const at = await insertAccessToken(bearerSid, new Date(Date.now() + 15 * 60_000));
    await expect((await as({ bearer: bearerSid })).tenant.list()).resolves.toBeTruthy();
    await expect((await as({ bearer: at })).tenant.list()).resolves.toBeTruthy();

    await (await as({ cookie: session })).auth.revokeSession({ sessionId: sessionHandle(bearerSid) });

    await expect((await as({ bearer: bearerSid })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect((await as({ bearer: at })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // the revoking session is untouched
    await expect((await as({ cookie: session })).tenant.list()).resolves.toBeTruthy();
  });

  it("logoutAll kills every session (cookie + bearer + at_) of the user", async () => {
    const { user, session } = await newMember("admin");
    const bearerSid = await insertSession(user.id, tenant.id, "bearer");
    const at = await insertAccessToken(bearerSid, new Date(Date.now() + 15 * 60_000));
    for (const a of [{ cookie: session }, { bearer: bearerSid }, { bearer: at }]) {
      await expect((await as(a)).tenant.list()).resolves.toBeTruthy();
    }
    await (await as({ cookie: session })).auth.logoutAll();
    for (const a of [{ cookie: session }, { bearer: bearerSid }, { bearer: at }]) {
      await expect((await as(a)).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  });

  it("session rotation (privilege event) keeps only the kept session", async () => {
    const { user, session } = await newMember("admin");
    const other = await insertSession(user.id, tenant.id);
    await expect((await as({ cookie: other })).tenant.list()).resolves.toBeTruthy();
    await expect((await as({ cookie: session })).tenant.list()).resolves.toBeTruthy();
    await rotateSessionsOnPrivilegeEvent(user.id, session);
    await expect((await as({ cookie: other })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect((await as({ cookie: session })).tenant.list()).resolves.toBeTruthy();
  });

  it("plan-limit eviction (enforceSessionLimit) kills the evicted session on the very next call", async () => {
    const freeTenant = await createTenant({ plan: "free" });
    const user = await createUser();
    await addMember(freeTenant.id, user.id, "owner");
    const sessionsOfUser: string[] = [];
    for (let i = 0; i < 3; i++) {
      sessionsOfUser.push(await insertSession(user.id, freeTenant.id));
      await new Promise((r) => setTimeout(r, 5)); // distinct createdAt ordering
    }
    for (const s of sessionsOfUser) await expect((await as({ cookie: s })).tenant.list()).resolves.toBeTruthy();

    const evicted = await enforceSessionLimit(user.id); // free plan: 3 sessions -> evicts the oldest
    expect(evicted).toEqual([sessionsOfUser[0]]);

    await expect((await as({ cookie: sessionsOfUser[0]! })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect((await as({ cookie: sessionsOfUser[1]! })).tenant.list()).resolves.toBeTruthy();
  });

  it("enforceSessionLimit inside a caller's tx returns the ids; the caller's event after commit purges them", async () => {
    const freeTenant = await createTenant({ plan: "free" });
    const user = await createUser();
    await addMember(freeTenant.id, user.id, "owner");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await insertSession(user.id, freeTenant.id));
      await new Promise((r) => setTimeout(r, 5));
    }
    await expect((await as({ cookie: ids[0]! })).tenant.list()).resolves.toBeTruthy();
    let evicted: string[] = [];
    await getControlDb().transaction(async (tx) => {
      evicted = await enforceSessionLimit(user.id, tx as never);
    });
    cacheBus.invalidate({ kind: "session", userId: user.id });
    expect(evicted).toEqual([ids[0]]);
    await expect((await as({ cookie: ids[0]! })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("tenant switch: the session's new tenant is visible on the very next request", async () => {
    const t2 = await createTenant({ plan: "business" });
    const { user, session } = await newMember("admin");
    await addMember(t2.id, user.id, "admin");
    const before = await createContext({ req: buildReq({ cookie: session }), resHeaders: new Headers(), info: {} as never });
    expect(before.tenantId).toBe(tenant.id);

    await (await as({ cookie: session })).tenant.select({ tenantId: t2.id });

    const after = await createContext({ req: buildReq({ cookie: session }), resHeaders: new Headers(), info: {} as never });
    expect(after.tenantId).toBe(t2.id);
  });

  it("absolute bearer cap (maxExpiresAt) is re-checked on a cache HIT", async () => {
    const { user } = await newMember("admin");
    const sid = await insertSession(user.id, tenant.id, "bearer", { maxExpiresAt: new Date(Date.now() + 30_000) });
    await expect((await as({ bearer: sid })).tenant.list()).resolves.toBeTruthy(); // warm
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 35_000 }); // < 60s TTL, > cap
    await expect((await as({ bearer: sid })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("session expiry (expiresAt) is re-checked on a cache HIT", async () => {
    const { user } = await newMember("admin");
    const sid = await insertSession(user.id, tenant.id, "cookie", { expiresAt: new Date(Date.now() + 20_000) });
    await expect((await as({ cookie: sid })).tenant.list()).resolves.toBeTruthy();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 25_000 });
    await expect((await as({ cookie: sid })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("at_ token expiry is re-checked on a cache HIT", async () => {
    const { user } = await newMember("admin");
    const sid = await insertSession(user.id, tenant.id, "bearer");
    const at = await insertAccessToken(sid, new Date(Date.now() + 20_000));
    await expect((await as({ bearer: at })).tenant.list()).resolves.toBeTruthy();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 25_000 });
    await expect((await as({ bearer: at })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ── 5. User profile fields embedded in cached sessions ──────────────────────

describe("name / email changes reach every session of the user", () => {
  it("updateName on one session is visible on auth.me from ANOTHER session (cookie, bearer and at_) immediately", async () => {
    const { user, session } = await newMember("admin");
    const bearerSid = await insertSession(user.id, tenant.id, "bearer");
    const at = await insertAccessToken(bearerSid, new Date(Date.now() + 15 * 60_000));
    // warm all three
    for (const a of [{ cookie: session }, { bearer: bearerSid }, { bearer: at }]) {
      expect((await (await as(a)).auth.me()).user?.name).toBe("Test User");
    }
    await (await as({ cookie: session })).auth.updateName({ name: "Renamed Person" });
    for (const a of [{ cookie: session }, { bearer: bearerSid }, { bearer: at }]) {
      expect((await (await as(a)).auth.me()).user?.name).toBe("Renamed Person");
    }
  });

  it("completeProfile name is visible on another session immediately", async () => {
    const { user, session } = await newMember("admin");
    const other = await insertSession(user.id, tenant.id);
    expect((await (await as({ cookie: other })).auth.me()).user?.name).toBe("Test User");
    await (await as({ cookie: session })).auth.completeProfile({ name: "Completed Name" });
    expect((await (await as({ cookie: other })).auth.me()).user?.name).toBe("Completed Name");
  });

  it("confirmEmailChange is visible on all of the user's sessions immediately", async () => {
    const { user, session } = await newMember("admin");
    const other = await insertSession(user.id, tenant.id);
    const apiKeyRaw = (await (await as({ cookie: session })).apiKey.create({ name: "k" })).key;
    expect((await (await as({ cookie: other })).auth.me()).user?.email).toBe(user.email);
    expect((await (await as({ bearer: apiKeyRaw })).auth.me()).user?.email).toBe(user.email);

    const newEmail = `changed.${randomUUID().slice(0, 8)}@example.in`;
    const rawToken = `${randomUUID()}-${nanoid(32)}`;
    await getControlDb().insert(magicLinkTokens).values({
      email: newEmail,
      tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      userId: user.id,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    await (await as({}, null)).auth.confirmEmailChange({ token: rawToken });

    expect((await (await as({ cookie: other })).auth.me()).user?.email).toBe(newEmail);
    expect((await (await as({ cookie: session })).auth.me()).user?.email).toBe(newEmail);
    expect((await (await as({ bearer: apiKeyRaw })).auth.me()).user?.email).toBe(newEmail);
  });
});

// ── 6. Maintenance ──────────────────────────────────────────────────────────

describe("maintenance cache", () => {
  it("toggled maintenance is seen by the very next call after the bus event; cleared likewise", async () => {
    const { session } = await newMember("admin");
    await expect((await as({ cookie: session })).party.list({ page: 1, limit: 5 })).resolves.toBeTruthy(); // warm: not in maintenance

    await getControlDb()
      .insert(systemConfig)
      .values({ key: "maintenance", value: { enabled: true, message: "back soon", startsAt: null, endsAt: null } })
      .onConflictDoUpdate({ target: systemConfig.key, set: { value: { enabled: true, message: "back soon", startsAt: null, endsAt: null } } });
    cacheBus.invalidate({ kind: "maintenance" });
    await expect((await as({ cookie: session })).party.list({ page: 1, limit: 5 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "back soon",
    });

    await getControlDb().delete(systemConfig).where(eq(systemConfig.key, "maintenance"));
    cacheBus.invalidate({ kind: "maintenance" });
    await expect((await as({ cookie: session })).party.list({ page: 1, limit: 5 })).resolves.toBeTruthy();
  });
});

// ── 7. Races: an in-flight load must never cache the stale value ────────────

/** Delay the NEXT controlDb.select until `gate` opens — AFTER the SQL already ran. */
function delayNextControlSelect(): { release: () => void; delayed: () => boolean } {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let delayed = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = controlDb as any;
  const orig = db.select.bind(db);
  vi.spyOn(db, "select").mockImplementationOnce((...a: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = orig(...a) as any;
    const of = b.from.bind(b);
    b.from = (t: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = of(t) as any;
      const origThen = q.then.bind(q);
      // oxlint-disable-next-line unicorn/no-thenable
      q.then = (res: unknown, rej: unknown) =>
        origThen((rows: unknown) => {
          delayed = true;
          return gate.then(() => rows);
        }).then(res, rej);
      return q;
    };
    return b;
  });
  return { release, delayed: () => delayed };
}

describe("no-resurrection races", () => {
  it("an authz (membership) load in flight while a role change commits does NOT cache the stale allow", async () => {
    const { user } = await newMember("admin");
    const rejectedBefore = membershipCache.stats().rejectedStale;
    const slow = delayNextControlSelect();

    const inflight = getMembership(tenant.id, user.id); // reads role=admin, then is held
    await new Promise((r) => setTimeout(r, 150)); // let its SQL run before the write
    expect(slow.delayed()).toBe(true); // the read finished with the OLD row and is parked

    await (await as({ cookie: ownerSession })).tenant.updateMemberRole({ userId: user.id, role: "accountant" });
    slow.release();
    // the racing caller began before the change: it may see the old value...
    expect((await inflight)?.role).toBe("admin");
    // ...but it was NOT stored: the next read goes to the DB and sees the new role
    expect(membershipCache.stats().rejectedStale).toBe(rejectedBefore + 1);
    expect((await getMembership(tenant.id, user.id))?.role).toBe("accountant");
    expect(membershipCache.get(`${tenant.id}:${user.id}`)?.role).toBe("accountant");
  });

  it("a session load in flight while the session is revoked is not cached (next call UNAUTHORIZED)", async () => {
    const { user, session } = await newMember("admin");
    const slow = delayNextControlSelect();
    const racing = createContext({ req: buildReq({ cookie: session }), resHeaders: new Headers(), info: {} as never });
    await new Promise((r) => setTimeout(r, 150));
    expect(slow.delayed()).toBe(true);

    // revoke from a second session of the same user while the first load is parked
    const other = await insertSession(user.id, tenant.id);
    await (await as({ cookie: other })).auth.revokeSession({ sessionId: sessionHandle(session) });
    slow.release();
    await racing; // began before the revoke: allowed to see the old value

    await expect((await as({ cookie: session })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("an API key load in flight while the key is revoked is not cached", async () => {
    const created = await (await as({ cookie: ownerSession })).apiKey.create({ name: "race" });
    const slow = delayNextControlSelect();
    const racing = createContext({ req: buildReq({ bearer: created.key }), resHeaders: new Headers(), info: {} as never });
    await new Promise((r) => setTimeout(r, 150));
    expect(slow.delayed()).toBe(true);
    await (await as({ cookie: ownerSession })).apiKey.revoke({ id: created.id });
    slow.release();
    await racing;
    await expect((await as({ bearer: created.key })).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// keep imports honest for drizzle helpers used only in some branches
void and;
void tenantMembers;
void users;
