import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("target.list withProgress", () => {
  it("attaches progress to every target", async () => {
    const c = createTestCaller({
      userId: world.ramesh.id,
      email: world.ramesh.email,
      name: world.ramesh.name ?? null,
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
    });
    const start = new Date(Date.now() - 86_400_000).toISOString();
    const end = new Date(Date.now() + 29 * 86_400_000).toISOString();
    await c.target.create({
      userId: world.ramesh.id, targetType: "order_count", targetValue: "10",
      periodType: "monthly", periodStart: start, periodEnd: end,
    });
    await c.target.create({
      userId: world.ramesh.id, targetType: "order_value", targetValue: "5000",
      periodType: "monthly", periodStart: start, periodEnd: end,
    });

    const rows = await c.target.list({ withProgress: true });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      const p = (r as unknown as { progress: { current: number; unit: string; target: number } }).progress;
      expect(p.current).toBe(0);
      expect(p.unit).toBe(r.targetType === "order_count" ? "orders" : "₹");
    }
  });
});
