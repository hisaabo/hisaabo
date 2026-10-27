/**
 * signup-policy.test.ts — invite-only self-hosted signup, sessionToken
 * presence by client, and system.config.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { users, tenantMembers, tenants, invitations, magicLinkTokens } from "@hisaabo/db";
import { createUser, createTenant, addMember } from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { emailService } from "../../lib/email.js";

const factory = createCallerFactory(appRouter);
const db = getControlDb();

function caller(client?: string, user?: { id: string; email: string; name: string | null }) {
  return factory(createTestContext({
    ...(user ? { user, authTokenKind: "cookie" as const } : {}),
    ...(client ? { headers: { "x-hisaabo-client": client } } : {}),
  }));
}

const email = (p: string) => `${p}.${randomUUID().slice(0, 8)}@vyapar.in`;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

async function magicToken(to: string) {
  const raw = `ml-${randomUUID()}`;
  await db.insert(magicLinkTokens).values({ email: to, tokenHash: sha(raw), expiresAt: new Date(Date.now() + 15 * 60_000) });
  return raw;
}

async function invite(to: string, tenantId: string) {
  await db.insert(invitations).values({
    tenantId,
    email: to,
    role: "seller",
    token: sha(randomUUID()),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
  });
}

/** Sign up / sign in through the only remaining path: a verified magic link. */
async function signUp(to: string, client?: string) {
  return caller(client).auth.verifyMagicLink({ token: await magicToken(to) });
}

const savedEnv = { open: process.env.ALLOW_OPEN_SIGNUP, mt: process.env.MULTI_TENANT };
beforeEach(async () => {
  await truncateAllTables();
  process.env.ALLOW_OPEN_SIGNUP = "false";
  process.env.MULTI_TENANT = "false";
});
afterEach(() => {
  process.env.ALLOW_OPEN_SIGNUP = savedEnv.open;
  process.env.MULTI_TENANT = savedEnv.mt;
});
afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

const CLOSED = { code: "FORBIDDEN", message: "Sign-up on this server is by invitation only" };

describe("self-hosted invite-only signup (magic link)", () => {
  it("first user becomes owner of the default tenant", async () => {
    const e = email("first");
    await signUp(e);
    const [m] = await db.select().from(tenantMembers).innerJoin(users, eq(users.id, tenantMembers.userId)).where(eq(users.email, e));
    expect(m!.tenant_members.role).toBe("owner");
  });

  it("uninvited new email is rejected, not created, and the token is not burned", async () => {
    await signUp(email("owner"));
    const e = email("stranger");
    const raw = await magicToken(e);
    await expect(caller().auth.verifyMagicLink({ token: raw })).rejects.toMatchObject(CLOSED);
    const [row] = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.tokenHash, sha(raw)));
    expect(row!.usedAt).toBeNull();
    expect(await db.select().from(users).where(eq(users.email, e))).toHaveLength(0);
  });

  it("invited new email is allowed (no auto-membership); existing users can still sign in", async () => {
    const ownerEmail = email("owner");
    await signUp(ownerEmail);
    const [t] = await db.select().from(tenants);
    const e = email("invited");
    await invite(e, t!.id);
    await expect(signUp(e)).resolves.toMatchObject({ isNewUser: true });
    await expect(signUp(ownerEmail)).resolves.toMatchObject({ isNewUser: false });
  });

  it("an expired or accepted invitation does not count", async () => {
    await signUp(email("owner"));
    const [t] = await db.select().from(tenants);
    const e = email("expired");
    await db.insert(invitations).values({ tenantId: t!.id, email: e, role: "seller", token: sha(randomUUID()), expiresAt: new Date(Date.now() - 1000) });
    await expect(signUp(e)).rejects.toMatchObject(CLOSED);
  });

  it("ALLOW_OPEN_SIGNUP=true lets uninvited new emails in (as members)", async () => {
    await signUp(email("owner"));
    process.env.ALLOW_OPEN_SIGNUP = "true";
    const e = email("open");
    await expect(signUp(e)).resolves.toMatchObject({ isNewUser: true });
    const [m] = await db.select().from(tenantMembers).innerJoin(users, eq(users.id, tenantMembers.userId)).where(eq(users.email, e));
    expect(m!.tenant_members.role).toBe("member");
  });

  it("concurrent first signups produce exactly one owner and reject the rest", async () => {
    const results = await Promise.allSettled([
      signUp(email("race1")),
      signUp(email("race2")),
      signUp(email("race3")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const owners = await db.select().from(tenantMembers).where(eq(tenantMembers.role, "owner"));
    expect(owners).toHaveLength(1);
  });
});

describe("sendMagicLink on a closed server", () => {
  const sendSpy = vi.spyOn(emailService, "sendMagicLink").mockResolvedValue(undefined);
  afterAll(() => sendSpy.mockRestore());

  it("is silent for unknown uninvited emails but still reports success, and stores no token", async () => {
    await signUp(email("owner"));
    sendSpy.mockClear();
    const e = email("unknown");
    await expect(caller().auth.sendMagicLink({ email: e, source: "web" })).resolves.toEqual({ success: true });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.email, e))).toHaveLength(0);
  });

  it("sends to existing users, invited emails, the very first user, and when open", async () => {
    const ownerEmail = email("owner");
    // first user (no users yet)
    sendSpy.mockClear();
    await caller().auth.sendMagicLink({ email: email("firstml"), source: "web" });
    expect(sendSpy).toHaveBeenCalledTimes(1);

    await signUp(ownerEmail);
    const [t] = await db.select().from(tenants);

    sendSpy.mockClear();
    await caller().auth.sendMagicLink({ email: ownerEmail, source: "web" });
    const invited = email("inv");
    await invite(invited, t!.id);
    await caller().auth.sendMagicLink({ email: invited, source: "web" });
    expect(sendSpy).toHaveBeenCalledTimes(2);

    process.env.ALLOW_OPEN_SIGNUP = "true";
    await caller().auth.sendMagicLink({ email: email("openml"), source: "web" });
    expect(sendSpy).toHaveBeenCalledTimes(3);
  });

  it("multi-tenant mode is unaffected", async () => {
    await createUser({ email: email("existing") });
    process.env.MULTI_TENANT = "true";
    sendSpy.mockClear();
    await caller().auth.sendMagicLink({ email: email("cloud"), source: "web" });
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});

describe("tenant.create (self-hosted join-default branch)", () => {
  it("first user becomes owner; later uninvited users are rejected", async () => {
    const owner = await createUser({ email: email("o") });
    const res = await caller(undefined, owner).tenant.create();
    const [m] = await db.select().from(tenantMembers).where(eq(tenantMembers.userId, owner.id));
    expect(res.tenantId).toBe(m!.tenantId);
    expect(m!.role).toBe("owner");

    const stranger = await createUser({ email: email("s") });
    await expect(caller(undefined, stranger).tenant.create()).rejects.toMatchObject(CLOSED);
    expect(await db.select().from(tenantMembers).where(eq(tenantMembers.userId, stranger.id))).toHaveLength(0);
  });

  it("invited users and ALLOW_OPEN_SIGNUP are allowed", async () => {
    const t = await createTenant({ slug: "default", name: "Default Organization" });
    const ownerU = await createUser({ email: email("o") });
    await addMember(t.id, ownerU.id, "owner");

    const invitedUser = await createUser({ email: email("inv") });
    await invite(invitedUser.email, t.id);
    await expect(caller(undefined, invitedUser).tenant.create()).resolves.toMatchObject({ tenantId: t.id });

    const openUser = await createUser({ email: email("open") });
    await expect(caller(undefined, openUser).tenant.create()).rejects.toMatchObject(CLOSED);
    process.env.ALLOW_OPEN_SIGNUP = "true";
    await expect(caller(undefined, openUser).tenant.create()).resolves.toMatchObject({ tenantId: t.id });
  });
});

describe("sessionToken only for bearer clients", () => {
  it("verifyMagicLink returns it for desktop, mobile and cli, never for web", async () => {
    process.env.ALLOW_OPEN_SIGNUP = "true";
    for (const client of ["desktop", "mobile", "cli"]) {
      const v = await signUp(email(`ml-${client}`), client);
      expect(typeof v.sessionToken).toBe("string");
    }

    for (const client of [undefined, "web", "unknown"]) {
      const ctx = createTestContext(client ? { headers: { "x-hisaabo-client": client } } : {});
      const v = await factory(ctx).auth.verifyMagicLink({ token: await magicToken(email("mlweb")) });
      expect(v.sessionToken).toBeUndefined();
      expect(ctx.resHeaders.get("Set-Cookie")).toMatch(/^session_id=/);
      expect(JSON.stringify(v)).not.toContain("sessionToken\":\"");
    }
  });
});

describe("system.config", () => {
  it("self-hosted: signupOpen only while there are no users, or when ALLOW_OPEN_SIGNUP", async () => {
    expect(await caller().system.config()).toEqual({ multiTenant: false, signupOpen: true });
    await createUser({ email: email("u") });
    expect(await caller().system.config()).toEqual({ multiTenant: false, signupOpen: false });
    process.env.ALLOW_OPEN_SIGNUP = "true";
    expect(await caller().system.config()).toEqual({ multiTenant: false, signupOpen: true });
  });

  it("multi-tenant: always open", async () => {
    await createUser({ email: email("u") });
    process.env.MULTI_TENANT = "true";
    expect(await caller().system.config()).toEqual({ multiTenant: true, signupOpen: true });
  });
});

describe("tenant.inviteMember response", () => {
  it("returns inviteUrl only when returnLink is true and never a raw token", async () => {
    const t = await createTenant();
    const admin = await createUser({ email: email("adm") });
    await addMember(t.id, admin.id, "owner");
    const c = factory(createTestContext({ user: admin, tenantId: t.id, authTokenKind: "cookie" }));
    const a = await c.tenant.inviteMember({ email: email("a") });
    expect(a.inviteUrl).toBeUndefined();
    expect(a).not.toHaveProperty("token");
    const b = await c.tenant.inviteMember({ email: email("b"), returnLink: true });
    expect(b.inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]+$/);
    expect(b).not.toHaveProperty("token");
  });
});
