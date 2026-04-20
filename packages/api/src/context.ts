import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { createHash } from "crypto";
import { logger } from "./lib/logger.js";
import { controlDb } from "@hisaabo/db";
import { sessions, users, apiKeys, accessTokens } from "@hisaabo/db";
import { eq, gt, and } from "drizzle-orm";

// Bearer session sliding-window constants — must mirror auth.ts values
const BEARER_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7-day sliding window

// Cookie session idle timeout: if lastUsedAt is older than 14 days, reject.
// Bearer sessions already have a 7-day sliding window (stricter) so this
// clause is effectively cookie-only.
const COOKIE_IDLE_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Session cache — avoids DB hit on every request (60s TTL, max 1000 entries)
// lastUsedAt is cached alongside user data so the idle check runs without a
// DB round-trip on cache-hit paths.
const sessionCache = new Map<string, {
  data: {
    userId: string;
    email: string;
    name: string | null;
    tenantId: string | null;
    lastUsedAt: Date | null;
    authMethod: "cookie" | "bearer";
  };
  expires: number;
}>();
const SESSION_CACHE_TTL = 60_000;
const SESSION_CACHE_MAX = 1000;

const revokedUsers = new Map<string, number>();
const REVOKED_TTL = 65_000;

setInterval(() => {
  const now = Date.now();
  for (const [uid, expiry] of revokedUsers) {
    if (now >= expiry) revokedUsers.delete(uid);
  }
}, 120_000).unref();

export function revokeAllUserSessions(userId: string) {
  revokedUsers.set(userId, Date.now() + REVOKED_TTL);
  for (const [key, entry] of sessionCache) {
    if (entry.data.userId === userId) sessionCache.delete(key);
  }
}

function getClientIp(req: Request): string | null {
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return null;
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

  if (rawBearerToken) {
    if (rawBearerToken.startsWith("hisaabo_key_")) {
      // ── API key path ─────────────────────────────────────────────────────
      const keyHash = createHash("sha256").update(rawBearerToken).digest("hex");

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
      if (key && (!key.expiresAt || key.expiresAt > new Date())) {
        user = { id: key.userId, email: key.email, name: key.name };
        tenantId = key.tenantId;
        // authTokenKind stays null for API keys

        controlDb
          .update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, key.keyId))
          .catch((err) => { logger.warn({ err }, "Failed to update lastUsedAt"); });
      }
    } else if (rawBearerToken.startsWith("at_")) {
      // ── Access token path (at_* prefix) ──────────────────────────────────
      // Short-lived token (15 min TTL, no sliding). Look up the access_tokens
      // table and load the parent session for user/tenant identity.
      const now = new Date();
      const atResult = await controlDb
        .select({
          sessionId: accessTokens.sessionId,
          atExpiresAt: accessTokens.expiresAt,
          userId: sessions.userId,
          tenantId: sessions.tenantId,
          email: users.email,
          name: users.name,
          sessionAuthMethod: sessions.authMethod,
        })
        .from(accessTokens)
        .innerJoin(sessions, eq(sessions.id, accessTokens.sessionId))
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(accessTokens.id, rawBearerToken))
        .limit(1);

      const atRow = atResult[0];
      if (atRow && atRow.atExpiresAt > now) {
        const revokedExpiry = revokedUsers.get(atRow.userId);
        if (!revokedExpiry || Date.now() >= revokedExpiry) {
          user = { id: atRow.userId, email: atRow.email, name: atRow.name };
          tenantId = atRow.tenantId;
          authTokenKind = "access";
          // Do NOT slide the parent session's expiresAt/lastUsedAt on access
          // token hits — only refresh-token Bearer hits do that.
        }
      }
      // Expired or missing access token → user stays null (unauthenticated)
    } else {
      // ── Refresh / session token path (legacy Bearer) ──────────────────────
      // Mobile clients send the long-lived session ID directly as Bearer.
      // Legacy desktop clients (pre-access-token) also use this path.
      // Log a warning so we can track adoption of the new access-token flow.
      const sessionId = rawBearerToken;
      const clientHeader = opts.req.headers.get("x-hisaabo-client");
      if (clientHeader === "desktop") {
        // Desktop client sending a refresh token directly — not an access token.
        // This is the legacy path; warn so we can observe roll-out.
        logger.warn({ hint: "legacy-refresh-bearer" },
          "Desktop client sent refresh token as Bearer (expected access token). " +
          "Client may be running an outdated build.");
      }

      // Check session cache first
      let cacheHit = false;
      const cached = sessionCache.get(sessionId);
      if (cached && Date.now() < cached.expires) {
        const revokedExpiry = revokedUsers.get(cached.data.userId);
        if (revokedExpiry && Date.now() < revokedExpiry) {
          sessionCache.delete(sessionId);
        } else {
          user = { id: cached.data.userId, email: cached.data.email, name: cached.data.name };
          tenantId = cached.data.tenantId;
          authTokenKind = "refresh";
          cacheHit = true;
        }
      }
      if (!cacheHit) {
        const now = new Date();
        const result = await controlDb
          .select({
            userId: sessions.userId,
            email: users.email,
            name: users.name,
            tenantId: sessions.tenantId,
            authMethod: sessions.authMethod,
            maxExpiresAt: sessions.maxExpiresAt,
            lastUsedAt: sessions.lastUsedAt,
          })
          .from(sessions)
          .innerJoin(users, eq(users.id, sessions.userId))
          .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
          .limit(1);

        if (result[0]) {
          const row = result[0];

          // ── Bearer session: absolute cap check ──────────────────────────
          if (row.authMethod === "bearer" && row.maxExpiresAt && now >= row.maxExpiresAt) {
            controlDb
              .delete(sessions)
              .where(eq(sessions.id, sessionId))
              .catch((err) => { logger.warn({ err }, "Failed to delete max-expired bearer session"); });
            sessionCache.delete(sessionId);
          } else {
            user = { id: row.userId, email: row.email, name: row.name };
            tenantId = row.tenantId;
            authTokenKind = "refresh";

            if (sessionCache.size >= SESSION_CACHE_MAX) {
              const firstKey = sessionCache.keys().next().value;
              if (firstKey) sessionCache.delete(firstKey);
            }
            sessionCache.set(sessionId, {
              data: {
                userId: row.userId,
                email: row.email,
                name: row.name,
                tenantId: row.tenantId,
                lastUsedAt: row.lastUsedAt,
                authMethod: row.authMethod,
              },
              expires: Date.now() + SESSION_CACHE_TTL,
            });

            if (row.authMethod === "bearer") {
              // ── Bearer session: sliding-window bump ──────────────────────
              const slidTo = new Date(now.getTime() + BEARER_SESSION_DURATION_MS);
              const newExpiresAt = row.maxExpiresAt && slidTo > row.maxExpiresAt
                ? row.maxExpiresAt
                : slidTo;
              invalidateSessionCache(sessionId);
              controlDb
                .update(sessions)
                .set({ lastUsedAt: now, expiresAt: newExpiresAt })
                .where(eq(sessions.id, sessionId))
                .catch((err) => { logger.warn({ err }, "Failed to update bearer session expiresAt"); });
            } else {
              controlDb
                .update(sessions)
                .set({ lastUsedAt: now })
                .where(eq(sessions.id, sessionId))
                .catch((err) => { logger.warn({ err }, "Failed to update lastUsedAt"); });
            }
          }
        } else {
          sessionCache.delete(sessionId);
        }
      }
    }
  } else if (cookieSessionId) {
    // ── Cookie session path (web) ─────────────────────────────────────────
    const sessionId = cookieSessionId;
    let cacheHit = false;
    const cached = sessionCache.get(sessionId);
    if (cached && Date.now() < cached.expires) {
      const revokedExpiry = revokedUsers.get(cached.data.userId);
      if (revokedExpiry && Date.now() < revokedExpiry) {
        sessionCache.delete(sessionId);
      } else {
        // ── Cookie idle timeout check (P2 #2) — applied on cache hits too ──
        // Cache stores lastUsedAt so we don't need a DB round-trip here.
        const effectiveLastUsed = cached.data.lastUsedAt ?? null;
        const idleMs = effectiveLastUsed
          ? Date.now() - effectiveLastUsed.getTime()
          : null;
        if (idleMs !== null && idleMs > COOKIE_IDLE_TIMEOUT_MS) {
          // Idle cookie session — treat as expired
          sessionCache.delete(sessionId);
        } else {
          user = { id: cached.data.userId, email: cached.data.email, name: cached.data.name };
          tenantId = cached.data.tenantId;
          authTokenKind = "cookie";
          cacheHit = true;
        }
      }
    }
    if (!cacheHit) {
      const now = new Date();
      const result = await controlDb
        .select({
          userId: sessions.userId,
          email: users.email,
          name: users.name,
          tenantId: sessions.tenantId,
          authMethod: sessions.authMethod,
          maxExpiresAt: sessions.maxExpiresAt,
          lastUsedAt: sessions.lastUsedAt,
          createdAt: sessions.createdAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
        .limit(1);

      if (result[0]) {
        const row = result[0];

        // ── Cookie idle timeout check (P2 #2) ────────────────────────────
        // If lastUsedAt is null (legacy/imported rows), fall back to createdAt.
        // Bearer sessions are already covered by the 7-day sliding window;
        // this check applies to cookie-method sessions only.
        if (row.authMethod === "cookie") {
          const referenceTime = row.lastUsedAt ?? row.createdAt;
          const idleMs = now.getTime() - referenceTime.getTime();
          if (idleMs > COOKIE_IDLE_TIMEOUT_MS) {
            // Idle too long — reject as expired (do not serve user)
            sessionCache.delete(sessionId);
            // Fall through: user stays null
          } else {
            user = { id: row.userId, email: row.email, name: row.name };
            tenantId = row.tenantId;
            authTokenKind = "cookie";

            if (sessionCache.size >= SESSION_CACHE_MAX) {
              const firstKey = sessionCache.keys().next().value;
              if (firstKey) sessionCache.delete(firstKey);
            }
            sessionCache.set(sessionId, {
              data: {
                userId: row.userId,
                email: row.email,
                name: row.name,
                tenantId: row.tenantId,
                lastUsedAt: row.lastUsedAt,
                authMethod: row.authMethod,
              },
              expires: Date.now() + SESSION_CACHE_TTL,
            });

            controlDb
              .update(sessions)
              .set({ lastUsedAt: now })
              .where(eq(sessions.id, sessionId))
              .catch((err) => { logger.warn({ err }, "Failed to update lastUsedAt"); });
          }
        } else {
          // Non-cookie session found via cookie header — shouldn't normally
          // happen, but handle it gracefully by serving it unchanged.
          user = { id: row.userId, email: row.email, name: row.name };
          tenantId = row.tenantId;
          authTokenKind = "cookie";

          if (sessionCache.size >= SESSION_CACHE_MAX) {
            const firstKey = sessionCache.keys().next().value;
            if (firstKey) sessionCache.delete(firstKey);
          }
          sessionCache.set(sessionId, {
            data: {
              userId: row.userId,
              email: row.email,
              name: row.name,
              tenantId: row.tenantId,
              lastUsedAt: row.lastUsedAt,
              authMethod: row.authMethod,
            },
            expires: Date.now() + SESSION_CACHE_TTL,
          });

          controlDb
            .update(sessions)
            .set({ lastUsedAt: now })
            .where(eq(sessions.id, sessionId))
            .catch((err) => { logger.warn({ err }, "Failed to update lastUsedAt"); });
        }
      } else {
        sessionCache.delete(sessionId);
      }
    }
  }

  const businessId = opts.req.headers.get("x-business-id");

  return {
    user,
    tenantId,
    businessId: businessId && user ? businessId : null,
    req: opts.req,
    resHeaders: opts.resHeaders,
    ipAddress: getClientIp(opts.req),
    authTokenKind,
  };
}

export function invalidateSessionCache(sessionId: string) {
  sessionCache.delete(sessionId);
}

// Context is the shape returned by createContext. authTokenKind is required
// in the inferred return type but tests that manually build context objects
// may omit it — we make it optional here so the Context type is compatible
// with both code paths.
type RawContext = Awaited<ReturnType<typeof createContext>>;
export type Context = Omit<RawContext, "authTokenKind"> & { authTokenKind?: "access" | "refresh" | "cookie" | null };

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
