import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { createHash } from "crypto";
import { logger } from "./lib/logger.js";
import { getTrustedClientIp } from "./lib/client-ip.js";
import { controlDb } from "@hisaabo/db";
import { sessions, users, apiKeys, accessTokens } from "@hisaabo/db";
import { eq, gt, and, or, isNull, lt, sql } from "drizzle-orm";
import {
  sessionCache,
  accessTokenCache,
  apiKeyCache,
  sessionTags,
  shouldTouchApiKey,
  API_KEY_TOUCH_INTERVAL_MS,
  type SessionEntry,
  type AccessTokenEntry,
  type ApiKeyEntry,
} from "./lib/auth-caches.js";

// Bearer session sliding-window constants — must mirror auth.ts values
const BEARER_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7-day sliding window

// Cookie session idle timeout: if lastUsedAt is older than 14 days, reject.
// Bearer sessions already have a 7-day sliding window (stricter) so this
// clause is effectively cookie-only.
const COOKIE_IDLE_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// ── Session resolution (cache-backed) ─────────────────────────────────────────
//
// Sessions are read through `sessionCache.getOrLoad`, so a load that overlaps
// an invalidation (logout, revoke, tenant switch, name/email change, ...) is
// never stored — see lib/auth-caches.ts. The side effects of "this session was
// used" (lastUsedAt / sliding-window bump) run on the MISS path only, i.e.
// about once per cache TTL per session.

async function loadSession(sessionId: string): Promise<SessionEntry | undefined> {
  const now = new Date();
  const result = await controlDb
    .select({
      userId: sessions.userId,
      email: users.email,
      name: users.name,
      tenantId: sessions.tenantId,
      authMethod: sessions.authMethod,
      expiresAt: sessions.expiresAt,
      maxExpiresAt: sessions.maxExpiresAt,
      lastUsedAt: sessions.lastUsedAt,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1);

  const row = result[0];
  if (!row) return undefined;

  const entry: SessionEntry = {
    userId: row.userId,
    email: row.email,
    name: row.name,
    tenantId: row.tenantId,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    authMethod: row.authMethod,
    expiresAt: row.expiresAt,
    maxExpiresAt: row.maxExpiresAt,
  };
  // Absolute cap / idle timeout: reject before any "session used" side effect.
  if (!isSessionUsable(entry, now.getTime(), true)) return undefined;

  if (row.authMethod === "bearer") {
    // Sliding-window bump. The cached entry carries the NEW expiry so a hit
    // never re-validates against the pre-bump value.
    const slidTo = new Date(now.getTime() + BEARER_SESSION_DURATION_MS);
    const newExpiresAt = row.maxExpiresAt && slidTo > row.maxExpiresAt ? row.maxExpiresAt : slidTo;
    entry.expiresAt = newExpiresAt;
    // cache-guard: sliding-window bump; the cached entry above already carries the new expiry
    controlDb
      .update(sessions)
      .set({ lastUsedAt: now, expiresAt: newExpiresAt })
      .where(eq(sessions.id, sessionId))
      .catch((err) => { logger.warn({ err }, "Failed to update bearer session expiresAt"); });
  } else {
    // cache-guard: hot-path lastUsedAt bump; nothing authorization-relevant changes
    controlDb
      .update(sessions)
      .set({ lastUsedAt: now })
      .where(eq(sessions.id, sessionId))
      .catch((err) => { logger.warn({ err }, "Failed to update lastUsedAt"); });
  }
  return entry;
}

/**
 * Time-dependent validity of a session entry. Run on every hit (the cached
 * copy can be up to a TTL old) and on a fresh load.
 */
function isSessionUsable(e: SessionEntry, nowMs: number, fresh = false): boolean {
  if (!fresh && nowMs >= e.expiresAt.getTime()) return false;
  // Bearer: absolute cap.
  if (e.authMethod === "bearer" && e.maxExpiresAt && nowMs >= e.maxExpiresAt.getTime()) return false;
  // Cookie: idle timeout (lastUsedAt, falling back to createdAt for legacy rows).
  if (e.authMethod === "cookie") {
    const ref = e.lastUsedAt ?? e.createdAt;
    if (nowMs - ref.getTime() > COOKIE_IDLE_TIMEOUT_MS) return false;
  }
  return true;
}

async function resolveSession(sessionId: string): Promise<SessionEntry | null> {
  const entry = await sessionCache.getOrLoad(sessionId, () => loadSession(sessionId), {
    tags: [`session:${sessionId}`],
    tagsOf: (e) => sessionTags(e, sessionId),
  });
  if (!entry) return null;
  if (!isSessionUsable(entry, Date.now())) {
    sessionCache.delete(sessionId);
    if (entry.authMethod === "bearer" && entry.maxExpiresAt && Date.now() >= entry.maxExpiresAt.getTime()) {
      // cache-guard: entry already evicted from this process just above; other processes re-check max expiry on every hit
      controlDb
        .delete(sessions)
        .where(eq(sessions.id, sessionId))
        .catch((err) => { logger.warn({ err }, "Failed to delete max-expired bearer session"); });
    }
    return null;
  }
  return entry;
}

async function loadAccessToken(token: string): Promise<AccessTokenEntry | undefined> {
  const atResult = await controlDb
    .select({
      sessionId: accessTokens.sessionId,
      atExpiresAt: accessTokens.expiresAt,
      userId: sessions.userId,
      tenantId: sessions.tenantId,
      email: users.email,
      name: users.name,
    })
    .from(accessTokens)
    .innerJoin(sessions, eq(sessions.id, accessTokens.sessionId))
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(accessTokens.id, token))
    .limit(1);
  const row = atResult[0];
  if (!row || row.atExpiresAt <= new Date()) return undefined;
  return row;
}

async function loadApiKey(keyHash: string): Promise<ApiKeyEntry | undefined> {
  const result = await controlDb
    .select({
      userId: apiKeys.userId,
      tenantId: apiKeys.tenantId,
      expiresAt: apiKeys.expiresAt,
      keyId: apiKeys.id,
      email: users.email,
      name: users.name,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);
  const key = result[0];
  if (!key || (key.expiresAt && key.expiresAt <= new Date())) return undefined;
  return key;
}

/** lastUsedAt write: in-memory throttle first, SQL guard second (multi-process). */
function touchApiKey(keyId: string): void {
  if (!shouldTouchApiKey(keyId)) return;
  // cache-guard: hot-path lastUsedAt bump (throttled); nothing authorization-relevant changes
  controlDb
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(
      eq(apiKeys.id, keyId),
      or(
        isNull(apiKeys.lastUsedAt),
        lt(apiKeys.lastUsedAt, sql`now() - (${API_KEY_TOUCH_INTERVAL_MS / 1000} * interval '1 second')`),
      ),
    ))
    .catch((err) => { logger.warn({ err }, "Failed to update lastUsedAt"); });
}

export async function createContext(opts: FetchCreateContextFnOptions) {
  // NOTE: we intentionally do NOT use getSessionIdFromRequest() here because
  // createContext needs the raw token to detect the API key prefix on line 27.
  //
  // ── Bearer-wins-over-cookie precedence ──────────────────────────────────
  // An explicit `Authorization: Bearer <token>` header is an intentional,
  // active authentication choice made by the calling code. A cookie, by
  // contrast, can be replayed silently by a native HTTP stack (e.g. the
  // iOS/Android native cookie jar, OkHttp, URLSession) without the JS
  // application code ever touching it. The active choice must always win.
  //
  // Concrete scenario this prevents: on a mobile re-login, the client
  // stores a fresh session token and sends it as a Bearer header on the
  // very next request. However, the native HTTP stack may *still* be
  // carrying the stale `session_id` cookie from a previous session that
  // has not yet been garbage-collected server-side. If we read the cookie
  // first, `createContext` would authenticate the request against the
  // STALE cookie session — not the fresh Bearer session — until the stale
  // row expires. By consulting the Bearer header first, a freshly
  // re-authenticated mobile client is always resolved against its new
  // token, regardless of whatever crud is still sitting in the cookie jar.
  //
  // Web and desktop clients are unaffected: they never send an
  // Authorization header, so the code falls through to the cookie path.
  let rawBearerToken: string | null = null;
  const authHeader = opts.req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    rawBearerToken = authHeader.slice(7);
  }

  const cookieSessionId = !rawBearerToken ? getCookie(opts.req, "session_id") : null;

  let user: { id: string; email: string; name: string | null } | null = null;
  let tenantId: string | null = null;
  // authTokenKind describes HOW the request was authenticated:
  //   'access'  — short-lived access token (at_* Bearer)
  //   'refresh' — long-lived session/refresh token as Bearer (mobile / legacy desktop)
  //   'cookie'  — HttpOnly session cookie (web)
  //   null      — API key or unauthenticated
  let authTokenKind: "access" | "refresh" | "cookie" | null = null;
  let viaApiKey = false;

  if (rawBearerToken) {
    if (rawBearerToken.startsWith("hisaabo_key_")) {
      // ── API key path ─────────────────────────────────────────────────────
      // Cached by the hash of the raw key (the raw key never enters the cache
      // or any log). Revocation is immediate via the `apiKey` bus event; a hit
      // re-checks expiry.
      const keyHash = createHash("sha256").update(rawBearerToken).digest("hex");
      const key = await apiKeyCache.getOrLoad(keyHash, () => loadApiKey(keyHash), {
        tagsOf: (k) => [`apikey:${k.keyId}`, `user:${k.userId}`, `tenant:${k.tenantId}`],
      });
      if (key && (!key.expiresAt || key.expiresAt > new Date())) {
        user = { id: key.userId, email: key.email, name: key.name };
        tenantId = key.tenantId;
        // authTokenKind stays null for API keys
        viaApiKey = true;
        touchApiKey(key.keyId);
      } else if (key) {
        apiKeyCache.delete(keyHash);
      }
    } else if (rawBearerToken.startsWith("at_")) {
      // ── Access token path (at_* prefix) ──────────────────────────────────
      // Short-lived token (15 min TTL, no sliding). Cached; tagged with the
      // parent session + user so every session/user event drops it. A hit
      // re-checks the token's own expiry.
      const token = rawBearerToken;
      const at = await accessTokenCache.getOrLoad(token, () => loadAccessToken(token), {
        tagsOf: (e) => sessionTags(e, e.sessionId),
      });
      if (at && at.atExpiresAt > new Date()) {
        user = { id: at.userId, email: at.email, name: at.name };
        tenantId = at.tenantId;
        authTokenKind = "access";
        // Do NOT slide the parent session's expiresAt/lastUsedAt on access
        // token hits — only refresh-token Bearer hits do that.
      } else if (at) {
        accessTokenCache.delete(token);
      }
      // Expired or missing access token → user stays null (unauthenticated)
    } else {
      // ── Refresh / session token path (legacy Bearer) ──────────────────────
      // Mobile clients send the long-lived session ID directly as Bearer.
      // Legacy desktop clients (pre-access-token) also use this path.
      // Desktop clients legitimately send the refresh token as Bearer, so
      // this is the normal path and is deliberately not logged.
      const s = await resolveSession(rawBearerToken);
      if (s) {
        user = { id: s.userId, email: s.email, name: s.name };
        tenantId = s.tenantId;
        authTokenKind = "refresh";
      }
    }
  } else if (cookieSessionId) {
    // ── Cookie session path (web) ─────────────────────────────────────────
    const s = await resolveSession(cookieSessionId);
    if (s) {
      user = { id: s.userId, email: s.email, name: s.name };
      tenantId = s.tenantId;
      authTokenKind = "cookie";
    }
  }

  const businessId = opts.req.headers.get("x-business-id");

  return {
    user,
    tenantId,
    businessId: businessId && user ? businessId : null,
    req: opts.req,
    resHeaders: opts.resHeaders,
    ipAddress: getTrustedClientIp(opts.req.headers),
    viaApiKey,
    authTokenKind,
  };
}

// Context is the shape returned by createContext. authTokenKind is required
// in the inferred return type but tests that manually build context objects
// may omit it — we make it optional here so the Context type is compatible
// with both code paths.
type RawContext = Awaited<ReturnType<typeof createContext>>;
export type Context = Omit<RawContext, "authTokenKind" | "viaApiKey"> & {
  authTokenKind?: "access" | "refresh" | "cookie" | null;
  viaApiKey?: boolean;
};

function getCookie(req: Request, name: string): string | null {
  const cookies = req.headers.get("cookie");
  if (!cookies) return null;
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Extract the session ID from a request — checks both cookie and Bearer token.
 * Mobile clients use Bearer tokens while web uses cookies; this helper
 * normalises the two paths so callers don't need to care.
 */
export function getSessionIdFromRequest(req: Request): string | null {
  const fromCookie = getCookie(req, "session_id");
  if (fromCookie) return fromCookie;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    // API keys and short-lived access tokens are not session IDs — skip them
    if (!token.startsWith("hisaabo_key_") && !token.startsWith("at_")) return token;
  }
  return null;
}
