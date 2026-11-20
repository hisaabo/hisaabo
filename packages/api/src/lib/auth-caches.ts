/**
 * auth-caches.ts — concrete caches for the authentication path, built on the
 * cache core (TtlCache + cacheBus). See lib/cache/*.
 *
 *   cache          key                    tags                        TTL / max
 *   sessions       session id             session:S, user:U           60s / 5000
 *   accessTokens   at_ token              session:S, user:U           60s / 5000
 *   apiKeys        sha256(raw key)        apikey:ID, user:U, tenant:T 60s / 2000
 *
 * Writers never touch these directly: they emit a CacheEvent on `cacheBus`
 * AFTER their write settled. Because every entry is loaded through
 * `getOrLoad`, a load that overlaps an invalidation is never stored
 * (no-resurrection) — which is what makes a separate "revoked users" marker
 * unnecessary.
 *
 * Hits re-validate the time-dependent fields (expiresAt / maxExpiresAt /
 * access-token expiry / API key expiry) because the cached copy may be up to
 * TTL old.
 */
import { TtlCache } from "./cache/ttl-cache.js";
import { cacheBus } from "./cache/bus.js";

export const SESSION_CACHE_TTL_MS = 60_000;

export interface SessionEntry {
  userId: string;
  email: string;
  name: string | null;
  tenantId: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  authMethod: "cookie" | "bearer";
  /** Effective expiry (already includes the sliding-window bump). */
  expiresAt: Date;
  /** Absolute cap (bearer sessions only). */
  maxExpiresAt: Date | null;
}

export interface AccessTokenEntry {
  sessionId: string;
  userId: string;
  email: string;
  name: string | null;
  tenantId: string | null;
  atExpiresAt: Date;
}

export interface ApiKeyEntry {
  keyId: string;
  userId: string;
  tenantId: string;
  expiresAt: Date | null;
  email: string;
  name: string | null;
}

export const sessionCache = new TtlCache<SessionEntry>({ name: "sessions", max: 5000, ttlMs: SESSION_CACHE_TTL_MS });
export const accessTokenCache = new TtlCache<AccessTokenEntry>({ name: "accessTokens", max: 5000, ttlMs: SESSION_CACHE_TTL_MS });
export const apiKeyCache = new TtlCache<ApiKeyEntry>({ name: "apiKeys", max: 2000, ttlMs: SESSION_CACHE_TTL_MS });

export const sessionTags = (e: { userId: string }, sessionId: string): string[] => [
  `session:${sessionId}`,
  `user:${e.userId}`,
];

// ── bus subscriptions ────────────────────────────────────────────────────────

for (const cache of [sessionCache, accessTokenCache] as const) {
  cacheBus.on("user", (e) => {
    cache.deleteByTag(`user:${e.userId}`);
  });
  cacheBus.on("session", (e) => {
    // A session event with neither id is malformed: fail closed.
    if (!e.sessionId && !e.userId) {
      cache.clear();
      return;
    }
    if (e.sessionId) cache.deleteByTag(`session:${e.sessionId}`);
    if (e.userId) cache.deleteByTag(`user:${e.userId}`);
  });
}

cacheBus.on("user", (e) => {
  apiKeyCache.deleteByTag(`user:${e.userId}`);
});
cacheBus.on("apiKey", (e) => {
  if (!e.keyId && !e.userId && !e.tenantId) {
    apiKeyCache.clear();
    return;
  }
  if (e.keyId) apiKeyCache.deleteByTag(`apikey:${e.keyId}`);
  // userId (superset of "this user in this tenant") is cheap and safe.
  if (e.userId) apiKeyCache.deleteByTag(`user:${e.userId}`);
  else if (e.tenantId) apiKeyCache.deleteByTag(`tenant:${e.tenantId}`);
});
cacheBus.on("tenant", (e) => {
  // A tenant-level change (status/plan) must not leave keys of that tenant live
  // beyond the authz check; keys are re-validated against membership anyway,
  // but dropping them keeps one rule: tenant event => tenant-tagged entries go.
  apiKeyCache.deleteByTag(`tenant:${e.tenantId}`);
});

// ── API key lastUsedAt write throttle ────────────────────────────────────────
// At most one UPDATE per key per 5 minutes: an in-memory bounded map makes
// cache hits free; the SQL guard in context.ts makes multi-process safe.

export const API_KEY_TOUCH_INTERVAL_MS = 5 * 60_000;
const TOUCH_MAP_MAX = 5000;
const lastTouched = new Map<string, number>();

/** True when this key's lastUsedAt should be written now (and records it). */
export function shouldTouchApiKey(keyId: string, now = Date.now()): boolean {
  const prev = lastTouched.get(keyId);
  if (prev !== undefined && now - prev < API_KEY_TOUCH_INTERVAL_MS) return false;
  lastTouched.delete(keyId);
  lastTouched.set(keyId, now);
  while (lastTouched.size > TOUCH_MAP_MAX) {
    const oldest = lastTouched.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    lastTouched.delete(oldest);
  }
  return true;
}

/** Test helper. */
export function _resetApiKeyTouchThrottle(): void {
  lastTouched.clear();
}
