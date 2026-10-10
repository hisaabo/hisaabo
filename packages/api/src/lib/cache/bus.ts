/**
 * bus.ts — the ONLY mapping from "entity changed" events to cache invalidation.
 *
 * Concrete caches (created by other modules) subscribe with `cacheBus.on(kind,
 * handler)`; writers call `cacheBus.invalidate(event)` / `afterWrite(...)`
 * AFTER their write resolved. Fan-out is synchronous. Event `all` additionally
 * empties every registered cache (clearAllCaches) after its handlers ran.
 */
import { logger } from "../logger.js";
import { clearAllCaches } from "./ttl-cache.js";

export type CacheEvent =
  | { kind: "user"; userId: string }
  | { kind: "session"; userId?: string; sessionId?: string }
  | { kind: "apiKey"; keyId?: string; userId?: string; tenantId?: string }
  | { kind: "membership"; tenantId: string; userId?: string }
  | { kind: "tenant"; tenantId: string }
  | { kind: "business"; tenantId: string; businessId?: string }
  | { kind: "storeSlug"; slugs?: string[] }
  | { kind: "maintenance" }
  | { kind: "all" };

export type CacheEventKind = CacheEvent["kind"];
export type CacheEventOf<K extends CacheEventKind> = Extract<CacheEvent, { kind: K }>;
export type CacheEventHandler<K extends CacheEventKind> = (event: CacheEventOf<K>) => void;

type AnyHandler = (event: CacheEvent) => void;
const handlers = new Map<CacheEventKind, Set<AnyHandler>>();

function dispatch(event: CacheEvent): void {
  const set = handlers.get(event.kind);
  if (set) {
    for (const h of set) {
      try {
        h(event);
      } catch (err) {
        logger.error({ err, kind: event.kind }, "cache bus handler threw");
      }
    }
  }
  if (event.kind === "all") clearAllCaches();
}

/** Parsed NOTIFY payload -> events. Exported for tests. `ping` => []. */
export function parseNotification(payload: string): CacheEvent[] {
  const ALL: CacheEvent[] = [{ kind: "all" }];
  let p: unknown;
  try {
    p = JSON.parse(payload);
  } catch {
    return ALL;
  }
  if (!p || typeof p !== "object") return ALL;
  const { t, k, o } = p as { t?: unknown; k?: unknown; o?: unknown };
  if (typeof t !== "string") return ALL;
  if (t === "ping") return [];

  const vals = (col: string): string[] => {
    const out = new Set<string>();
    for (const src of [k, o]) {
      if (src && typeof src === "object") {
        const v = (src as Record<string, unknown>)[col];
        if (typeof v === "string" && v) out.add(v);
      }
    }
    return [...out];
  };

  switch (t) {
    case "tenant_members": {
      const tenants = vals("tenant_id");
      if (tenants.length === 0) return ALL;
      const users = vals("user_id");
      const out: CacheEvent[] = [];
      for (const tenantId of tenants) {
        if (users.length === 0) out.push({ kind: "membership", tenantId });
        else for (const userId of users) out.push({ kind: "membership", tenantId, userId });
      }
      return out;
    }
    case "tenants": {
      const ids = vals("id");
      return ids.length ? ids.map((tenantId) => ({ kind: "tenant", tenantId })) : ALL;
    }
    case "sessions": {
      const users = vals("user_id");
      return users.length ? users.map((userId) => ({ kind: "session", userId })) : ALL;
    }
    case "users": {
      const ids = vals("id");
      return ids.length ? ids.map((userId) => ({ kind: "user", userId })) : ALL;
    }
    case "api_keys": {
      const ids = vals("id");
      const users = vals("user_id");
      const tenants = vals("tenant_id");
      if (ids.length === 0 && users.length === 0 && tenants.length === 0) return ALL;
      const out: CacheEvent[] = ids.map((keyId) => ({ kind: "apiKey", keyId, userId: users[0], tenantId: tenants[0] }));
      for (const userId of users) out.push({ kind: "apiKey", userId, tenantId: tenants[0] });
      return out.length ? out : tenants.map((tenantId) => ({ kind: "apiKey", tenantId }));
    }
    case "system_config":
      return [{ kind: "maintenance" }];
    case "store_slugs": {
      const slugs = vals("slug");
      return [{ kind: "storeSlug", ...(slugs.length ? { slugs } : {}) }];
    }
    default:
      return ALL;
  }
}

export const cacheBus = {
  /** Subscribe to one event kind. Returns an unsubscribe function. */
  on<K extends CacheEventKind>(kind: K, handler: CacheEventHandler<K>): () => void {
    let set = handlers.get(kind);
    if (!set) handlers.set(kind, (set = new Set()));
    set.add(handler as AnyHandler);
    return () => {
      set!.delete(handler as AnyHandler);
    };
  },

  /** Synchronous fan-out. A throwing handler never prevents the others. */
  invalidate(events: CacheEvent | readonly CacheEvent[]): void {
    for (const e of Array.isArray(events) ? (events as readonly CacheEvent[]) : [events as CacheEvent]) dispatch(e);
  },

  /**
   * Run `fn` (the awaited write/transaction), then invalidate in `finally`
   * (also when it throws: a rolled back or partially applied write must not
   * leave a stale cache). With the function form of `events` a throw has no
   * result to derive events from, so it invalidates `all`.
   */
  async afterWrite<T>(
    events: readonly CacheEvent[] | ((result: T) => readonly CacheEvent[]),
    fn: () => Promise<T>,
  ): Promise<T> {
    let result: T | undefined;
    let ok = false;
    try {
      result = await fn();
      ok = true;
      return result;
    } finally {
      if (typeof events === "function") {
        cacheBus.invalidate(ok ? events(result as T) : [{ kind: "all" }]);
      } else {
        cacheBus.invalidate(events);
      }
    }
  },

  /** Map a NOTIFY payload to events and apply them (garbage => all). */
  applyNotification(payload: string): void {
    cacheBus.invalidate(parseNotification(payload));
  },

  /** Test helper: drop all subscriptions. */
  _clearHandlers(): void {
    handlers.clear();
  },
};
