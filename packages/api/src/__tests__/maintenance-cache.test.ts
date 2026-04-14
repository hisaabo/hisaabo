/**
 * maintenance-cache.test.ts — Unit tests for the maintenance-mode cache.
 *
 * WHY THIS FILE EXISTS:
 * The maintenance cache is hit by `hasTenantAccess` middleware on every
 * authenticated request. A bug here — stale cache, missing default, wrong
 * TTL — either lets traffic through during a real maintenance window or
 * wedges the API indefinitely after the window closes. Both are outages.
 *
 * The module under test reads one row from the control DB's `system_config`
 * table, keyed by `"maintenance"`, and memoises the parsed value for 30s.
 * We mock `@hisaabo/db` so the tests can verify cache hits, TTL expiry,
 * invalidation, and the default-when-missing path in microseconds without
 * a real Postgres connection.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock setup ────────────────────────────────────────────────────────────────
// The cache module imports `controlDb` and `systemConfig` from `@hisaabo/db`.
// We stub the Drizzle fluent-chain so each call sequence resolves to whatever
// the test queued via `mockLimit.mockResolvedValueOnce(...)`. Resetting both
// the mock history and the module registry between tests ensures every test
// starts with a cold cache and a clean call counter.

const mockLimit = vi.fn();
const mockWhere = vi.fn(() => ({ limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock("@hisaabo/db", () => ({
  controlDb: { select: mockSelect },
  // systemConfig is only referenced as a table token in eq(); an empty object
  // is enough because the drizzle-orm `eq` call is also mocked below.
  systemConfig: { key: "key", value: "value" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq-expression"),
}));

describe("maintenance-cache — getMaintenanceStatus() + invalidateMaintenanceCache()", () => {
  beforeEach(async () => {
    // Fresh module instance per test so the in-module `cached` / `cachedAt`
    // state starts at null/0 — this is how production bootstraps on a fresh
    // process and what we want to assert cache behaviour against.
    vi.resetModules();
    mockLimit.mockReset();
    mockSelect.mockClear();
    mockFrom.mockClear();
    mockWhere.mockClear();
  });

  it("returns the DEFAULT_STATUS (disabled, empty strings, nulls) when no row exists in system_config — first-boot scenario where the maintenance key has never been written", async () => {
    mockLimit.mockResolvedValueOnce([]);

    const mod = await import("../lib/maintenance-cache.js");
    const status = await mod.getMaintenanceStatus();

    expect(status).toEqual({
      enabled: false,
      message: "",
      startsAt: null,
      endsAt: null,
    });
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("returns the stored row verbatim (enabled=true, message populated, window set) — the happy path during an active maintenance window", async () => {
    const stored = {
      enabled: true,
      message: "Scheduled DB migration — back in 10 minutes",
      startsAt: "2026-04-14T10:00:00.000Z",
      endsAt: "2026-04-14T10:10:00.000Z",
    };
    mockLimit.mockResolvedValueOnce([{ value: stored }]);

    const mod = await import("../lib/maintenance-cache.js");
    const status = await mod.getMaintenanceStatus();

    expect(status).toEqual(stored);
  });

  it("fills in missing fields from partial JSONB values with safe defaults — guards against older schema rows that predate the full MaintenanceStatus shape", async () => {
    // Only `enabled` is set; the other three fields must fall back to defaults
    // so the consumer (trpc middleware) never sees undefined.
    mockLimit.mockResolvedValueOnce([{ value: { enabled: true } }]);

    const mod = await import("../lib/maintenance-cache.js");
    const status = await mod.getMaintenanceStatus();

    expect(status).toEqual({
      enabled: true,
      message: "",
      startsAt: null,
      endsAt: null,
    });
  });

  it("serves the SECOND call from cache without hitting the DB again — this is the hot path on every authenticated request, must not pay a round-trip", async () => {
    mockLimit.mockResolvedValueOnce([
      { value: { enabled: false, message: "", startsAt: null, endsAt: null } },
    ]);

    const mod = await import("../lib/maintenance-cache.js");
    await mod.getMaintenanceStatus();
    await mod.getMaintenanceStatus();
    await mod.getMaintenanceStatus();

    // Three calls, one DB read — the whole point of the cache.
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("refetches from the DB after the 30s TTL elapses — stale cache would strand users once an admin turns maintenance OFF", async () => {
    vi.useFakeTimers();
    try {
      mockLimit
        .mockResolvedValueOnce([{ value: { enabled: true, message: "down" } }])
        .mockResolvedValueOnce([{ value: { enabled: false, message: "" } }]);

      const mod = await import("../lib/maintenance-cache.js");

      const first = await mod.getMaintenanceStatus();
      expect(first.enabled).toBe(true);

      // Advance past the 30s TTL so the next call misses the cache.
      vi.advanceTimersByTime(30_001);

      const second = await mod.getMaintenanceStatus();
      expect(second.enabled).toBe(false);
      expect(mockSelect).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps serving from cache at 29.9s — must not refetch prematurely or we lose the whole point of the 30s window", async () => {
    vi.useFakeTimers();
    try {
      mockLimit.mockResolvedValueOnce([{ value: { enabled: true, message: "x" } }]);

      const mod = await import("../lib/maintenance-cache.js");
      await mod.getMaintenanceStatus();

      // Just under the TTL — still a cache hit.
      vi.advanceTimersByTime(29_900);
      await mod.getMaintenanceStatus();

      expect(mockSelect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("invalidateMaintenanceCache() forces the NEXT call to refetch — used by the CLI after it writes a new maintenance config so admins see the change immediately", async () => {
    mockLimit
      .mockResolvedValueOnce([{ value: { enabled: false, message: "" } }])
      .mockResolvedValueOnce([{ value: { enabled: true, message: "now" } }]);

    const mod = await import("../lib/maintenance-cache.js");

    const before = await mod.getMaintenanceStatus();
    expect(before.enabled).toBe(false);

    mod.invalidateMaintenanceCache();

    const after = await mod.getMaintenanceStatus();
    expect(after.enabled).toBe(true);
    expect(after.message).toBe("now");
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it("invalidateMaintenanceCache() is idempotent on a cold cache — calling it before any fetch should not throw or corrupt state", async () => {
    mockLimit.mockResolvedValueOnce([
      { value: { enabled: false, message: "", startsAt: null, endsAt: null } },
    ]);

    const mod = await import("../lib/maintenance-cache.js");

    expect(() => mod.invalidateMaintenanceCache()).not.toThrow();
    expect(() => mod.invalidateMaintenanceCache()).not.toThrow();

    const status = await mod.getMaintenanceStatus();
    expect(status.enabled).toBe(false);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });
});
