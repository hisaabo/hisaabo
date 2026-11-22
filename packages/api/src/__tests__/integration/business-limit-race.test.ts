/**
 * business-limit-race.test.ts — the business plan limit holds under concurrency.
 *
 * enforceBusinessLimit used to count in one transaction and business.create
 * inserted in another, so N concurrent creates on a plan that allows 1 business
 * all read "0 of 1" and all inserted. The count and the insert now share one
 * transaction under pg_advisory_xact_lock(hashtext('business-create')).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { count } from "drizzle-orm";
import { businesses } from "@hisaabo/db";
import { createUser, createTenant, addMember, type TestUser, type TestTenant } from "../helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";

const factory = createCallerFactory(appRouter);

function tenantCaller(user: TestUser, tenantId: string) {
  return factory({
    user: { id: user.id, email: user.email, name: user.name },
    tenantId,
    businessId: null,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
    }),
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

const input = (n: number) => ({
  name: `Race Biz ${n}`,
  pan: "ABCDE1234F",
  phone: "9876543210",
  address: "12, Gandhi Nagar, Jaipur",
  gstRegistrationType: "unregistered" as const,
  invoicePrefix: `R${n}`,
  currency: "INR",
});

let owner: TestUser;
let proOwner: TestUser;
let free: TestTenant;
let pro: TestTenant;

beforeAll(async () => {
  await truncateAllTables();
  owner = await createUser();
  proOwner = await createUser();
  free = await createTenant({ plan: "free" }); // 1 business
  pro = await createTenant({ plan: "pro" }); // 5 businesses
  await addMember(free.id, owner.id, "owner");
  await addMember(pro.id, proOwner.id, "owner");
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

async function bizCount(): Promise<number> {
  const [row] = await getTenantTestDb().select({ n: count() }).from(businesses);
  return row!.n;
}

describe("business.create plan limit under concurrency", () => {
  it("lets exactly one of several concurrent creates through on a plan that allows one business", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => tenantCaller(owner, free.id).business.create(input(i))),
    );

    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(5);
    for (const r of rejected) {
      expect(r.reason).toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("Your plan allows up to 1 business") });
    }
    expect(await bizCount()).toBe(1);
  });

  it("a sequential create over the limit is still refused", async () => {
    await expect(tenantCaller(owner, free.id).business.create(input(99))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await bizCount()).toBe(1);
  });

  it("a rejected create leaves nothing behind (rolled back with its transaction)", async () => {
    const before = await bizCount();
    await expect(tenantCaller(owner, free.id).business.create(input(100))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await bizCount()).toBe(before);
  });

  it("a plan with room is not over-restricted: concurrent creates up to the limit all succeed, the rest are refused", async () => {
    // Two tenants share the test database, so each tenant counts only the
    // businesses its own members created (hence a separate owner).
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => tenantCaller(proOwner, pro.id).business.create(input(200 + i))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5); // pro: 5 businesses
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(3);
    expect(await bizCount()).toBe(6); // + the free tenant's one
  });
});
