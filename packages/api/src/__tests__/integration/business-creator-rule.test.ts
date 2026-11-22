/**
 * business-creator-rule.test.ts — when a business must have a creator who is
 * still a member of the tenant.
 *
 * A business carries no tenant id; where several organisations share one
 * database the only link is "its creator is a member of the tenant". That rule
 * must not apply where the database already is the tenant boundary, or removing
 * an admin who created a business hides it from the whole organisation:
 *
 *   cloud (MULTI_TENANT=true)         rule off  (database per tenant)
 *   self-hosted, one tenant           rule off
 *   self-hosted, several tenants      rule ON   (shared database)
 *
 * The decision is shared by three sites, all covered here after the creator is
 * removed by the owner: the tRPC/REST business access check (getBusinessAccess),
 * the business router's scoping (business.list / getById), and the queue worker's
 * job context (establishTenantContext).
 *
 * MULTI_TENANT is read per call by the rule, so the cloud case is exercised by
 * setting it for the test; the test database stays a single shared database,
 * which is all the rule needs to be observable.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { tenants, systemConfig, getTenantDb } from "@hisaabo/db";
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
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { cacheBus } from "../../lib/cache/index.js";
import { getBusinessAccess } from "../../lib/authz.js";
import { creatorRuleApplies, MULTI_ORG_LATCH_KEY } from "../../lib/tenant-businesses.js";
import { establishTenantContext } from "../../queue/context.js";
import { PermanentError } from "../../queue/errors.js";
import type { Envelope } from "../../queue/envelope.js";

const factory = createCallerFactory(appRouter);

function callerFor(user: TestUser, tenantId: string, businessId: string | null) {
  return factory({
    user: { id: user.id, email: user.email, name: user.name },
    tenantId,
    businessId,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        ...(businessId ? { "x-business-id": businessId } : {}),
      }),
    }),
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

const savedMultiTenant = process.env.MULTI_TENANT;
afterEach(() => {
  if (savedMultiTenant === undefined) delete process.env.MULTI_TENANT;
  else process.env.MULTI_TENANT = savedMultiTenant;
});
afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

interface World {
  tenant: TestTenant;
  owner: TestUser;
  creator: TestUser;
  colleague: TestUser;
  biz: TestBusiness;
}

/** One tenant: owner, an admin who created a business, another admin. `extraTenants` extra org rows. */
async function setup(opts: { cloud: boolean; extraTenants: number }): Promise<World> {
  await truncateAllTables();
  process.env.MULTI_TENANT = opts.cloud ? "true" : "false";
  const owner = await createUser();
  const creator = await createUser();
  const colleague = await createUser();
  const tenant = await createTenant({ plan: "business" });
  await addMember(tenant.id, owner.id, "owner");
  await addMember(tenant.id, creator.id, "admin");
  await addMember(tenant.id, colleague.id, "admin");
  for (let i = 0; i < opts.extraTenants; i++) await createTenant({ plan: "business" });
  const biz = await createBusiness(getTenantTestDb(), creator.id, { name: "Created By Admin" });
  return { tenant, owner, creator, colleague, biz };
}

function envelopeFor(w: World): Envelope {
  return {
    v: 1,
    scope: "tenant",
    tenantId: w.tenant.id,
    businessId: w.biz.id,
    actorUserId: w.colleague.id,
    tags: [],
    payload: {},
  };
}

const partyInput = { type: "customer" as const, name: "After Removal Party" };

describe.each([
  { label: "cloud (MULTI_TENANT=true, several tenant rows)", cloud: true, extraTenants: 2 },
  { label: "self-hosted, single organisation", cloud: false, extraTenants: 0 },
])("creator removed: $label (rule off)", ({ cloud, extraTenants }) => {
  let w: World;
  beforeEach(async () => {
    w = await setup({ cloud, extraTenants });
  });

  it("the creator rule does not apply", async () => {
    expect(await creatorRuleApplies()).toBe(false);
    expect(await creatorRuleApplies({ fresh: true })).toBe(false);
  });

  it("the business stays listed, readable and usable for the remaining members after its creator is removed", async () => {
    // before removal, everything works (and the removal below is the only change)
    expect((await callerFor(w.owner, w.tenant.id, null).business.list()).map((b) => b.id)).toContain(w.biz.id);
    await expect(callerFor(w.colleague, w.tenant.id, w.biz.id).party.create(partyInput)).resolves.toBeTruthy();

    await callerFor(w.owner, w.tenant.id, null).tenant.removeMember({ userId: w.creator.id });

    // business router scoping (business.list / getById)
    const list = await callerFor(w.owner, w.tenant.id, null).business.list();
    expect(list.map((b) => b.id)).toContain(w.biz.id);
    const byId = await callerFor(w.colleague, w.tenant.id, null).business.getById({ id: w.biz.id });
    expect(byId?.id).toBe(w.biz.id);

    // business access middleware (x-business-id) and the REST access check
    await expect(callerFor(w.colleague, w.tenant.id, w.biz.id).party.create(partyInput)).resolves.toBeTruthy();
    expect(await getBusinessAccess(await getTenantDb(w.tenant.id), w.tenant.id, w.biz.id)).toEqual({
      ok: true,
      createdByUserId: w.creator.id,
    });
  });

  it("a queued job for the business still runs (worker context)", async () => {
    await callerFor(w.owner, w.tenant.id, null).tenant.removeMember({ userId: w.creator.id });
    await expect(establishTenantContext(envelopeFor(w))).resolves.toHaveProperty("db");
  });

  it("an unknown business is still rejected", async () => {
    const access = await getBusinessAccess(await getTenantDb(w.tenant.id), w.tenant.id, "00000000-0000-4000-8000-000000000000");
    expect(access).toEqual({ ok: false, reason: "business_not_found" });
    await expect(
      establishTenantContext({ ...envelopeFor(w), businessId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toBeInstanceOf(PermanentError);
  });
});

describe("creator removed: self-hosted, several organisations (rule on)", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup({ cloud: false, extraTenants: 1 });
  });

  it("the creator rule applies", async () => {
    expect(await creatorRuleApplies()).toBe(true);
  });

  it("the business disappears for the organisation once its creator is removed, on every path", async () => {
    expect((await callerFor(w.owner, w.tenant.id, null).business.list()).map((b) => b.id)).toContain(w.biz.id);
    await expect(callerFor(w.colleague, w.tenant.id, w.biz.id).party.create(partyInput)).resolves.toBeTruthy();
    await expect(establishTenantContext(envelopeFor(w))).resolves.toHaveProperty("db");

    await callerFor(w.owner, w.tenant.id, null).tenant.removeMember({ userId: w.creator.id });

    expect((await callerFor(w.owner, w.tenant.id, null).business.list()).map((b) => b.id)).not.toContain(w.biz.id);
    expect(await callerFor(w.colleague, w.tenant.id, null).business.getById({ id: w.biz.id })).toBeNull();
    await expect(callerFor(w.colleague, w.tenant.id, w.biz.id).party.create(partyInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Business not found",
    });
    expect(await getBusinessAccess(await getTenantDb(w.tenant.id), w.tenant.id, w.biz.id)).toEqual({
      ok: false,
      reason: "creator_not_member",
    });
    await expect(establishTenantContext(envelopeFor(w))).rejects.toBeInstanceOf(PermanentError);
  });

  it("another organisation's business is never reachable through this tenant", async () => {
    const foreignOwner = await createUser();
    const foreignTenant = await createTenant({ plan: "business" });
    await addMember(foreignTenant.id, foreignOwner.id, "owner");
    const foreignBiz = await createBusiness(getTenantTestDb(), foreignOwner.id, { name: "Foreign" });

    expect((await callerFor(w.owner, w.tenant.id, null).business.list()).map((b) => b.id)).not.toContain(foreignBiz.id);
    expect(await getBusinessAccess(await getTenantDb(w.tenant.id), w.tenant.id, foreignBiz.id)).toEqual({
      ok: false,
      reason: "creator_not_member",
    });
  });
});

const latchRows = async () =>
  getControlDb().select().from(systemConfig).where(eq(systemConfig.key, MULTI_ORG_LATCH_KEY));

describe("the tenant count behind the rule is kept fresh, and latched", () => {
  it("a single-organisation install never writes the latch", async () => {
    await setup({ cloud: false, extraTenants: 0 });
    expect(await creatorRuleApplies()).toBe(false);
    expect(await latchRows()).toHaveLength(0);
  });

  it("cloud never writes the latch, whatever the tenant count", async () => {
    await setup({ cloud: true, extraTenants: 3 });
    expect(await creatorRuleApplies()).toBe(false);
    expect(await latchRows()).toHaveLength(0);
  });

  it("adding a second organisation turns the rule on at once and latches it", async () => {
    const w = await setup({ cloud: false, extraTenants: 0 });
    expect(await creatorRuleApplies()).toBe(false); // warms the cache
    expect(await latchRows()).toHaveLength(0);

    const second = await createTenant({ plan: "business" });
    cacheBus.invalidate({ kind: "tenant", tenantId: second.id }); // what the writers emit
    expect(await creatorRuleApplies()).toBe(true);
    expect(await latchRows()).toHaveLength(1);

    await callerFor(w.owner, w.tenant.id, null).tenant.removeMember({ userId: w.creator.id });
    expect(await getBusinessAccess(await getTenantDb(w.tenant.id), w.tenant.id, w.biz.id)).toMatchObject({ ok: false });
  });

  it("hard-deleting a tenant row does not expose its businesses: the rule stays on once more than one tenant has existed", async () => {
    const w = await setup({ cloud: false, extraTenants: 0 });
    // a second organisation with a business of its own, in the same shared database
    const foreignOwner = await createUser();
    const foreign = await createTenant({ plan: "business" });
    await addMember(foreign.id, foreignOwner.id, "owner");
    const foreignBiz = await createBusiness(getTenantTestDb(), foreignOwner.id, { name: "Deleted Org Business" });
    cacheBus.invalidate({ kind: "tenant", tenantId: foreign.id });
    expect(await creatorRuleApplies()).toBe(true); // seen: latches

    // the organisation is hard-deleted (its memberships go with it); the business row stays in the shared DB
    await getControlDb().delete(tenants).where(eq(tenants.id, foreign.id));
    cacheBus.invalidate({ kind: "tenant", tenantId: foreign.id }); // what the tenants delete trigger emits

    expect(await creatorRuleApplies()).toBe(true);
    expect(await creatorRuleApplies({ fresh: true })).toBe(true);
    expect((await callerFor(w.owner, w.tenant.id, null).business.list()).map((b) => b.id)).not.toContain(foreignBiz.id);
    expect(await callerFor(w.owner, w.tenant.id, null).business.getById({ id: foreignBiz.id })).toBeNull();
    expect(await getBusinessAccess(await getTenantDb(w.tenant.id), w.tenant.id, foreignBiz.id)).toEqual({
      ok: false,
      reason: "creator_not_member",
    });
    // the surviving organisation's own business is still there for its members
    expect((await callerFor(w.owner, w.tenant.id, null).business.list()).map((b) => b.id)).toContain(w.biz.id);
  });

  it("clearing the latch row (the documented manual step) turns the rule off again for a single organisation", async () => {
    await setup({ cloud: false, extraTenants: 0 });
    const second = await createTenant({ plan: "business" });
    expect(await creatorRuleApplies({ fresh: true })).toBe(true);
    await getControlDb().delete(tenants).where(eq(tenants.id, second.id));
    expect(await creatorRuleApplies({ fresh: true })).toBe(true); // latched

    await getControlDb().delete(systemConfig).where(eq(systemConfig.key, MULTI_ORG_LATCH_KEY));
    cacheBus.invalidate({ kind: "tenant", tenantId: second.id });
    expect(await creatorRuleApplies()).toBe(false);
  });
});
