import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TtlCache, resetAllCaches, setDegraded, isDegraded, allCacheStats } from "../../lib/cache/ttl-cache.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let n = 0;
const mk = (o: Partial<{ max: number; ttlMs: number }> = {}) =>
  new TtlCache<string>({ name: `t${n++}`, max: o.max ?? 10, ttlMs: o.ttlMs ?? 1000 });

afterEach(() => {
  vi.useRealTimers();
  setDegraded(false);
});

describe("TtlCache basics", () => {
  it("expires entries after ttl", () => {
    vi.useFakeTimers();
    const c = mk({ ttlMs: 1000 });
    c.set("a", "1");
    vi.advanceTimersByTime(999);
    expect(c.get("a")).toBe("1");
    vi.advanceTimersByTime(1);
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it("per-entry ttl override", () => {
    vi.useFakeTimers();
    const c = mk({ ttlMs: 10_000 });
    c.set("a", "1", { ttlMs: 100 });
    vi.advanceTimersByTime(100);
    expect(c.get("a")).toBeUndefined();
  });

  it("evicts least-recently-used at max size", () => {
    const c = mk({ max: 2 });
    c.set("a", "1");
    c.set("b", "2");
    c.get("a"); // touch a => b is oldest
    c.set("c", "3");
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe("1");
    expect(c.get("c")).toBe("3");
    expect(c.stats().evictions).toBe(1);
  });

  it("tag index: deleteByTag, and stays consistent after eviction/overwrite/delete", () => {
    const c = mk({ max: 2 });
    c.set("a", "1", { tags: ["u:1"] });
    c.set("b", "2", { tags: ["u:1", "t:1"] });
    c.set("c", "3", { tags: ["t:1"] }); // evicts a
    expect(c.deleteByTag("u:1")).toBe(1); // only b remains with u:1
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBe("3");
    c.set("c", "4", { tags: [] }); // overwrite drops tag membership
    expect(c.deleteByTag("t:1")).toBe(0);
    expect(c.get("c")).toBe("4");
    c.delete("c");
    expect(c.deleteByTag("t:1")).toBe(0);
  });

  it("counts hits and misses", () => {
    const c = mk();
    c.get("x");
    c.set("x", "1");
    c.get("x");
    expect(c.stats()).toMatchObject({ hits: 1, misses: 1, sets: 1 });
  });

  it("degraded mode clamps ttl to 5s, including already stored entries", () => {
    vi.useFakeTimers();
    const c = mk({ ttlMs: 60_000 });
    c.set("a", "1");
    vi.advanceTimersByTime(6000);
    expect(c.get("a")).toBe("1");
    setDegraded(true);
    expect(isDegraded()).toBe(true);
    expect(c.get("a")).toBeUndefined(); // stored 6s ago > 5s clamp
    c.set("b", "2");
    vi.advanceTimersByTime(5000);
    expect(c.get("b")).toBeUndefined();
    setDegraded(false);
    c.set("c", "3");
    vi.advanceTimersByTime(30_000);
    expect(c.get("c")).toBe("3");
  });

  it("registry: resetAllCaches clears entries and counters of every cache", () => {
    const a = mk();
    const b = mk();
    a.set("x", "1");
    b.set("y", "2");
    a.get("x");
    resetAllCaches();
    expect(a.size).toBe(0);
    expect(b.size).toBe(0);
    expect(a.stats().hits).toBe(0);
    expect(allCacheStats()[b.name]).toMatchObject({ size: 0, sets: 0 });
  });
});

describe("getOrLoad", () => {
  let c: TtlCache<string>;
  beforeEach(() => {
    c = mk();
  });

  it("stores the result and serves the next call from cache", async () => {
    const loader = vi.fn().mockResolvedValue("v");
    expect(await c.getOrLoad("k", loader)).toBe("v");
    expect(await c.getOrLoad("k", loader)).toBe("v");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent callers", async () => {
    const d = deferred<string>();
    const loader = vi.fn(() => d.promise);
    const p1 = c.getOrLoad("k", loader);
    const p2 = c.getOrLoad("k", loader);
    d.resolve("v");
    expect(await Promise.all([p1, p2])).toEqual(["v", "v"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not store undefined and cleans up after a throwing loader", async () => {
    await expect(c.getOrLoad("k", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await c.getOrLoad("k", async () => undefined)).toBeUndefined();
    expect(c.get("k")).toBeUndefined();
    expect(await c.getOrLoad("k", async () => "ok")).toBe("ok");
    expect(c._logSize()).toBe(0);
  });

  it("(a) invalidate(key) during load => result not stored, next get reloads", async () => {
    const d = deferred<string>();
    const p = c.getOrLoad("k", () => d.promise);
    c.delete("k");
    d.resolve("stale");
    expect(await p).toBe("stale"); // racing caller still gets it
    expect(c.get("k")).toBeUndefined();
    expect(c.stats().rejectedStale).toBe(1);
    const loader = vi.fn().mockResolvedValue("fresh");
    expect(await c.getOrLoad("k", loader)).toBe("fresh");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("(b) invalidate(tag) during load => not stored (static tags and tagsOf)", async () => {
    const d1 = deferred<string>();
    const p1 = c.getOrLoad("k1", () => d1.promise, { tags: ["user:1"] });
    const d2 = deferred<string>();
    const p2 = c.getOrLoad("k2", () => d2.promise, { tagsOf: (v) => [`user:${v}`] });
    c.deleteByTag("user:1");
    d1.resolve("x");
    d2.resolve("1");
    await Promise.all([p1, p2]);
    expect(c.get("k1")).toBeUndefined();
    expect(c.get("k2")).toBeUndefined();
    expect(c.stats().rejectedStale).toBe(2);
  });

  it("deleteWhere during load => not stored when predicate matches the value", async () => {
    const d = deferred<string>();
    const p = c.getOrLoad("k", () => d.promise);
    c.deleteWhere((_k, v) => v === "bad");
    d.resolve("bad");
    await p;
    expect(c.get("k")).toBeUndefined();
    const d2 = deferred<string>();
    const p2 = c.getOrLoad("k2", () => d2.promise);
    c.deleteWhere((_k, v) => v === "bad");
    d2.resolve("good");
    await p2;
    expect(c.get("k2")).toBe("good");
  });

  it("(c) clear during load => not stored", async () => {
    const d = deferred<string>();
    const p = c.getOrLoad("k", () => d.promise);
    c.clear();
    d.resolve("stale");
    await p;
    expect(c.get("k")).toBeUndefined();
  });

  it("(c2) resetAllCaches during load => not stored", async () => {
    const d = deferred<string>();
    const p = c.getOrLoad("k", () => d.promise);
    resetAllCaches();
    d.resolve("stale");
    await p;
    expect(c.get("k")).toBeUndefined();
  });

  it("(d) caller arriving after an invalidation does not join the stale in-flight load", async () => {
    const d1 = deferred<string>();
    const l1 = vi.fn(() => d1.promise);
    const p1 = c.getOrLoad("k", l1);
    c.delete("k");
    const d2 = deferred<string>();
    const l2 = vi.fn(() => d2.promise);
    const p2 = c.getOrLoad("k", l2);
    expect(l2).toHaveBeenCalledTimes(1);
    d1.resolve("stale");
    expect(await p1).toBe("stale");
    expect(c.get("k")).toBeUndefined(); // stale one must not be stored
    d2.resolve("fresh");
    expect(await p2).toBe("fresh");
    expect(c.get("k")).toBe("fresh");
  });

  it("(d2) a completing detached load does not remove the newer in-flight entry", async () => {
    const d1 = deferred<string>();
    const p1 = c.getOrLoad("k", () => d1.promise);
    c.delete("k");
    const d2 = deferred<string>();
    const p2 = c.getOrLoad("k", () => d2.promise);
    d1.resolve("stale");
    await p1;
    const l3 = vi.fn();
    const p3 = c.getOrLoad("k", l3); // must join load #2
    expect(l3).not.toHaveBeenCalled();
    d2.resolve("fresh");
    expect(await p3).toBe("fresh");
    await p2;
  });

  it("(e) invalidating a different key / tag does not discard the load", async () => {
    const d = deferred<string>();
    const p = c.getOrLoad("k", () => d.promise, { tags: ["user:1"] });
    c.delete("other");
    c.deleteByTag("user:2");
    d.resolve("v");
    await p;
    expect(c.get("k")).toBe("v");
    expect(c.stats().rejectedStale).toBe(0);
  });

  it("invalidation before the load started does not affect it", async () => {
    c.delete("k");
    expect(await c.getOrLoad("k", async () => "v")).toBe("v");
    expect(c.get("k")).toBe("v");
  });

  it("invalidation log stays bounded and empties when loads finish", async () => {
    const ds = [deferred<string>(), deferred<string>()];
    const p0 = c.getOrLoad("a", () => ds[0]!.promise);
    for (let i = 0; i < 50; i++) c.delete(`x${i}`);
    expect(c._logSize()).toBe(50);
    const p1 = c.getOrLoad("b", () => ds[1]!.promise); // startSeq 50
    for (let i = 0; i < 5; i++) c.delete(`y${i}`);
    ds[0]!.resolve("1");
    await p0;
    expect(c._logSize()).toBe(5); // only records newer than the oldest active load
    ds[1]!.resolve("2");
    await p1;
    expect(c._logSize()).toBe(0);
    for (let i = 0; i < 100; i++) c.delete(`z${i}`); // no active loads: nothing logged
    expect(c._logSize()).toBe(0);
  });
});
