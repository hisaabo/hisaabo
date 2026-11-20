/**
 * tenant-verified-gate.test.ts — cloud-only verified-email gate for team changes,
 * and claim-time cleanup of what a pre-registered account left behind.
 *
 * Requires the PostgreSQL test database (TEST_DATABASE_URL).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi, type MockInstance } from "vitest";
import { eq, and } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { nanoid } from "nanoid";
import { tenantMembers, invitations, magicLinkTokens } from "@hisaabo/db";
import { createUser, createTenant, addMember, createSession, type TestUser, type TestTenant } from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { emailService } from "../../lib/email.js";
import { logger } from "../../lib/logger.js";

const factory = createCallerFactory(appRouter);
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

function callerFor(user: { id: string; email: string; name: string | null }, sessionId: string, tenantId: string | null) {
  const headers = new Headers({ cookie: `session_id=${sessionId}`, "x-requested-with": "hisaabo" });
  return factory({
    user: { id: user.id, email: user.email, name: user.name },
    tenantId,
    businessId: null,
    req: new Request("http://localhost:3000/api/trpc/test", { method: "POST", headers }),
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

const anonCaller = (headers: Record<string, string> = {}) => factory(createTestContext({ headers }));

let inviteSpy: MockInstance<typeof emailService.sendInvitation>;
let noticeSpy: MockInstance<typeof emailService.sendSecurityNotice>;
let magicSpy: MockInstance<typeof emailService.sendMagicLink>;
const SAVED_MT = process.env.MULTI_TENANT;
const SAVED_OPEN = process.env.ALLOW_OPEN_SIGNUP;

beforeAll(() => {
  inviteSpy = vi.spyOn(emailService, "sendInvitation").mockResolvedValue(undefined);
  noticeSpy = vi.spyOn(emailService, "sendSecurityNotice").mockResolvedValue(undefined);
  magicSpy = vi.spyOn(emailService, "sendMagicLink").mockResolvedValue(undefined);
});
beforeEach(() => {
  inviteSpy.mockClear();
  noticeSpy.mockClear();
  magicSpy.mockClear();
});
afterEach(() => {
  if (SAVED_MT === undefined) delete process.env.MULTI_TENANT;
  else process.env.MULTI_TENANT = SAVED_MT;
  if (SAVED_OPEN === undefined) delete process.env.ALLOW_OPEN_SIGNUP;
  else process.env.ALLOW_OPEN_SIGNUP = SAVED_OPEN;
});
afterAll(async () => {
  inviteSpy.mockRestore();
  noticeSpy.mockRestore();
  magicSpy.mockRestore();
  await truncateAllTables();
  await closeTestDb();
});

interface Org {
  tenant: TestTenant;
  owner: TestUser;
  ownerCaller: ReturnType<typeof callerFor>;
  member: TestUser;
}

/** A tenant with an owner (verified or not) and one existing admin member. */
async function newOrg(ownerVerified: boolean): Promise<Org> {
  const tenant = await createTenant({ name: `Gate Co ${nanoid(5)}` });
  const owner = await createUser({ email: `owner.${nanoid(8).toLowerCase()}@example.in`, name: "Owner", emailVerified: ownerVerified });
  await addMember(tenant.id, owner.id, "owner");
  const member = await createUser({ email: `member.${nanoid(8).toLowerCase()}@example.in`, name: "Member" });
  await addMember(tenant.id, member.id, "admin");
  const session = await createSession(owner.id, tenant.id);
  return { tenant, owner, ownerCaller: callerFor(owner, session.id, tenant.id), member };
}

const newEmail = () => `new.${nanoid(8).toLowerCase()}@example.in`;
const gateMessage = /Verify your email address before inviting or changing team members/;

describe("cloud (MULTI_TENANT=true): unverified owners cannot grow or reshape a team", () => {
  beforeEach(() => {
    process.env.MULTI_TENANT = "true";
  });

  it("inviteMember and updateMemberRole are FORBIDDEN, and nothing is written", async () => {
    const org = await newOrg(false);
    const email = newEmail();
    await expect(org.ownerCaller.tenant.inviteMember({ email, role: "seller" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(gateMessage),
    });
    expect(await getControlDb().select().from(invitations).where(eq(invitations.tenantId, org.tenant.id))).toHaveLength(0);
    expect(inviteSpy).not.toHaveBeenCalled();

    await expect(org.ownerCaller.tenant.updateMemberRole({ userId: org.member.id, role: "seller" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(gateMessage),
    });
    const [m] = await getControlDb().select().from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, org.tenant.id), eq(tenantMembers.userId, org.member.id)));
    expect(m!.role).toBe("admin");
  });

  it("the same owner can still remove a member and revoke an invitation", async () => {
    const org = await newOrg(false);
    const [inv] = await getControlDb().insert(invitations).values({
      tenantId: org.tenant.id, email: newEmail(), role: "seller", token: hash(randomUUID()),
      invitedBy: org.owner.id, expiresAt: new Date(Date.now() + 86_400_000),
    }).returning();

    await expect(org.ownerCaller.tenant.revokeInvitation({ invitationId: inv!.id })).resolves.toBeTruthy();
    await expect(org.ownerCaller.tenant.removeMember({ userId: org.member.id })).resolves.toBeTruthy();
    expect(await getControlDb().select().from(invitations).where(eq(invitations.id, inv!.id))).toHaveLength(0);
    expect(await getControlDb().select().from(tenantMembers).where(eq(tenantMembers.userId, org.member.id))).toHaveLength(0);
  });

  it("a verified owner succeeds", async () => {
    const org = await newOrg(true);
    await expect(org.ownerCaller.tenant.inviteMember({ email: newEmail(), role: "seller" })).resolves.toBeTruthy();
    await expect(org.ownerCaller.tenant.updateMemberRole({ userId: org.member.id, role: "seller" })).resolves.toEqual({ success: true });
  });

  it("canInviteMembers mirrors the gate", async () => {
    const unverified = await newOrg(false);
    const verified = await newOrg(true);
    await expect(unverified.ownerCaller.tenant.canInviteMembers()).resolves.toEqual({ allowed: false, reason: "email_unverified" });
    await expect(verified.ownerCaller.tenant.canInviteMembers()).resolves.toEqual({ allowed: true, reason: null });
  });
});

describe("self-hosted (MULTI_TENANT unset): no gate, v0.9.0 behaviour", () => {
  beforeEach(() => {
    delete process.env.MULTI_TENANT;
  });

  it("an unverified owner can still invite and change roles", async () => {
    const org = await newOrg(false);
    await expect(org.ownerCaller.tenant.inviteMember({ email: newEmail(), role: "seller" })).resolves.toBeTruthy();
    await expect(org.ownerCaller.tenant.updateMemberRole({ userId: org.member.id, role: "seller" })).resolves.toEqual({ success: true });
    await expect(org.ownerCaller.tenant.canInviteMembers()).resolves.toEqual({ allowed: true, reason: null });
  });
});

describe("pre-registered account: claim-time cleanup and notice", () => {
  const db = getControlDb();
  let warnSpy: MockInstance<typeof logger.warn>;
  beforeAll(() => {
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  });
  afterAll(() => warnSpy.mockRestore());
  beforeEach(() => warnSpy.mockClear());

  async function seedMagicToken(email: string): Promise<string> {
    const raw = "gate-" + nanoid(32);
    await db.insert(magicLinkTokens).values({
      email,
      tokenHash: hash(raw),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    return raw;
  }

  const claimEvent = () =>
    warnSpy.mock.calls.map((c) => c[0] as Record<string, unknown>).find((o) => o && o.event === "unverified_account_claimed");

  /** What `auth.register` leaves behind (unverified, password set), owning an org that already has people. */
  async function preRegisteredOwner() {
    const tenant = await createTenant({ name: "Victim Traders" });
    const victimEmail = `victim.${nanoid(8).toLowerCase()}@example.in`;
    const pre = await createUser({ email: victimEmail, name: "Pre", emailVerified: false });
    await addMember(tenant.id, pre.id, "owner");
    const planted = await createUser({ email: `planted.${nanoid(8).toLowerCase()}@example.in`, name: "Planted" });
    await addMember(tenant.id, planted.id, "admin");
    const raw = randomUUID();
    await db.insert(invitations).values({
      tenantId: tenant.id, email: `ally.${nanoid(6).toLowerCase()}@example.in`, role: "admin", token: hash(raw),
      invitedBy: pre.id, expiresAt: new Date(Date.now() + 86_400_000),
    });
    return { tenant, pre, planted, victimEmail, inviteRaw: raw };
  }

  it("the first magic-link sign-in deletes the pending invitation, keeps the member, notifies the owner and logs both counts", async () => {
    const { tenant, pre, planted, victimEmail, inviteRaw } = await preRegisteredOwner();

    await anonCaller({ "x-hisaabo-client": "mobile" }).auth.verifyMagicLink({ token: await seedMagicToken(victimEmail) });

    // The pending invitation the pre-registered account issued is gone: its token is dead.
    expect(await db.select().from(invitations).where(eq(invitations.invitedBy, pre.id))).toHaveLength(0);
    const invitee = await createUser({ email: "ally-stranger@example.in", name: "Stranger" });
    const s = await createSession(invitee.id);
    await expect(callerFor(invitee, s.id, null).tenant.acceptInvitation({ token: inviteRaw })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The existing member is NOT removed automatically...
    const members = await db.select().from(tenantMembers).where(eq(tenantMembers.tenantId, tenant.id));
    expect(members.map((m) => m.userId)).toContain(planted.id);

    // ...but the owner is told exactly who, once.
    await vi.waitFor(() => expect(noticeSpy).toHaveBeenCalledOnce());
    const [to, orgs] = noticeSpy.mock.calls[0]!;
    expect(to).toBe(victimEmail);
    expect(orgs).toEqual([{ orgName: "Victim Traders", members: [{ email: planted.email, role: "admin" }] }]);

    // The security event carries both counts (and no email).
    const ev = claimEvent();
    expect(ev).toMatchObject({ sec: true, event: "unverified_account_claimed", userId: pre.id, pendingInvitations: 1, otherMembers: 1 });
    expect(JSON.stringify(ev)).not.toContain(victimEmail);
  });

  it("a failing security notice never fails the sign-in", async () => {
    const { victimEmail } = await preRegisteredOwner();
    noticeSpy.mockRejectedValueOnce(new Error("mail down"));
    await expect(
      anonCaller({ "x-hisaabo-client": "mobile" }).auth.verifyMagicLink({ token: await seedMagicToken(victimEmail) }),
    ).resolves.toMatchObject({ user: { email: victimEmail } });
  });

  it("an owner with nobody else in the org gets no notice", async () => {
    const tenant = await createTenant({ name: "Solo Co" });
    const solo = await createUser({ email: `solo.${nanoid(8).toLowerCase()}@example.in`, emailVerified: false });
    await addMember(tenant.id, solo.id, "owner");
    await anonCaller({ "x-hisaabo-client": "mobile" }).auth.verifyMagicLink({ token: await seedMagicToken(solo.email) });
    await new Promise((r) => setTimeout(r, 100));
    expect(noticeSpy).not.toHaveBeenCalled();
    expect(claimEvent()).toMatchObject({ pendingInvitations: 0, otherMembers: 0 });
  });

  it("a normal sign-in of a verified account deletes nothing and sends no notice", async () => {
    const tenant = await createTenant({ name: "Verified Co" });
    const owner = await createUser({ email: `vowner.${nanoid(8).toLowerCase()}@example.in`, emailVerified: true });
    await addMember(tenant.id, owner.id, "owner");
    const other = await createUser({ email: `vother.${nanoid(8).toLowerCase()}@example.in` });
    await addMember(tenant.id, other.id, "admin");
    await db.insert(invitations).values({
      tenantId: tenant.id, email: newEmail(), role: "seller", token: hash(randomUUID()),
      invitedBy: owner.id, expiresAt: new Date(Date.now() + 86_400_000),
    });

    await anonCaller({ "x-hisaabo-client": "mobile" }).auth.verifyMagicLink({ token: await seedMagicToken(owner.email) });
    await new Promise((r) => setTimeout(r, 100));

    expect(await db.select().from(invitations).where(eq(invitations.invitedBy, owner.id))).toHaveLength(1);
    expect(await db.select().from(tenantMembers).where(eq(tenantMembers.tenantId, tenant.id))).toHaveLength(2);
    expect(noticeSpy).not.toHaveBeenCalled();
    expect(claimEvent()).toBeUndefined();
  });

  it("end to end: a pre-registered victim cannot invite in the cloud before claiming, and can after", async () => {
    process.env.MULTI_TENANT = "true";
    const { tenant, pre, victimEmail } = await preRegisteredOwner();
    const session = await createSession(pre.id, tenant.id);
    const caller = callerFor(pre, session.id, tenant.id);

    await expect(caller.tenant.inviteMember({ email: newEmail(), role: "seller" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The mailbox owner signs in by email link for the first time: the account is now verified.
    const res = await anonCaller({ "x-hisaabo-client": "mobile" }).auth.verifyMagicLink({ token: await seedMagicToken(victimEmail) });
    const fresh = callerFor(pre, res.sessionToken!, tenant.id);
    await expect(fresh.tenant.inviteMember({ email: newEmail(), role: "seller" })).resolves.toBeTruthy();
  });
});
