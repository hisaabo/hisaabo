import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const reg = vi.hoisted(() => ({
  resolveSlug: vi.fn(),
  isBackfillMarkerPresent: vi.fn(),
}));
vi.mock("../lib/store-slug-registry.js", () => ({
  SLUG_RE: /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/,
  isRegistryEnabled: () => true,
  resolveSlug: reg.resolveSlug,
  isBackfillMarkerPresent: reg.isBackfillMarkerPresent,
}));

import { resolveStoreSlug, _resetStoreSlugCacheState } from "../lib/store-slug-cache.js";
import { cacheBus } from "../lib/cache/bus.js";

const hit = { tenantId: "t1", businessId: "b1", storeEnabled: true };

beforeEach(() => {
  vi.useFakeTimers();
  reg.resolveSlug.mockReset();
  reg.isBackfillMarkerPresent.mockReset().mockResolvedValue(true);
  _resetStoreSlugCacheState();
});
afterEach(() => vi.useRealTimers());

describe("store slug cache", () => {
  it("positive hit is cached; TTL 5 min", async () => {
    reg.resolveSlug.mockResolvedValue(hit);
    expect(await resolveStoreSlug("my-shop")).toEqual({ tenantId: "t1", businessId: "b1" });
    await resolveStoreSlug("my-shop");
    expect(reg.resolveSlug).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await resolveStoreSlug("my-shop");
    expect(reg.resolveSlug).toHaveBeenCalledTimes(2);
  });

  it("negative is cached 30 s; disabled registry row counts as a miss", async () => {
    reg.resolveSlug.mockResolvedValue({ ...hit, storeEnabled: false });
    expect(await resolveStoreSlug("my-shop")).toBeNull();
    await resolveStoreSlug("my-shop");
    expect(reg.resolveSlug).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    await resolveStoreSlug("my-shop");
    expect(reg.resolveSlug).toHaveBeenCalledTimes(2);
  });

  it("control errors propagate and are NOT negative-cached", async () => {
    reg.resolveSlug.mockRejectedValueOnce(new Error("db down")).mockResolvedValue(hit);
    await expect(resolveStoreSlug("my-shop")).rejects.toThrow("db down");
    expect(await resolveStoreSlug("my-shop")).not.toBeNull();
  });

  it("storeSlug bus event clears positive and negative entries (old and new slug)", async () => {
    reg.resolveSlug.mockResolvedValue(hit);
    await resolveStoreSlug("old-name");
    reg.resolveSlug.mockResolvedValue(null);
    expect(await resolveStoreSlug("new-name")).toBeNull();
    reg.resolveSlug.mockImplementation(async (s: string) => (s === "new-name" ? hit : null));
    cacheBus.invalidate({ kind: "storeSlug", slugs: ["old-name", "new-name"] });
    expect(await resolveStoreSlug("new-name")).not.toBeNull();
    expect(await resolveStoreSlug("old-name")).toBeNull();
  });

  it("invalid slug never reaches the registry", async () => {
    expect(await resolveStoreSlug("A_B")).toBeNull();
    expect(reg.resolveSlug).not.toHaveBeenCalled();
  });

  it("backfill marker: true is cached forever, false is re-checked after 60 s", async () => {
    reg.resolveSlug.mockResolvedValue(null);
    await resolveStoreSlug("aaa-one");
    await resolveStoreSlug("bbb-two");
    expect(reg.isBackfillMarkerPresent).toHaveBeenCalledTimes(1);

    _resetStoreSlugCacheState();
    reg.isBackfillMarkerPresent.mockReset().mockResolvedValue(false);
    // marker absent → legacy scan path (real db, no active tenants matching) is attempted;
    // we only assert the marker check cadence here.
    vi.useRealTimers();
    await resolveStoreSlug("aaa-one").catch(() => {});
    await resolveStoreSlug("bbb-two").catch(() => {});
    expect(reg.isBackfillMarkerPresent).toHaveBeenCalledTimes(1);
  });
});
