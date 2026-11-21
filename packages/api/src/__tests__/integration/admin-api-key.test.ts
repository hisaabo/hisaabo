/**
 * `admin api-key create|list|revoke` — operator-issued API keys (shell-only).
 *
 * Real database, real createContext and tRPC chain, so "the key authenticates"
 * and "the key stops authenticating" are tested the way a request would see
 * them. The router's own `apiKey.create` is exercised too: it shares the
 * minting code (lib/api-keys.ts) and must behave exactly as before.
 *
 * Requires the PostgreSQL test database (TEST_DATABASE_URL).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiKeys, notificationOutbox } from "@hisaabo/db";
import {
  createUser, createTenant, addMember, type TestUser, type TestTenant,
} from "../helpers/fixtures.js";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createContext } from "../../context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { logger } from "../../lib/logger.js";
import { tenantHandle } from "../../lib/admin/privacy.js";
import {
  issueApiKey, listApiKeys, revokeApiKey, runApiKey, parseApiKeyArgs, formatKeyList, ApiKeyCommandError,
  OPERATOR_LABEL, OPERATOR_OVERRIDE_LABEL,
} from "../../lib/admin/api-key.js";
import { API_KEY_DEFAULT_TTL_MS } from "../../lib/api-keys.js";

const factory = createCallerFactory(appRouter);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const DAY = 86_400_000;

type Role = "owner" | "superadmin" | "admin" | "seller_manager" | "seller" | "accountant" | "member";

function buildReq(bearer: string): Request {
  return new Request("http://localhost:3000/api/trpc/x", {
    method: "POST",
    headers: new Headers({ "x-requested-with": "hisaabo", authorization: `Bearer ${bearer}` }),
  });
}

/** Real createContext -> real caller, authenticated with the raw key like a request would be. */
async function withKey(raw: string) {
  const ctx = await createContext({ req: buildReq(raw), resHeaders: new Headers(), info: {} as never });
  return factory(ctx);
}

function callerFor(user: TestUser, tenantId: string) {
  return factory({
    user: { id: user.id, email: user.email, name: user.name },
    tenantId,
    businessId: null,
    req: new Request("http://localhost:3000/api/trpc/test", { method: "POST", headers: new Headers({ "x-requested-with": "hisaabo" }) }),
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

async function setup(role: Role = "owner", plan: "free" | "pro" | "business" = "business") {
  const user = await createUser();
  const tenant: TestTenant = await createTenant({ plan });
  await addMember(tenant.id, user.id, role);
  return { user, tenant };
}

const keyRows = (tenantId: string) => getControlDb().select().from(apiKeys).where(eq(apiKeys.tenantId, tenantId));

async function expectRefused(p: Promise<unknown>, message: RegExp) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ApiKeyCommandError);
  expect((err as Error).message).toMatch(message);
}

function capture() {
  let out = "";
  let err = "";
  return { io: { out: (s: string) => { out += s; }, err: (s: string) => { err += s; } }, get out() { return out; }, get err() { return err; } };
}

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeAll(async () => {
  await truncateAllTables();
});

describe("api-key create: who may hold a key", () => {
  it("issues a key for an owner; only the hash is stored; the key authenticates", async () => {
    const { user, tenant } = await setup("owner");
    const issued = await issueApiKey({ email: user.email, tenant: tenant.slug, name: "MCP server" });

    expect(issued.key).toMatch(/^hisaabo_key_[A-Za-z0-9_-]{43}$/);
    expect(issued.keyPrefix).toBe(issued.key.slice(0, 20));
    expect(issued.role).toBe("owner");

    const rows = await keyRows(tenant.id);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.keyHash).toBe(sha256(issued.key));
    expect(row.keyPrefix).toBe(issued.keyPrefix);
    expect(row.userId).toBe(user.id);
    expect(row.name).toBe("MCP server");
    // the raw key is nowhere in the stored row
    expect(JSON.stringify(row)).not.toContain(issued.key);
    // default expiry: 90 days
    expect(Math.abs(row.expiresAt!.getTime() - (Date.now() + API_KEY_DEFAULT_TTL_MS))).toBeLessThan(60_000);

    // and it authenticates as that user, in that tenant, with that user's authority
    const api = await withKey(issued.key);
    const me = await api.auth.me();
    expect(me.user?.email).toBe(user.email);
    await expect(api.tenant.list()).resolves.toBeTruthy();
  });

  it("works with the tenant id as well as the slug, and for superadmin and admin", async () => {
    for (const role of ["superadmin", "admin"] as const) {
      const { user, tenant } = await setup(role);
      const byId = await issueApiKey({ email: user.email.toUpperCase(), tenant: tenant.id, name: `by id ${role}` });
      expect(byId.tenantSlug).toBe(tenant.slug);
      expect((await (await withKey(byId.key)).auth.me()).user?.id).toBe(user.id);
    }
  });

  it("raises the same locked 'API key created' alert as the web app, attributed to the operator", async () => {
    const { user, tenant } = await setup("owner");
    const issued = await issueApiKey({ email: user.email, tenant: tenant.slug, name: "alerting" });
    const [ev] = await getTenantTestDb().select().from(notificationOutbox).where(and(eq(notificationOutbox.tenantId, tenant.id), eq(notificationOutbox.dedupeKey, `api_key.created:${issued.id}`)));
    expect(ev).toBeTruthy();
    expect(ev.eventType).toBe("api_key.created");
    expect(ev.actorKind).toBe("system");
    expect(ev.actorUserId).toBeNull();
    expect(ev.subjectUserId).toBe(user.id);
    expect(ev.payload).toEqual({ keyName: "alerting", keyPrefix: issued.keyPrefix, createdByName: OPERATOR_LABEL });
  });

  it("refuses roles below admin, naming the role, and writes nothing", async () => {
    for (const role of ["seller_manager", "seller", "accountant", "member"] as const) {
      const { user, tenant } = await setup(role);
      await expectRefused(issueApiKey({ email: user.email, tenant: tenant.slug, name: "no" }), new RegExp(`"${role}" in ${tenant.slug}.*owner, superadmin, admin`));
      expect(await keyRows(tenant.id)).toHaveLength(0);
    }
  });

  it("refuses a user who is not a member of the tenant", async () => {
    const { tenant } = await setup("owner");
    const outsider = await createUser();
    await expectRefused(issueApiKey({ email: outsider.email, tenant: tenant.slug, name: "no" }), /not a member of/);
    expect(await keyRows(tenant.id)).toHaveLength(0);
    // a member of a DIFFERENT tenant is still not a member of this one
    const other = await setup("owner");
    await expectRefused(issueApiKey({ email: other.user.email, tenant: tenant.slug, name: "no" }), /not a member of/);
  });

  it("refuses unknown users, unknown tenants, suspended tenants and bad names", async () => {
    const { user, tenant } = await setup("owner");
    await expectRefused(issueApiKey({ email: "nobody@example.in", tenant: tenant.slug, name: "x" }), /no user with email nobody@example\.in/);
    await expectRefused(issueApiKey({ email: user.email, tenant: "no-such-org", name: "x" }), /no organisation with slug or id "no-such-org"/);
    await expectRefused(issueApiKey({ email: user.email, tenant: randomUUID(), name: "x" }), /no organisation/);
    await expectRefused(issueApiKey({ email: user.email, tenant: tenant.slug, name: "" }), /--name must be 1-100/);
    await expectRefused(issueApiKey({ email: user.email, tenant: tenant.slug, name: "x".repeat(101) }), /--name must be 1-100/);

    const sus = await setup("owner");
    await getControlDb().update((await import("@hisaabo/db")).tenants).set({ status: "suspended" }).where(eq((await import("@hisaabo/db")).tenants.id, sus.tenant.id));
    await expectRefused(issueApiKey({ email: sus.user.email, tenant: sus.tenant.slug, name: "x" }), /suspended/);
    expect(await keyRows(tenant.id)).toHaveLength(0);
    expect(await keyRows(sus.tenant.id)).toHaveLength(0);
  });

  it("--expires-days sets the expiry; it is capped at 365 days", async () => {
    const { user, tenant } = await setup("owner");
    const k30 = await issueApiKey({ email: user.email, tenant: tenant.slug, name: "30d", expiresDays: 30 });
    expect(Math.abs(k30.expiresAt!.getTime() - (Date.now() + 30 * DAY))).toBeLessThan(60_000);
    const k365 = await issueApiKey({ email: user.email, tenant: tenant.slug, name: "365d", expiresDays: 365 });
    expect(Math.abs(k365.expiresAt!.getTime() - (Date.now() + 365 * DAY))).toBeLessThan(60_000);
    expect(() => parseApiKeyArgs(["create", user.email, "--tenant", "t", "--name", "n", "--expires-days", "366"])).toThrow(/between 1 and 365/);
    expect(() => parseApiKeyArgs(["create", user.email, "--tenant", "t", "--name", "n", "--expires-days", "0"])).toThrow(/between 1 and 365/);
    expect(() => parseApiKeyArgs(["create", user.email, "--tenant", "t", "--name", "n", "--expires-days", "1.5"])).toThrow(/whole number/);
  });
});

describe("api-key create: plan limits", () => {
  it("a free plan (no API keys) is refused by default and issued with --override-plan", async () => {
    const { user, tenant } = await setup("owner", "free");
    await expectRefused(issueApiKey({ email: user.email, tenant: tenant.slug, name: "x" }), /paid plans.*--override-plan/);
    expect(await keyRows(tenant.id)).toHaveLength(0);

    const issued = await issueApiKey({ email: user.email, tenant: tenant.slug, name: "granted", overridePlan: true });
    expect(issued.planOverride).toBe(true);
    expect(issued.plan).toBe("free");
    expect(await keyRows(tenant.id)).toHaveLength(1);
    expect((await (await withKey(issued.key)).auth.me()).user?.id).toBe(user.id);
  });

  it("a used-up allowance is enforced by default and bypassed with --override-plan", async () => {
    const { user, tenant } = await setup("owner", "pro");
    for (let i = 0; i < 3; i++) await issueApiKey({ email: user.email, tenant: tenant.slug, name: `k${i}` });
    await expectRefused(issueApiKey({ email: user.email, tenant: tenant.slug, name: "k3" }), /allows up to 3 API keys.*--override-plan/);
    expect(await keyRows(tenant.id)).toHaveLength(3);
    await issueApiKey({ email: user.email, tenant: tenant.slug, name: "k3", overridePlan: true });
    expect(await keyRows(tenant.id)).toHaveLength(4);
  });
});

describe("A1: a plan override is visible in the tenant's own alert", () => {
  const alertFor = async (keyId: string) =>
    (await getTenantTestDb().select().from(notificationOutbox).where(eq(notificationOutbox.dedupeKey, `api_key.created:${keyId}`)))[0];

  it("names 'Hisaabo operator (plan override)' and carries planOverride: true when the limit was actually bypassed", async () => {
    const { user, tenant } = await setup("owner", "free");
    const issued = await issueApiKey({ email: user.email, tenant: tenant.slug, name: "granted", overridePlan: true });
    const ev = await alertFor(issued.id);
    expect(ev.payload).toEqual({ keyName: "granted", keyPrefix: issued.keyPrefix, createdByName: OPERATOR_OVERRIDE_LABEL, planOverride: true });
    expect(OPERATOR_OVERRIDE_LABEL).toBe("Hisaabo operator (plan override)");
  });

  it("does not claim an override when --override-plan was passed but the plan allowed the key anyway", async () => {
    const { user, tenant } = await setup("owner", "business");
    const cap = capture();
    expect(await runApiKey(["create", user.email, "--tenant", tenant.slug, "--name", "not needed", "--override-plan"], cap.io, { close: false })).toBe(0);
    const [row] = await keyRows(tenant.id);
    const ev = await alertFor(row.id);
    expect(ev.payload).toEqual({ keyName: "not needed", keyPrefix: row.keyPrefix, createdByName: OPERATOR_LABEL });
    expect(cap.err).not.toMatch(/WARNING --override-plan/);
    expect(cap.err).not.toMatch(/PLAN LIMIT OVERRIDDEN/);
  });

  it("only the plan's own refusal can be overridden", async () => {
    const { user, tenant } = await setup("owner", "free");
    const plan = await import("../../lib/plan-limits.js");
    vi.spyOn(plan, "enforceApiKeyLimit").mockRejectedValueOnce(new Error("connection terminated"));
    await expectRefused(issueApiKey({ email: user.email, tenant: tenant.slug, name: "x", overridePlan: true }), /connection terminated/);
    expect(await keyRows(tenant.id)).toHaveLength(0);
  });
});

describe("A2: unverified accounts", () => {
  it("is refused by default, with the reason, and nothing is written", async () => {
    const user = await createUser({ emailVerified: false });
    const tenant = await createTenant({ plan: "business" });
    await addMember(tenant.id, user.id, "owner");
    await expectRefused(issueApiKey({ email: user.email, tenant: tenant.slug, name: "x" }), /has not verified their email.*nobody has proven.*revoked at the account's first email-link sign-in.*--allow-unverified/);
    expect(await keyRows(tenant.id)).toHaveLength(0);

    const cap = capture();
    expect(await runApiKey(["create", user.email, "--tenant", tenant.slug, "--name", "x"], cap.io, { close: false })).toBe(1);
    expect(cap.err).toMatch(/has not verified their email/);
    expect(cap.out).toBe("");
  });

  it("--allow-unverified issues it, warns, and records it in the audit line and event", async () => {
    const user = await createUser({ emailVerified: false });
    const tenant = await createTenant({ plan: "business" });
    await addMember(tenant.id, user.id, "owner");
    const warn = vi.spyOn(logger, "warn").mockImplementation((() => undefined) as never);
    const cap = capture();
    expect(await runApiKey(["create", user.email, "--tenant", tenant.slug, "--name", "ok", "--allow-unverified"], cap.io, { close: false })).toBe(0);
    expect(await keyRows(tenant.id)).toHaveLength(1);
    expect(cap.err).toMatch(/WARNING --allow-unverified/);
    expect(cap.err).toMatch(/UNVERIFIED EMAIL \(--allow-unverified\)/);
    const ev = warn.mock.calls.map((c) => c[0] as Record<string, unknown>).find((o) => o?.event === "api_key_operator_issued");
    expect(ev).toMatchObject({ allowUnverified: true, planOverride: false });
  });

  it("verified accounts are unaffected, and the flag is only for create", async () => {
    const { user, tenant } = await setup("owner");
    const issued = await issueApiKey({ email: user.email, tenant: tenant.slug, name: "verified", allowUnverified: true });
    expect(issued.unverified).toBe(false);
    expect(parseApiKeyArgs(["create", "a@b.in", "--tenant", "t", "--name", "n", "--allow-unverified"]).allowUnverified).toBe(true);
    expect(() => parseApiKeyArgs(["list", "a@b.in", "--allow-unverified"])).toThrow(/only an email/);
    expect(() => parseApiKeyArgs(["revoke", "id", "--allow-unverified"])).toThrow(/only a key id/);
  });
});

describe("A3: stdout carries only the key block", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgRoot = resolve(here, "..", "..", "..");

  for (const nodeEnv of ["production", "development"]) {
    it(`NODE_ENV=${nodeEnv}: the structured security event goes to stderr, never stdout`, async () => {
      const { user, tenant } = await setup("owner");
      const res = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/bin/admin.ts", "api-key", "create", user.email, "--tenant", tenant.slug, "--name", "scripted"],
        { cwd: pkgRoot, encoding: "utf8", env: { ...process.env, NODE_ENV: nodeEnv }, timeout: 60_000 },
      );
      expect(res.status, res.stderr).toBe(0);
      // stdout: exactly the key block
      expect(res.stdout.trimStart().startsWith(`API key created for ${user.email.toLowerCase()}`)).toBe(true);
      expect(res.stdout).not.toContain("api_key_operator_issued");
      expect(res.stdout).not.toContain('"sec"');
      expect(res.stdout).not.toMatch(/\[audit\]/);
      expect(res.stdout).toMatch(/Key\s+hisaabo_key_/);
      // stderr: the audit line and the structured event
      expect(res.stderr).toContain("[audit] admin api-key created");
      expect(res.stderr).toContain("api_key_operator_issued");
      const raw = /Key\s+(hisaabo_key_\S+)/.exec(res.stdout)![1];
      expect(res.stderr).not.toContain(raw);
      const [row] = await keyRows(tenant.id);
      expect(row.keyHash).toBe(sha256(raw));
    }, 90_000);
  }
});

describe("api-key CLI (runApiKey): output, audit and secrecy", () => {
  it("create prints the key once on stdout; stderr and the structured log never contain it", async () => {
    const { user, tenant } = await setup("owner", "free");
    const warn = vi.spyOn(logger, "warn").mockImplementation((() => undefined) as never);
    const cap = capture();
    const code = await runApiKey(["create", user.email, "--tenant", tenant.slug, "--name", "ci", "--expires-days", "30", "--override-plan"], cap.io, { close: false });
    expect(code).toBe(0);

    const [row] = await keyRows(tenant.id);
    const raw = /Key\s+(hisaabo_key_\S+)/.exec(cap.out)?.[1];
    expect(raw).toBeTruthy();
    expect(sha256(raw!)).toBe(row.keyHash);
    expect(cap.out.split(raw!)).toHaveLength(2); // exactly once
    expect(cap.out).toContain(`ID       ${row.id}`);
    expect(cap.out).toContain(`Prefix   ${row.keyPrefix}`);
    expect(cap.out).toMatch(/Expires  \d{4}-\d{2}-\d{2}T/);
    expect(cap.out).toMatch(/shown only once/);
    expect(cap.out).toContain("Acts as");

    expect(cap.err).not.toContain(raw!);
    expect(cap.err).toMatch(/\[audit\] admin api-key created: key .* PLAN LIMIT OVERRIDDEN \(plan free\)/);
    expect(cap.err).toMatch(/WARNING --override-plan/);

    // structured security event: ids and flags only
    const events = warn.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((o) => o?.event === "api_key_operator_issued");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sec: true, event: "api_key_operator_issued", keyId: row.id, tenantId: tenant.id, userId: user.id, planOverride: true });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(raw!);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(row.keyHash);
  });

  it("exits non-zero with one clear line for refusals and bad usage", async () => {
    const { user, tenant } = await setup("member");
    const a = capture();
    expect(await runApiKey(["create", user.email, "--tenant", tenant.slug, "--name", "x"], a.io, { close: false })).toBe(1);
    expect(a.err).toMatch(/^hisaabo admin: .* is "member" in /);
    expect(a.out).toBe("");

    for (const bad of [[], ["frobnicate"], ["create", "a@b.in"], ["create", "a@b.in", "--tenant", "t"], ["revoke"], ["list"], ["create", "a@b.in", "--tenant", "t", "--name", "n", "--bogus"]]) {
      const c = capture();
      expect(await runApiKey(bad, c.io, { close: false }), JSON.stringify(bad)).toBe(2);
      expect(c.err).toMatch(/^hisaabo admin: /);
    }
    const help = capture();
    expect(await runApiKey(["--help"], help.io, { close: false })).toBe(0);
    expect(help.out).toContain("api-key create <email> --tenant");
  });

  it("list shows id, name, prefix, tenant, created, last used and expiry, and never the key or hash", async () => {
    const { user, tenant } = await setup("owner");
    const a = await issueApiKey({ email: user.email, tenant: tenant.slug, name: "first" });
    const b = await issueApiKey({ email: user.email, tenant: tenant.slug, name: "second", expiresDays: 10 });
    await getControlDb().update(apiKeys).set({ lastUsedAt: new Date("2026-05-01T10:00:00Z"), expiresAt: new Date(Date.now() - DAY) }).where(eq(apiKeys.id, a.id));

    const { user: u, keys } = await listApiKeys({ email: user.email });
    expect(keys.map((k) => k.name)).toEqual(["first", "second"]);
    expect(Object.keys(keys[0]).sort()).toEqual(["createdAt", "expiresAt", "id", "keyPrefix", "lastUsedAt", "name", "tenantId", "tenantName", "tenantSlug"]);

    const masked = formatKeyList(u, keys, false);
    const revealed = formatKeyList(u, keys, true);
    for (const text of [masked, revealed]) {
      expect(text).toContain(a.id);
      expect(text).toContain(b.id);
      expect(text).toContain("first");
      expect(text).toContain(a.keyPrefix + "…");
      expect(text).toContain("2026-05-01T10:00:00.000Z"); // last used
      expect(text).toContain("(expired)");
      expect(text).toContain("never"); // b has never been used
      for (const secret of [a.key, b.key, sha256(a.key), sha256(b.key)]) expect(text).not.toContain(secret);
      // the prefix is only 20 characters of a 54 character key
      expect(text).not.toContain(a.key.slice(0, 30));
    }
    // privacy: tenant and email masked unless --reveal
    expect(masked).toContain(`Tenant ${tenantHandle(tenant.id)}`);
    expect(masked).not.toContain(tenant.slug);
    expect(masked).not.toContain(tenant.name);
    expect(masked).not.toContain(user.email);
    expect(revealed).toContain(`${tenant.name} (${tenant.slug})`);
    expect(revealed).toContain(user.email);

    // through the CLI entry point, with and without --tenant / --reveal
    const cap = capture();
    expect(await runApiKey(["list", user.email, "--tenant", tenant.id], cap.io, { close: false })).toBe(0);
    expect(cap.out).toContain("2 API keys");
    expect(cap.out).not.toContain(tenant.slug);
    const cap2 = capture();
    expect(await runApiKey(["list", user.email, "--reveal"], cap2.io, { close: false })).toBe(0);
    expect(cap2.out).toContain(tenant.slug);
  });

  it("list --tenant only shows that tenant's keys; an empty list says so", async () => {
    const one = await setup("owner");
    const two = await setup("owner");
    // the same person is an owner in both
    await addMember(two.tenant.id, one.user.id, "owner");
    await issueApiKey({ email: one.user.email, tenant: one.tenant.slug, name: "in-one" });
    await issueApiKey({ email: one.user.email, tenant: two.tenant.slug, name: "in-two" });
    expect((await listApiKeys({ email: one.user.email })).keys).toHaveLength(2);
    expect((await listApiKeys({ email: one.user.email, tenant: two.tenant.slug })).keys.map((k) => k.name)).toEqual(["in-two"]);
    const lonely = await createUser();
    expect(formatKeyList(lonely, [], true)).toContain(`No API keys for ${lonely.email}`);
    await expect(listApiKeys({ email: "nobody@example.in" })).rejects.toThrow(/no user with email/);
  });

  it("revoke deletes the key, the key stops authenticating at once, and it is audited", async () => {
    const { user, tenant } = await setup("owner");
    const issued = await issueApiKey({ email: user.email, tenant: tenant.slug, name: "short-lived" });
    // warm the API key cache first: revocation must beat it
    const api = await withKey(issued.key);
    await expect(api.tenant.list()).resolves.toBeTruthy();
    await expect((await withKey(issued.key)).tenant.list()).resolves.toBeTruthy();

    const warn = vi.spyOn(logger, "warn").mockImplementation((() => undefined) as never);
    const cap = capture();
    expect(await runApiKey(["revoke", issued.id], cap.io, { close: false })).toBe(0);
    expect(cap.out).toContain(`Revoked API key ${issued.id}`);
    expect(cap.out).toContain("no longer authenticates");
    expect(cap.err).toMatch(/\[audit\] admin api-key revoked: key .* of user .* in tenant /);
    expect(cap.err).not.toContain(issued.key);

    expect(await keyRows(tenant.id)).toHaveLength(0);
    await expect((await withKey(issued.key)).tenant.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect((await withKey(issued.key)).auth.me()).resolves.toMatchObject({ user: null });

    const events = warn.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((o) => o?.event === "api_key_operator_revoked");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sec: true, keyId: issued.id, tenantId: tenant.id, userId: user.id });
  });

  it("revoke of an unknown or malformed id fails cleanly and touches nothing", async () => {
    const { user, tenant } = await setup("owner");
    const issued = await issueApiKey({ email: user.email, tenant: tenant.slug, name: "keep" });
    await expect(revokeApiKey(randomUUID())).rejects.toThrow(/no API key with id/);
    await expect(revokeApiKey("not-a-uuid")).rejects.toThrow(/not a key id/);
    const cap = capture();
    expect(await runApiKey(["revoke", randomUUID()], cap.io, { close: false })).toBe(1);
    expect(cap.err).toMatch(/no API key with id/);
    expect(await keyRows(tenant.id)).toHaveLength(1);
    await expect((await withKey(issued.key)).tenant.list()).resolves.toBeTruthy();
    // a second revoke of the same id is an error, not a silent success
    await revokeApiKey(issued.id);
    await expect(revokeApiKey(issued.id)).rejects.toThrow(/no API key with id/);
  });
});

describe("the router's apiKey.create still behaves as before (shared minting code)", () => {
  it("returns {id,name,key,keyPrefix,expiresAt}, stores the hash, authenticates, alerts as the user", async () => {
    const { user, tenant } = await setup("owner", "pro");
    const created = await callerFor(user, tenant.id).apiKey.create({ name: "from the web" });
    expect(Object.keys(created).sort()).toEqual(["expiresAt", "id", "key", "keyPrefix", "name"]);
    expect(created.key).toMatch(/^hisaabo_key_/);
    const [row] = await keyRows(tenant.id);
    expect(row.keyHash).toBe(sha256(created.key));
    expect((await (await withKey(created.key)).auth.me()).user?.id).toBe(user.id);

    const [ev] = await getTenantTestDb().select().from(notificationOutbox).where(eq(notificationOutbox.dedupeKey, `api_key.created:${created.id}`));
    expect(ev.actorKind).toBe("user");
    expect(ev.actorUserId).toBe(user.id);
    expect(ev.payload).toMatchObject({ keyName: "from the web", createdByName: user.name });
  });

  it("still enforces roles and the plan limit", async () => {
    const { user: seller, tenant } = await setup("seller", "pro");
    await expect(callerFor(seller, tenant.id).apiKey.create({ name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const free = await setup("owner", "free");
    await expect(callerFor(free.user, free.tenant.id).apiKey.create({ name: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await keyRows(free.tenant.id)).toHaveLength(0);
  });

  it("revoke through the router and an operator revoke are interchangeable on the same row", async () => {
    const { user, tenant } = await setup("owner");
    const viaCli = await issueApiKey({ email: user.email, tenant: tenant.slug, name: "cli-made" });
    await callerFor(user, tenant.id).apiKey.revoke({ id: viaCli.id });
    expect(await keyRows(tenant.id)).toHaveLength(0);
    const viaWeb = await callerFor(user, tenant.id).apiKey.create({ name: "web-made" });
    await revokeApiKey(viaWeb.id);
    expect(await keyRows(tenant.id)).toHaveLength(0);
  });
});

describe("parseApiKeyArgs", () => {
  it("parses the three subcommands", () => {
    expect(parseApiKeyArgs(["create", "a@b.in", "--tenant", "acme", "--name", "MCP server", "--expires-days", "30", "--override-plan"])).toMatchObject({
      command: "create", email: "a@b.in", tenant: "acme", name: "MCP server", expiresDays: 30, overridePlan: true,
    });
    expect(parseApiKeyArgs(["list", "a@b.in", "--tenant", "acme", "--reveal"])).toMatchObject({ command: "list", email: "a@b.in", tenant: "acme", reveal: true });
    expect(parseApiKeyArgs(["revoke", "5b0c7f0e-0000-4000-8000-000000000000"])).toMatchObject({ command: "revoke", keyId: "5b0c7f0e-0000-4000-8000-000000000000" });
    expect(parseApiKeyArgs(["--help"]).help).toBe(true);
    expect(parseApiKeyArgs(["create", "--help"]).help).toBe(true);
  });

  it("rejects missing and mixed-up arguments", () => {
    expect(() => parseApiKeyArgs([])).toThrow(/needs a subcommand/);
    expect(() => parseApiKeyArgs(["nuke"])).toThrow(/unknown api-key subcommand/);
    expect(() => parseApiKeyArgs(["create", "a@b.in", "--name", "n"])).toThrow(/--tenant/);
    expect(() => parseApiKeyArgs(["create", "a@b.in", "--tenant", "t"])).toThrow(/--name/);
    expect(() => parseApiKeyArgs(["create", "a@b.in", "b@c.in", "--tenant", "t", "--name", "n"])).toThrow(/exactly one/);
    expect(() => parseApiKeyArgs(["revoke", "id", "--tenant", "t"])).toThrow(/only a key id/);
    expect(() => parseApiKeyArgs(["list", "a@b.in", "--override-plan"])).toThrow(/only an email/);
    expect(() => parseApiKeyArgs(["create", "a@b.in", "--tenant"])).toThrow(/needs a value/);
  });
});
