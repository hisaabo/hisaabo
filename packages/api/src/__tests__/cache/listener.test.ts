import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import postgres from "postgres";
import { startCacheListener, CACHE_NOTIFY_CHANNEL, CACHE_LISTENER_APP_NAME, type CacheListener } from "../../lib/cache/listener.js";
import { cacheBus } from "../../lib/cache/bus.js";
import { TtlCache, isDegraded, setDegraded } from "../../lib/cache/ttl-cache.js";

const url = process.env.DATABASE_URL!;
let admin: ReturnType<typeof postgres>;
let listener: CacheListener | null = null;
const offs: Array<() => void> = [];

const okVerify = async () => ({ ok: true, missing: [] as string[] });

async function waitFor(fn: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timed out");
}

const notify = (payload: string) => admin`select pg_notify(${CACHE_NOTIFY_CHANNEL}, ${payload})`;
const listenerPids = async () =>
  (await admin`select pid from pg_stat_activity where application_name = ${CACHE_LISTENER_APP_NAME}`).map((r) => r.pid as number);

beforeAll(() => {
  admin = postgres(url, { max: 2, onnotice: () => {} });
});
afterAll(async () => {
  await admin.end({ timeout: 2 });
});
afterEach(async () => {
  while (offs.length) offs.pop()!();
  await listener?.stop();
  listener = null;
  setDegraded(false);
});

describe("cache listener", () => {
  it("maps NOTIFY payloads to bus events; garbage => all", async () => {
    listener = await startCacheListener({ connectionString: url, verifyTriggers: okVerify, watchdogIntervalMs: 60_000 });
    const tenant = vi.fn();
    const all = vi.fn();
    offs.push(cacheBus.on("tenant", tenant), cacheBus.on("all", all));
    await notify(JSON.stringify({ t: "tenants", op: "UPDATE", k: { id: "T1" } }));
    await waitFor(() => tenant.mock.calls.length > 0);
    expect(tenant).toHaveBeenCalledWith({ kind: "tenant", tenantId: "T1" });
    expect(all).not.toHaveBeenCalled();

    const c = new TtlCache<string>({ name: "listener-garbage", max: 5, ttlMs: 60_000 });
    c.set("a", "1");
    await notify("}{ garbage");
    await waitFor(() => all.mock.calls.length > 0);
    expect(c.size).toBe(0);
  });

  it("reconnect (backend terminated) fires onlisten => caches reset, and notifications still flow", async () => {
    listener = await startCacheListener({ connectionString: url, verifyTriggers: okVerify, watchdogIntervalMs: 60_000 });
    const [pid] = await listenerPids();
    expect(pid).toBeTruthy();
    const c = new TtlCache<string>({ name: "listener-reconnect", max: 5, ttlMs: 60_000 });
    c.set("a", "1");
    await admin`select pg_terminate_backend(${pid!})`;
    await waitFor(async () => {
      const pids = await listenerPids();
      return pids.length === 1 && pids[0] !== pid && c.size === 0;
    });
    const h = vi.fn();
    offs.push(cacheBus.on("maintenance", h));
    await waitFor(async () => {
      await notify(JSON.stringify({ t: "system_config", op: "UPDATE", k: { key: "m" } }));
      return h.mock.calls.length > 0;
    });
    expect(listener.healthy()).toBe(true);
  });

  it("missing triggers => degraded mode; stop() clears it", async () => {
    listener = await startCacheListener({
      connectionString: url,
      verifyTriggers: async () => ({ ok: false, missing: ["tenants"] }),
      watchdogIntervalMs: 60_000,
    });
    expect(isDegraded()).toBe(true);
    await listener.stop();
    listener = null;
    expect(isDegraded()).toBe(false);
  });

  it("watchdog: unobserved pings => degraded + listener recreated; recovery => healthy again", async () => {
    let broken = false;
    listener = await startCacheListener({
      connectionString: url,
      verifyTriggers: okVerify,
      watchdogIntervalMs: 100,
      pingTimeoutMs: 150,
      maxMisses: 2,
      sendPing: async (sql, ch, payload) => {
        if (!broken) await sql`select pg_notify(${ch}, ${payload})`;
      },
    });
    await waitFor(() => listener!.healthy());
    expect(isDegraded()).toBe(false);
    const [pidBefore] = await listenerPids();

    broken = true;
    await waitFor(() => isDegraded());
    expect(listener.healthy()).toBe(false);
    await waitFor(async () => {
      const pids = await listenerPids();
      return pids.length === 1 && pids[0] !== pidBefore;
    });

    broken = false;
    await waitFor(() => !isDegraded());
    expect(listener.healthy()).toBe(true);
  });
});
