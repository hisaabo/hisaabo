/**
 * Offline regression tests for the router/token hardening pass. DB-dependent
 * paths use a recording fake for controlDb, so no Postgres is required.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Queue-driven fake of the drizzle query builder: every select() consumes the
// next queued result and records the selected field map.
const { selects, queue, fakeDb } = vi.hoisted(() => {
  const selects: Array<Record<string, unknown> | undefined> = [];
  const queue: unknown[][] = [];
  const chain = (fields: Record<string, unknown> | undefined) => {
    selects.push(fields);
    const result = queue.shift() ?? [];
    const b: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit", "offset"]) b[m] = () => b;
    // Drizzle query builders are awaitable; the mock must be thenable too.
    // oxlint-disable-next-line unicorn/no-thenable
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return b;
  };
  const fakeDb = { select: (f?: Record<string, unknown>) => chain(f) };
  return { selects, queue, fakeDb };
});

vi.mock("@hisaabo/db", async () => {
  const actual = await vi.importActual<typeof import("@hisaabo/db")>("@hisaabo/db");
  return { ...actual, controlDb: fakeDb, getTenantDb: vi.fn(async () => ({}) as never) };
});
vi.mock("../lib/maintenance-cache.js", () => ({
  getMaintenanceStatus: vi.fn(async () => ({ enabled: false })),
  invalidateMaintenanceCache: vi.fn(),
}));

import { TRPCError } from "@trpc/server";
import { createCallerFactory } from "../trpc.js";
import { tenantRouter } from "../routers/tenant.js";
import { apiKeyRouter, resolveApiKeyExpiry, API_KEY_MAX_TTL_MS, API_KEY_DEFAULT_TTL_MS } from "../routers/apiKey.js";
import { trackingUrlSchema } from "../routers/shipment.js";
import { targetUserScope } from "../routers/target.js";
import { sessionHandle } from "../routers/auth.js";
import { requireTenantRole, hasRole, OWNER_ROLES, ADMIN_ROLES, invalidateMembershipCache } from "../lib/tenant-access.js";
import { normalizeEmail } from "../lib/normalize-email.js";
import { deriveKey } from "../lib/derive-key.js";
import { signExportToken, verifyExportToken } from "../lib/exportToken.js";
import { signImportToken, verifyImportToken } from "../lib/importToken.js";
import { isValidEncryptionKey } from "../lib/env.js";
import { createByteLimiter } from "../http/importStream.js";
import { assertSafeTarget } from "../lib/admin/runners.js";
import { defineAbilityFor } from "../lib/permissions.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function caller(router: typeof tenantRouter | typeof apiKeyRouter, extra: Record<string, unknown> = {}) {
  const req = new Request("http://localhost/api/trpc/x", { method: "GET" });
  const factory = createCallerFactory(router as never) as unknown as (c: unknown) => any;
  return factory({
    user: { id: USER, email: "u@example.in", name: "U" },
    tenantId: TENANT,
    businessId: null,
    req,
    resHeaders: new Headers(),
    ipAddress: null,
    ...extra,
  });
}

beforeEach(() => {
  selects.length = 0;
  queue.length = 0;
  invalidateMembershipCache(TENANT);
});

// Every tenantProcedure call first runs the membership check (one select).
const membershipOk = () => queue.push([{ status: "active" }]);

describe("tenant.current", () => {
  it("never selects db connection columns", async () => {
    membershipOk();
    queue.push([{ id: TENANT, name: "Acme", slug: "acme", plan: "free", status: "active", createdAt: new Date() }]);
    await caller(tenantRouter).current();
    const fields = Object.keys(selects[1] ?? {});
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) expect(f).not.toMatch(/^db/);
    expect(fields).not.toContain("dbPassword");
  });
});

describe("tenant.members / pendingInvitations role gate", () => {
  it("rejects a plain seller", async () => {
    membershipOk();
    queue.push([{ role: "seller" }]);
    await expect(caller(tenantRouter).members()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an accountant for pending invitations", async () => {
    membershipOk();
    queue.push([{ role: "accountant" }]);
    await expect(caller(tenantRouter).pendingInvitations()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows admin and hides nothing", async () => {
    membershipOk();
    queue.push([{ role: "admin" }]);
    queue.push([{ id: "m1", userEmail: "a@b.in" }]);
    const rows = await caller(tenantRouter).members();
    expect(rows[0].userEmail).toBe("a@b.in");
  });

  it("gives seller_manager the roster without emails", async () => {
    membershipOk();
    queue.push([{ role: "seller_manager" }]);
    queue.push([{ id: "m1", userEmail: "a@b.in" }]);
    const rows = await caller(tenantRouter).members();
    expect(rows[0].userEmail).toBe("");
  });
});

describe("hasTenantAccess membership check", () => {
  it("rejects a user who is no longer a member", async () => {
    queue.push([]);
    await expect(caller(tenantRouter).members()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a suspended tenant", async () => {
    queue.push([{ status: "suspended" }]);
    await expect(caller(tenantRouter).members()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("caches a positive result briefly and honours invalidation", async () => {
    membershipOk();
    queue.push([{ role: "owner" }], []);
    await caller(tenantRouter).members();
    const before = selects.length;
    queue.push([{ role: "owner" }], []);
    await caller(tenantRouter).members();
    // second call: no membership select, only role + members selects
    expect(selects.length - before).toBe(2);
    invalidateMembershipCache(TENANT, USER);
    queue.push([]);
    await expect(caller(tenantRouter).members()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("requireTenantRole", () => {
  it("treats superadmin like owner and rejects admin for owner-only gates", async () => {
    queue.push([{ role: "superadmin" }]);
    await expect(requireTenantRole({ user: { id: USER }, tenantId: TENANT }, OWNER_ROLES)).resolves.toBe("superadmin");
    queue.push([{ role: "admin" }]);
    await expect(requireTenantRole({ user: { id: USER }, tenantId: TENANT }, OWNER_ROLES)).rejects.toBeInstanceOf(TRPCError);
    queue.push([{ role: "admin" }]);
    await expect(requireTenantRole({ user: { id: USER }, tenantId: TENANT }, ADMIN_ROLES)).resolves.toBe("admin");
  });

  it("rejects non-members and a missing tenant", async () => {
    queue.push([]);
    await expect(requireTenantRole({ user: { id: USER }, tenantId: TENANT }, ADMIN_ROLES)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireTenantRole({ user: { id: USER }, tenantId: null }, ADMIN_ROLES)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("hasRole is false for null", () => {
    expect(hasRole(null, ADMIN_ROLES)).toBe(false);
    expect(hasRole("owner", OWNER_ROLES)).toBe(true);
  });
});

describe("apiKey router", () => {
  it("refuses to mint a key when authenticated by an API key", async () => {
    await expect(caller(apiKeyRouter, { viaApiKey: true }).create({ name: "k" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses to revoke a key when authenticated by an API key", async () => {
    await expect(
      caller(apiKeyRouter, { viaApiKey: true }).revoke({ id: "33333333-3333-4333-8333-333333333333" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires an admin-level role", async () => {
    queue.push([{ role: "seller" }]);
    await expect(caller(apiKeyRouter).create({ name: "k" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    queue.push([{ role: "accountant" }]);
    await expect(caller(apiKeyRouter).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("defaults to 90 days and caps at 365 days", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(resolveApiKeyExpiry(undefined, now).getTime()).toBe(now + API_KEY_DEFAULT_TTL_MS);
    expect(() => resolveApiKeyExpiry(new Date(now + API_KEY_MAX_TTL_MS + 1000).toISOString(), now)).toThrow(/365/);
    expect(() => resolveApiKeyExpiry(new Date(now - 1000).toISOString(), now)).toThrow(/future/);
    const ok = new Date(now + 30 * 86_400_000).toISOString();
    expect(resolveApiKeyExpiry(ok, now).toISOString()).toBe(ok);
  });
});

describe("shipment trackingUrl", () => {
  it("accepts http(s) and empty, rejects other schemes", () => {
    expect(trackingUrlSchema.safeParse("https://track.example.com/x?y=1").success).toBe(true);
    expect(trackingUrlSchema.safeParse("http://track.example.com").success).toBe(true);
    expect(trackingUrlSchema.safeParse("").success).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>1</script>", "ftp://x.com/a", "//evil.com", "JaVaScRiPt:alert(1)"]) {
      expect(trackingUrlSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("target visibility", () => {
  it("forces own userId for roles without manage:SalesTarget", () => {
    const seller = defineAbilityFor({ userId: USER, role: "seller" });
    const accountant = defineAbilityFor({ userId: USER, role: "accountant" });
    const admin = defineAbilityFor({ userId: USER, role: "admin" });
    const other = "44444444-4444-4444-8444-444444444444";
    expect(targetUserScope(seller, USER, other)).toBe(USER);
    expect(targetUserScope(seller, USER)).toBe(USER);
    expect(targetUserScope(accountant, USER, other)).toBe(USER);
    expect(targetUserScope(admin, USER, other)).toBe(other);
    expect(targetUserScope(admin, USER)).toBeUndefined();
  });
});

describe("session handles", () => {
  it("is a stable non-reversible digest, not the session id", () => {
    const id = "sess_" + "a".repeat(59);
    const h = sessionHandle(id);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(id);
    expect(sessionHandle(id)).toBe(h);
  });
});

describe("email normalisation", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Victim@Example.COM ")).toBe("victim@example.com");
  });
});

describe("token keys", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("throws in production when no secret is configured", () => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.SESSION_SECRET;
    delete process.env.EXPORT_SECRET;
    process.env.NODE_ENV = "production";
    expect(() => deriveKey("export-token")).toThrow(/signing secret/);
    expect(() => signExportToken(TENANT, USER)).toThrow();
    expect(() => signImportToken(TENANT, USER)).toThrow();
  });

  it("derives distinct keys per purpose and never returns the raw secret", () => {
    process.env.ENCRYPTION_KEY = "ab".repeat(32);
    const a = deriveKey("export-token");
    const b = deriveKey("import-token");
    expect(a.equals(b)).toBe(false);
    expect(a.length).toBe(32);
    expect(a.toString("hex")).not.toBe(process.env.ENCRYPTION_KEY);
  });

  it("round-trips export and import tokens and keeps them single-use", () => {
    process.env.ENCRYPTION_KEY = "cd".repeat(32);
    const ex = signExportToken(TENANT, USER);
    expect(verifyExportToken(ex.token)).toEqual({ tenantId: TENANT, userId: USER });
    expect(verifyExportToken(ex.token)).toBeNull();
    const im = signImportToken(TENANT, USER);
    expect(verifyImportToken(im.token)).toMatchObject({ ok: true });
    expect(verifyImportToken(im.token)).toMatchObject({ ok: false, reason: "reused" });
  });

  it("an export token is not valid as an import token", () => {
    process.env.ENCRYPTION_KEY = "ef".repeat(32);
    const ex = signExportToken(TENANT, USER);
    expect(verifyImportToken(ex.token)).toMatchObject({ ok: false });
  });

  it("validates ENCRYPTION_KEY format", () => {
    expect(isValidEncryptionKey("ab".repeat(32))).toBe(true);
    expect(isValidEncryptionKey("short")).toBe(false);
    expect(isValidEncryptionKey("zz".repeat(32))).toBe(false);
  });
});

describe("import decompression cap", () => {
  it("aborts the stream once the limit is exceeded", async () => {
    const limiter = createByteLimiter(1000);
    const src = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
    await expect(pipeline(src, limiter, async (s) => { for await (const _ of s) { /* drain */ } })).rejects.toThrow(/exceeds/);
  });

  it("passes data under the limit", async () => {
    const limiter = createByteLimiter(1000);
    const chunks: Buffer[] = [];
    await pipeline(Readable.from([Buffer.alloc(400), Buffer.alloc(400)]), limiter, async (s) => { for await (const c of s) chunks.push(c); });
    expect(Buffer.concat(chunks).length).toBe(800);
  });
});

describe("admin runner target validation", () => {
  it("rejects names/hosts that psql or URL parsing would reinterpret", () => {
    expect(() => assertSafeTarget({ name: "tenant_abc123" })).not.toThrow();
    expect(() => assertSafeTarget({ name: null })).not.toThrow();
    expect(() => assertSafeTarget({ name: "x host=evil.com" })).toThrow();
    expect(() => assertSafeTarget({ name: "postgresql://evil/db" })).toThrow();
    expect(() => assertSafeTarget({ name: "db", host: "evil.com/@x" })).toThrow();
    expect(() => assertSafeTarget({ name: "db", port: "5432;x" })).toThrow();
  });
});
