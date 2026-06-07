/**
 * business-isolation.test.ts — Cross-tenant isolation for the business router.
 *
 * REGRESSION CONTEXT:
 *   The `business.*` procedures take the business id from their input and run on
 *   `tenantProcedure`, so they never pass through `hasBusinessAccess`. In
 *   self-hosted mode (all tenants share one DB) the original handlers used a bare
 *   `WHERE businesses.id = :id`, which let any tenant read or mutate any other
 *   tenant's business. This suite locks in the tenant-ownership scoping added in
 *   lib/tenant-businesses.ts.
 *
 * WORLD: tenant1/business1 (ramesh, owner) and tenant2/business2 (kiran, owner)
 *        in a shared self-hosted DB — the exact cross-tenant surface.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestCaller } from "../helpers/create-test-caller.js";

let world: TestWorld;
let callerA: ReturnType<typeof createTestCaller>; // tenant1 / business1 (ramesh, owner)
let callerB: ReturnType<typeof createTestCaller>; // tenant2 / business2 (kiran, owner)

beforeAll(async () => {
  world = await createTestWorld();
  callerA = createTestCaller({
    userId: world.ramesh.id, email: world.ramesh.email, name: world.ramesh.name,
    tenantId: world.tenant1.id, businessId: world.business1.id,
  });
  callerB = createTestCaller({
    userId: world.kiran.id, email: world.kiran.email, name: world.kiran.name,
    tenantId: world.tenant2.id, businessId: world.business2.id,
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("business router — reads are scoped to the caller's tenant", () => {
  it("business.getById: A cannot read B's business (and B can read its own)", async () => {
    expect(await callerA.business.getById({ id: world.business2.id })).toBeNull();
    expect(await callerB.business.getById({ id: world.business1.id })).toBeNull(); // reverse
    const own = await callerA.business.getById({ id: world.business1.id });
    expect(own?.id).toBe(world.business1.id); // positive control
  });

  it("business.list: each tenant sees only its own businesses", async () => {
    const listA = await callerA.business.list();
    expect(listA.some((b) => b.id === world.business1.id)).toBe(true);
    expect(listA.some((b) => b.id === world.business2.id)).toBe(false);

    const listB = await callerB.business.list();
    expect(listB.some((b) => b.id === world.business2.id)).toBe(true);
    expect(listB.some((b) => b.id === world.business1.id)).toBe(false);
  });
});

describe("business router — mutations cannot touch another tenant's business", () => {
  it("business.update: A cannot rename B's business; B's data is unchanged", async () => {
    await expect(
      callerA.business.update({ id: world.business2.id, data: { name: "PWNED" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const after = await callerB.business.getById({ id: world.business2.id });
    expect(after?.name).toBe("Kiran Enterprises");
  });

  it("business.update: A can rename its OWN business (positive control)", async () => {
    const updated = await callerA.business.update({ id: world.business1.id, data: { name: "Acme Trading Co (Renamed)" } });
    expect(updated.name).toBe("Acme Trading Co (Renamed)");
  });

  it("business.setPosEnabled: A cannot toggle POS on B's business", async () => {
    await expect(
      callerA.business.setPosEnabled({ id: world.business2.id, enabled: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("business.deleteLogo: A cannot clear B's logo", async () => {
    await expect(
      callerA.business.deleteLogo({ id: world.business2.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("business.ensureWalkInParty: A cannot seed a walk-in party into B's business", async () => {
    await expect(
      callerA.business.ensureWalkInParty({ id: world.business2.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // ...and it works for the caller's own business (positive control).
    const own = await callerA.business.ensureWalkInParty({ id: world.business1.id });
    expect(own.id).toBeDefined();
  });
});
