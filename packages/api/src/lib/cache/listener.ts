/**
 * listener.ts — cross-process cache invalidation via Postgres LISTEN/NOTIFY.
 *
 * postgres.js semantics (node_modules/postgres/src/index.js, 3.4.x):
 *  - `sql.listen` creates a dedicated max:1 client (`listen.sql`). On connection
 *    close it re-issues LISTEN for every channel, but with `.catch(noop)`: if the
 *    re-LISTEN fails (DB down longer than the connect retry) the subscription is
 *    silently lost. The `onlisten` callback fires after every successful
 *    (re)LISTEN, so it is where we drop all caches (notifications sent during the
 *    outage are lost). A watchdog (ping through a SECOND connection) catches the
 *    swallowed-failure case and recreates the listener.
 *  - LISTEN does not work through PgBouncer transaction pooling: pass the direct URL.
 *
 * Health model: `degraded = triggersMissing || listenerUnhealthy` and is
 * mirrored into the global TTL clamp (setDegraded).
 */
import postgres from "postgres";
import { CACHE_NOTIFY_CHANNEL as DB_CHANNEL, verifyCacheTriggers } from "@hisaabo/db";
import { logger } from "../logger.js";
import { cacheBus } from "./bus.js";
import { resetAllCaches, setDegraded } from "./ttl-cache.js";

export const CACHE_NOTIFY_CHANNEL: string = DB_CHANNEL;
export const CACHE_LISTENER_APP_NAME = "hisaabo-cache-listener";

type Sql = ReturnType<typeof postgres>;
export type VerifyTriggers = (sql: Sql) => Promise<{ ok: boolean; missing: string[] }>;

export interface CacheListenerOptions {
  /** Direct (non-pooled) connection string. */
  connectionString: string;
  channel?: string;
  /** Watchdog period. Default 10_000. */
  watchdogIntervalMs?: number;
  /** How long a ping may take to come back. Default 3_000. */
  pingTimeoutMs?: number;
  /** Consecutive missed pings before the listener is recreated. Default 2. */
  maxMisses?: number;
  /** Override trigger verification (default: verifyCacheTriggers from @hisaabo/db). */
  verifyTriggers?: VerifyTriggers;
  /** Test seam: how the watchdog sends its ping. */
  sendPing?: (sql: Sql, channel: string, payload: string) => Promise<void>;
}

export interface CacheListener {
  stop(): Promise<void>;
  /** True while the LISTEN is established and the last pings were observed. */
  healthy(): boolean;
}

async function defaultVerify(sql: Sql): Promise<{ ok: boolean; missing: string[] }> {
  try {
    const r = await verifyCacheTriggers(sql as never);
    return { ok: r.ok, missing: r.missing };
  } catch (err) {
    return { ok: false, missing: [`verifyCacheTriggers failed: ${(err as Error).message}`] };
  }
}

const noop = () => {};

export async function startCacheListener(opts: CacheListenerOptions): Promise<CacheListener> {
  const channel = opts.channel ?? CACHE_NOTIFY_CHANNEL;
  const intervalMs = opts.watchdogIntervalMs ?? 10_000;
  const pingTimeoutMs = opts.pingTimeoutMs ?? 3_000;
  const maxMisses = opts.maxMisses ?? 2;
  const verify = opts.verifyTriggers ?? defaultVerify;
  const sendPing =
    opts.sendPing ??
    (async (sql: Sql, ch: string, payload: string) => {
      await sql`select pg_notify(${ch}, ${payload})`;
    });
  const token = Math.random().toString(36).slice(2);

  let stopped = false;
  let gen = 0;
  let listenSql: Sql | null = null;
  let listening = false;
  let listenerUnhealthy = false;
  let triggersOk = true;
  let misses = 0;
  let pingSeq = 0;
  let pendingPing: { id: number; resolve: () => void } | null = null;
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;

  // Used for pings and trigger verification. Lazily connects.
  const control: Sql = postgres(opts.connectionString, {
    max: 1,
    idle_timeout: 20,
    onnotice: noop,
    connection: { application_name: "hisaabo-cache-watchdog" },
  });

  const syncDegraded = () => setDegraded(!triggersOk || listenerUnhealthy);

  function onNotify(payload: string): void {
    // Watchdog ping?
    if (payload.startsWith('{"t":"ping"')) {
      try {
        const p = JSON.parse(payload) as { id?: number; s?: string };
        if (p.s === token && pendingPing && pendingPing.id === p.id) pendingPing.resolve();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      cacheBus.applyNotification(payload);
    } catch (err) {
      logger.error({ err }, "cache listener: applying notification failed, clearing everything");
      cacheBus.invalidate({ kind: "all" });
    }
  }

  async function startListening(): Promise<void> {
    const g = ++gen;
    listening = false;
    const sql = postgres(opts.connectionString, {
      max: 1,
      onnotice: noop,
      connection: { application_name: CACHE_LISTENER_APP_NAME },
    });
    listenSql = sql;
    try {
      await sql.listen(
        channel,
        (payload) => {
          if (g === gen && !stopped) onNotify(payload);
        },
        () => {
          if (g !== gen || stopped) return;
          listening = true;
          resetAllCaches(); // notifications during an outage are lost
        },
      );
    } catch (err) {
      if (g === gen) {
        listening = false;
        listenerUnhealthy = true;
        syncDegraded();
        logger.warn({ err }, "cache listener: initial LISTEN failed; watchdog will retry");
      }
    }
  }

  async function recreateListener(): Promise<void> {
    const old = listenSql;
    listenSql = null;
    listening = false;
    gen++; // invalidate callbacks of the old client
    if (old) await old.end({ timeout: 0 }).catch(noop);
    if (stopped) return;
    await startListening();
  }

  async function checkTriggers(): Promise<void> {
    const r = await verify(control);
    triggersOk = r.ok;
    if (!r.ok) {
      logger.warn({ missing: r.missing }, "cache triggers missing: cross-process invalidation is unreliable, cache TTL clamped (degraded mode)");
    }
    syncDegraded();
  }

  function waitForPing(id: number): Promise<boolean> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        if (pendingPing?.id === id) pendingPing = null;
        resolve(false);
      }, pingTimeoutMs);
      pendingPing = {
        id,
        resolve: () => {
          clearTimeout(t);
          pendingPing = null;
          resolve(true);
        },
      };
    });
  }

  async function tick(): Promise<void> {
    if (ticking || stopped) return;
    ticking = true;
    try {
      const id = ++pingSeq;
      const wait = waitForPing(id);
      let sent = true;
      try {
        await sendPing(control, channel, JSON.stringify({ t: "ping", id, s: token }));
      } catch {
        sent = false;
      }
      const ok = sent && (await wait);
      if (!sent) pendingPing = null;
      if (stopped) return;
      if (ok && listening) {
        misses = 0;
        if (listenerUnhealthy) {
          listenerUnhealthy = false;
          logger.info("cache listener recovered");
          await checkTriggers();
        }
      } else {
        misses++;
        if (misses >= maxMisses) {
          if (!listenerUnhealthy) logger.warn("cache listener unhealthy: pings not observed; recreating (degraded mode)");
          listenerUnhealthy = true;
          syncDegraded();
          resetAllCaches();
          await recreateListener();
        }
      }
    } catch (err) {
      logger.error({ err }, "cache listener watchdog error");
    } finally {
      ticking = false;
    }
  }

  await startListening();
  await checkTriggers().catch((err) => {
    triggersOk = false;
    syncDegraded();
    logger.warn({ err }, "cache trigger verification failed");
  });
  syncDegraded();

  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();

  return {
    healthy: () => listening && !listenerUnhealthy && !stopped,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      gen++;
      pendingPing?.resolve();
      const l = listenSql;
      listenSql = null;
      await Promise.all([l ? l.end({ timeout: 0 }).catch(noop) : undefined, control.end({ timeout: 1 }).catch(noop)]);
      setDegraded(false);
    },
  };
}
