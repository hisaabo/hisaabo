/**
 * Integration regression tests (require TEST_DATABASE_URL):
 *   - accepted invitations never re-grant membership
 *   - removeMember revokes API keys, invitations and session tenant selection
 *   - removed users are blocked by hasTenantAccess even with a stale session
 *   - invitations match emails case-insensitively
 *   - unverified accounts cannot accept invitations
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { createHash, randomUUID } from "crypto";
import { apiKeys, invitations, sessions, tenantMembers } from "@hisaabo/db";
import { createUser, createTenant, addMember, createSession, type TestUser, type TestTenant } from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";

const factory = createCallerFactory(appRouter);

function callerFor(user: TestUser, sessionId: string, tenantId: string | null) {
  const headers = new Headers({
    cookie: `session_id=${sessionId}`,
    "x-requested-with": "hisaabo",
  });
  return factory({
    user: { id: user.id, email: user.email, name: user.name },
    tenantId,
    businessId: null,
    req: new Request("http://localhost:3000/api/trpc/test", { method: "POST", headers }),
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

let owner: TestUser;
let tenant: TestTenant;
let ownerSession: Awaited<ReturnType<typeof createSession>>;

beforeAll(async () => {
  owner = await createUser({ email: "owner.revoke@example.in" });
  tenant = await createTenant({ name: "Revoke Co" });
  await addMember(tenant.id, owner.id, "owner");
  ownerSession = await createSession(owner.id, tenant.id);
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("acceptInvitation", () => {
  it("does not re-add a removed member from an already-accepted invitation", async () => {
    const user = await createUser({ email: `readd.${randomUUID().slice(0, 8)}@example.in` });
    const raw = randomUUID();
    await getControlDb().insert(invitations).values({
      tenantId: tenant.id, email: user.email, role: "admin", token: hash(raw),
      invitedBy: owner.id, expiresAt: new Date(Date.now() + 86_400_000), acceptedAt: new Date(),
    });
    const s = await createSession(user.id);
    await expect(callerFor(user, s.id, null).tenant.acceptInvitation({ token: raw })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const rows = await getControlDb().select().from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, user.id)));
    expect(rows).toHaveLength(0);
  });

  it("matches a mixed-case stored invitation email", async () => {
    const user = await createUser({ email: `mixed.${randomUUID().slice(0, 8)}@example.in` });
    const raw = randomUUID();
    await getControlDb().insert(invitations).values({
      tenantId: tenant.id, email: user.email.toUpperCase(), role: "seller", token: hash(raw),
      invitedBy: owner.id, expiresAt: new Date(Date.now() + 86_400_000),
    });
    const s = await createSession(user.id);
    const res = await callerFor(user, s.id, null).tenant.acceptInvitation({ token: raw });
    expect(res.tenantId).toBe(tenant.id);
  });

  it("refuses accounts whose email is not verified", async () => {
    const user = await createUser({ email: `unverified.${randomUUID().slice(0, 8)}@example.in`, emailVerified: false });
    const raw = randomUUID();
    await getControlDb().insert(invitations).values({
      tenantId: tenant.id, email: user.email, role: "seller", token: hash(raw),
      invitedBy: owner.id, expiresAt: new Date(Date.now() + 86_400_000),
    });
    const s = await createSession(user.id);
    await expect(callerFor(user, s.id, null).tenant.acceptInvitation({ token: raw })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("removeMember", () => {
  it("deletes the member's API keys and invitations and blocks stale sessions", async () => {
    const victim = await createUser({ email: `victim.${randomUUID().slice(0, 8)}@example.in` });
    await addMember(tenant.id, victim.id, "admin");
    const victimSession = await createSession(victim.id, tenant.id);
    const db = getControlDb();
    await db.insert(apiKeys).values({
      userId: victim.id, tenantId: tenant.id, keyHash: hash(randomUUID()), keyPrefix: "hisaabo_key_xxxxxxxx", name: "k",
    });
    await db.insert(invitations).values({
      tenantId: tenant.id, email: victim.email, role: "admin", token: hash(randomUUID()),
      invitedBy: owner.id, expiresAt: new Date(Date.now() + 86_400_000), acceptedAt: new Date(),
    });

    await callerFor(owner, ownerSession.id, tenant.id).tenant.removeMember({ userId: victim.id });

    expect(await db.select().from(apiKeys).where(eq(apiKeys.userId, victim.id))).toHaveLength(0);
    expect(await db.select().from(invitations).where(eq(invitations.tenantId, tenant.id))
      .then((r) => r.filter((i) => i.email === victim.email))).toHaveLength(0);
    const [sess] = await db.select().from(sessions).where(eq(sessions.id, victimSession.id));
    expect(sess?.tenantId).toBeNull();

    // A request still carrying the old tenantId is rejected by hasTenantAccess.
    await expect(callerFor(victim, victimSession.id, tenant.id).tenant.current()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("tenant.current", () => {
  it("does not expose database connection columns", async () => {
    const res = await callerFor(owner, ownerSession.id, tenant.id).tenant.current();
    expect(res).not.toBeNull();
    for (const key of Object.keys(res as object)) expect(key).not.toMatch(/^db/);
  });
});
