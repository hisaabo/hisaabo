/**
 * Hot-path isolation for notification emits (no database needed).
 *
 * emitNotificationEventSafe / withNotificationSavepoint run the outbox insert in
 * a SAVEPOINT of the caller's transaction. These tests use a fake transaction
 * that records the savepoint lifecycle, so they prove the contract the
 * payment.create and storefront order paths rely on: an emit failure is rolled
 * back to the savepoint and swallowed (logged at warn), a success is released,
 * and neither touches the outer transaction.
 *
 * The end-to-end version (a real payment committing while the outbox rejects
 * inserts) lives in integration/notifications.test.ts.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import {
  emitNotificationEventSafe,
  withNotificationSavepoint,
  userDisplayName,
  type TenantDbOrTx,
} from "../lib/notifications/emit.js";
import { logger } from "../lib/logger.js";

type Step = "savepoint" | "release" | "rollback to savepoint";

/** A transaction whose nested transaction() behaves like Drizzle's: savepoint, then release or rollback-to. */
function fakeTx(sp: object) {
  const steps: Step[] = [];
  const tx = {
    async transaction<T>(cb: (sp: object) => Promise<T>): Promise<T> {
      steps.push("savepoint");
      try {
        const result = await cb(sp);
        steps.push("release");
        return result;
      } catch (err) {
        steps.push("rollback to savepoint");
        throw err;
      }
    },
  };
  return { tx: tx as unknown as TenantDbOrTx, steps };
}

const failingInsert = (message: string) => ({
  insert: () => ({
    values: () => ({
      onConflictDoNothing: () => ({
        returning: async () => {
          throw new Error(message);
        },
      }),
    }),
  }),
});

const workingInsert = (id: string) => ({
  insert: () => ({
    values: () => ({
      onConflictDoNothing: () => ({ returning: async () => [{ id }] }),
    }),
  }),
});

const input = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  businessId: "22222222-2222-4222-8222-222222222222",
  type: "store.order_placed" as const,
  payload: { orderId: "o1", orderNumber: "ORD-1", customerName: "Asha", totalAmount: "100", itemCount: 1 },
  dedupeKey: "store.order_placed:o1",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("emitNotificationEventSafe", () => {
  it("rolls back to the savepoint, logs a warning with the event type, and does not throw when the outbox rejects the insert", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { tx, steps } = fakeTx(failingInsert('relation "notification_outbox" does not exist'));

    await expect(emitNotificationEventSafe(tx, input)).resolves.toBeUndefined();

    expect(steps).toEqual(["savepoint", "rollback to savepoint"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ type: "store.order_placed" });
  });

  it("releases the savepoint when the insert succeeds", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { tx, steps } = fakeTx(workingInsert("outbox-1"));

    await emitNotificationEventSafe(tx, input);

    expect(steps).toEqual(["savepoint", "release"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("lets the caller's own work around the emit commit: an emit failure is not an exception in the business flow", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const { tx } = fakeTx(failingInsert("boom"));
    const businessWrites: string[] = [];

    // Shape of payment.create / the storefront order handler.
    const businessTransaction = async () => {
      businessWrites.push("payment row");
      await emitNotificationEventSafe(tx, input);
      businessWrites.push("invoice marked paid");
      return "committed";
    };

    await expect(businessTransaction()).resolves.toBe("committed");
    expect(businessWrites).toEqual(["payment row", "invoice marked paid"]);
  });
});

describe("withNotificationSavepoint", () => {
  it("reports whether the work completed and logs the label on failure", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const ok = fakeTx({});
    expect(await withNotificationSavepoint(ok.tx, "payment", async () => undefined)).toBe(true);
    expect(ok.steps).toEqual(["savepoint", "release"]);

    const bad = fakeTx({});
    const result = await withNotificationSavepoint(bad.tx, "payment", async () => {
      throw new Error("select failed");
    });
    expect(result).toBe(false);
    expect(bad.steps).toEqual(["savepoint", "rollback to savepoint"]);
    expect(warn.mock.calls[0][0]).toMatchObject({ type: "payment" });
  });
});

describe("userDisplayName", () => {
  it("falls back to a neutral name instead of throwing when the lookup fails", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    // No reachable database in this suite: the lookup rejects, the helper must not.
    const name = await userDisplayName("00000000-0000-4000-8000-000000000000").catch(() => "THREW");
    expect(name).not.toBe("THREW");
  });
});
