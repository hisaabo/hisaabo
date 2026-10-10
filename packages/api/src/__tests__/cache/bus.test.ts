import { describe, it, expect, vi, afterEach } from "vitest";
import { cacheBus, parseNotification, type CacheEvent } from "../../lib/cache/bus.js";
import { TtlCache } from "../../lib/cache/ttl-cache.js";

const offs: Array<() => void> = [];
afterEach(() => {
  while (offs.length) offs.pop()!();
});

describe("cacheBus", () => {
  it("fans out to every handler of the kind and only that kind", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const other = vi.fn();
    offs.push(cacheBus.on("user", h1), cacheBus.on("user", h2), cacheBus.on("tenant", other));
    cacheBus.invalidate({ kind: "user", userId: "u1" });
    expect(h1).toHaveBeenCalledWith({ kind: "user", userId: "u1" });
    expect(h2).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("accepts arrays, unsubscribes, and survives a throwing handler", () => {
    const bad = vi.fn(() => {
      throw new Error("x");
    });
    const good = vi.fn();
    const off = cacheBus.on("tenant", bad);
    offs.push(cacheBus.on("tenant", good));
    cacheBus.invalidate([{ kind: "tenant", tenantId: "a" }, { kind: "tenant", tenantId: "b" }]);
    expect(good).toHaveBeenCalledTimes(2);
    off();
    cacheBus.invalidate({ kind: "tenant", tenantId: "c" });
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it("'all' runs 'all' handlers and empties every registered cache", () => {
    const c = new TtlCache<string>({ name: "bus-all", max: 5, ttlMs: 1000 });
    c.set("a", "1");
    const h = vi.fn();
    offs.push(cacheBus.on("all", h));
    cacheBus.invalidate({ kind: "all" });
    expect(h).toHaveBeenCalledTimes(1);
    expect(c.size).toBe(0);
  });

  it("afterWrite invalidates after success, after the write finished", async () => {
    const order: string[] = [];
    offs.push(cacheBus.on("membership", () => order.push("invalidate")));
    const r = await cacheBus.afterWrite([{ kind: "membership", tenantId: "t" }], async () => {
      await Promise.resolve();
      order.push("write");
      return 42;
    });
    expect(r).toBe(42);
    expect(order).toEqual(["write", "invalidate"]);
  });

  it("afterWrite invalidates on throw and rethrows", async () => {
    const h = vi.fn();
    offs.push(cacheBus.on("user", h));
    await expect(
      cacheBus.afterWrite([{ kind: "user", userId: "u" }], async () => {
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("afterWrite function form derives events from the result; throw => all", async () => {
    const h = vi.fn();
    const all = vi.fn();
    offs.push(cacheBus.on("session", h), cacheBus.on("all", all));
    await cacheBus.afterWrite((id: string) => [{ kind: "session", sessionId: id }], async () => "s1");
    expect(h).toHaveBeenCalledWith({ kind: "session", sessionId: "s1" });
    await expect(
      cacheBus.afterWrite(() => [], async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow();
    expect(all).toHaveBeenCalledTimes(1);
  });
});

describe("parseNotification", () => {
  const cases: Array<[string, CacheEvent[]]> = [
    [
      JSON.stringify({ t: "tenant_members", op: "UPDATE", k: { tenant_id: "T", user_id: "U" } }),
      [{ kind: "membership", tenantId: "T", userId: "U" }],
    ],
    [JSON.stringify({ t: "tenants", op: "UPDATE", k: { id: "T" } }), [{ kind: "tenant", tenantId: "T" }]],
    [JSON.stringify({ t: "sessions", op: "DELETE", k: { user_id: "U", tenant_id: "T" } }), [{ kind: "session", userId: "U" }]],
    [JSON.stringify({ t: "users", op: "UPDATE", k: { id: "U" } }), [{ kind: "user", userId: "U" }]],
    [
      JSON.stringify({ t: "api_keys", op: "DELETE", k: { id: "K", user_id: "U", tenant_id: "T" } }),
      [
        { kind: "apiKey", keyId: "K", userId: "U", tenantId: "T" },
        { kind: "apiKey", userId: "U", tenantId: "T" },
      ],
    ],
    [JSON.stringify({ t: "system_config", op: "UPDATE", k: { key: "maintenance" } }), [{ kind: "maintenance" }]],
    [JSON.stringify({ t: "store_slugs", op: "UPDATE", k: { slug: "new" }, o: { slug: "old" } }), [{ kind: "storeSlug", slugs: ["new", "old"] }]],
    [JSON.stringify({ t: "store_slugs", op: "INSERT" }), [{ kind: "storeSlug" }]],
    [JSON.stringify({ t: "ping", id: 1 }), []],
  ];
  it.each(cases)("%s", (payload, expected) => {
    expect(parseNotification(payload)).toEqual(expected);
  });

  it("includes old key values on key change", () => {
    const ev = parseNotification(JSON.stringify({ t: "tenant_members", k: { tenant_id: "T2", user_id: "U" }, o: { tenant_id: "T1" } }));
    expect(ev).toEqual([
      { kind: "membership", tenantId: "T2", userId: "U" },
      { kind: "membership", tenantId: "T1", userId: "U" },
    ]);
  });

  it.each(["not json", "123", "null", "[]", '{"t":5}', '{"t":"unknown_table"}', '{"t":"tenants"}', ""])(
    "garbage %j => all",
    (payload) => {
      expect(parseNotification(payload)).toEqual([{ kind: "all" }]);
    },
  );
});
