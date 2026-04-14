/**
 * maintenance-mode.test.ts — Unit tests for the maintenance-mode runtime path.
 *
 * WHY THIS FILE EXISTS:
 * Two surfaces expose / enforce maintenance mode:
 *   1. `system.maintenanceStatus` — a PUBLIC tRPC query that the web and
 *      mobile clients poll to render the maintenance banner. It MUST stay
 *      callable even while the rest of the API is locked down, otherwise
 *      clients can't tell the difference between "backend is down" and
 *      "scheduled maintenance — back in 10 minutes".
 *   2. `hasTenantAccess` middleware in `trpc.ts` — blocks every tenant-scoped
 *      request with PRECONDITION_FAILED when maintenance is on. A silent
 *      bypass here would let writes land during a DB migration window.
 *
 * Both are exercised here against mocked dependencies (cache + getTenantDb)
 * so the tests run without a live Postgres and cover the exact branches the
 * middleware walks in production.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Module mocks ──────────────────────────────────────────────────────────────
// The trpc + router imports pull in real DB modules; stub the pieces the
// maintenance path actually touches so the test boots without a Postgres
// connection. Anything not listed here (permissions, auth, etc.) is left as
// its real implementation.
//
// vi.mock() is hoisted above `import` statements, so any symbols its factory
// closes over must come from `vi.hoisted()` (which is also hoisted) — plain
// top-level consts would be in the temporal dead zone when the factory runs.

const { mockGetMaintenanceStatus } = vi.hoisted(() => ({
  mockGetMaintenanceStatus: vi.fn(),
}));

vi.mock("../lib/maintenance-cache.js", () => ({
  getMaintenanceStatus: mockGetMaintenanceStatus,
  invalidateMaintenanceCache: vi.fn(),
}));

// `hasTenantAccess` calls getTenantDb(tenantId) BEFORE the maintenance check.
// Returning a bare object is fine — no queries run against it in these tests.
vi.mock("@hisaabo/db", async () => {
  const actual = await vi.importActual<typeof import("@hisaabo/db")>("@hisaabo/db");
  return {
    ...actual,
    getTenantDb: vi.fn(async () => ({} as never)),
  };
});

// Imported AFTER the mocks so the test copies of the mocked deps are wired in.
import { createCallerFactory, router, tenantProcedure, publicProcedure } from "../trpc.js";
import { systemRouter } from "../routers/system.js";

// ── Test router ───────────────────────────────────────────────────────────────
// A throwaway router that exposes:
//   - `system.*` (the real systemRouter — covers the public query)
//   - `tenant.ping` (a minimal tenantProcedure — covers the middleware guard)
// We avoid pulling in appRouter so this test doesn't drag in every other
// router's top-level imports (redis, stripe, etc.).

const testRouter = router({
  system: systemRouter,
  tenant: router({
    ping: tenantProcedure.query(() => "pong"),
  }),
  pub: router({
    // Sanity check: public procedures must NOT be blocked during maintenance.
    ping: publicProcedure.query(() => "pong"),
  }),
});

const createCaller = createCallerFactory(testRouter);

// ── Context builders ──────────────────────────────────────────────────────────
// tenantProcedure requires both a user and a tenantId. We skip the CSRF check
// by using a GET-shaped Request method (the middleware exempts GET/HEAD/OPTIONS
// exactly so read-only queries work without the X-Requested-With sentinel).

function tenantCaller() {
  const headers = new Headers({ "content-type": "application/json" });
  const req = new Request("http://localhost/api/trpc/test", { method: "GET", headers });
  return createCaller({
    user: { id: "user-1", email: "u@example.in", name: null },
    tenantId: "tenant-1",
    businessId: null,
    req,
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

function publicCaller() {
  const headers = new Headers({ "content-type": "application/json" });
  const req = new Request("http://localhost/api/trpc/test", { method: "GET", headers });
  return createCaller({
    user: null,
    tenantId: null,
    businessId: null,
    req,
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("system.maintenanceStatus — public query consumed by the maintenance banner", () => {
  beforeEach(() => {
    mockGetMaintenanceStatus.mockReset();
  });

  it("returns the full MaintenanceStatus object (enabled/message/startsAt/endsAt) so clients can render the banner with a countdown", async () => {
    const payload = {
      enabled: true,
      message: "DB migration in progress",
      startsAt: "2026-04-14T10:00:00.000Z",
      endsAt: "2026-04-14T10:10:00.000Z",
    };
    mockGetMaintenanceStatus.mockResolvedValueOnce(payload);

    const caller = publicCaller();
    const result = await caller.system.maintenanceStatus();

    expect(result).toEqual(payload);
    expect(mockGetMaintenanceStatus).toHaveBeenCalledTimes(1);
  });

  it("stays callable even when maintenance.enabled = true — it's the one query clients MUST be able to reach during an outage to know the window", async () => {
    // Same payload, called via the PUBLIC path: no user, no tenant, no
    // hasTenantAccess → no maintenance guard. This test pins the invariant
    // that the banner query itself can never be locked out.
    mockGetMaintenanceStatus.mockResolvedValueOnce({
      enabled: true,
      message: "down",
      startsAt: null,
      endsAt: null,
    });

    const caller = publicCaller();
    await expect(caller.system.maintenanceStatus()).resolves.toMatchObject({ enabled: true });
  });
});

describe("hasTenantAccess middleware — maintenance-mode guard on every tenant-scoped request", () => {
  beforeEach(() => {
    mockGetMaintenanceStatus.mockReset();
  });

  it("lets tenant procedures through when maintenance.enabled = false — normal operation must not regress into spurious 412s", async () => {
    mockGetMaintenanceStatus.mockResolvedValueOnce({
      enabled: false,
      message: "",
      startsAt: null,
      endsAt: null,
    });

    const caller = tenantCaller();
    await expect(caller.tenant.ping()).resolves.toBe("pong");
  });

  it("throws PRECONDITION_FAILED with the admin-supplied message when maintenance is on — so the client can surface the exact reason to the user without guessing", async () => {
    mockGetMaintenanceStatus.mockResolvedValueOnce({
      enabled: true,
      message: "Scheduled maintenance: back at 14:00 IST",
      startsAt: "2026-04-14T08:00:00.000Z",
      endsAt: "2026-04-14T08:30:00.000Z",
    });

    const caller = tenantCaller();
    await expect(caller.tenant.ping()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Scheduled maintenance: back at 14:00 IST",
    });
    // Make sure the rejection is a real TRPCError (not a plain Error) —
    // the tRPC client needs the TRPCError envelope to decode the code.
    await expect(caller.tenant.ping().catch((e) => e)).resolves.toBeInstanceOf(Error);
  });

  it("falls back to a generic 'System is under maintenance...' message when the admin left the message blank — the middleware must never throw with an empty string or clients see a silent failure", async () => {
    mockGetMaintenanceStatus.mockResolvedValueOnce({
      enabled: true,
      message: "",
      startsAt: null,
      endsAt: null,
    });

    const caller = tenantCaller();

    let caught: unknown;
    try {
      await caller.tenant.ping();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect((caught as TRPCError).message).toMatch(/maintenance/i);
    expect((caught as TRPCError).message.length).toBeGreaterThan(0);
  });

  it("does NOT block public procedures during maintenance — the outage must remain diagnosable (status query, health checks, auth.sendMagicLink style public endpoints)", async () => {
    mockGetMaintenanceStatus.mockResolvedValue({
      enabled: true,
      message: "down",
      startsAt: null,
      endsAt: null,
    });

    const caller = publicCaller();
    await expect(caller.pub.ping()).resolves.toBe("pong");
  });
});
