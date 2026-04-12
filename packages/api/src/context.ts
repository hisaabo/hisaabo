import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { createHash } from "crypto";
import { logger } from "./lib/logger.js";
import { controlDb } from "@hisaabo/db";
import { sessions, users, apiKeys } from "@hisaabo/db";
import { eq, gt, and } from "drizzle-orm";

// Session cache — avoids DB hit on every request (60s TTL, max 1000 entries)
const sessionCache = new Map<string, { data: { userId: string; email: string; name: string | null; tenantId: string | null }; expires: number }>();
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
  let sessionId: string | null = null;
  const authHeader = opts.req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    sessionId = authHeader.slice(7);
  }

  if (!sessionId) {
    sessionId = getCookie(opts.req, "session_id");
  }

  let user: { id: string; email: string; name: string | null } | null = null;
  let tenantId: string | null = null;

  if (sessionId) {
    // ── API key path — branch early if token looks like an API key ──
    if (sessionId.startsWith("hisaabo_key_")) {
      const keyHash = createHash("sha256").update(sessionId).digest("hex");

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

        // Fire-and-forget: update lastUsedAt without blocking the request
        controlDb
          .update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, key.keyId))
          .catch((err) => { logger.warn({ err }, "Failed to update lastUsedAt"); });
      }
    } else {
      // ── Session path (cookie or Bearer session token) ──
      // Check cache first
      let cacheHit = false;
      const cached = sessionCache.get(sessionId);
      if (cached && Date.now() < cached.expires) {
        const revokedExpiry = revokedUsers.get(cached.data.userId);
        if (revokedExpiry && Date.now() < revokedExpiry) {
          sessionCache.delete(sessionId);
        } else {
          user = { id: cached.data.userId, email: cached.data.email, name: cached.data.name };
          tenantId = cached.data.tenantId;
          cacheHit = true;
        }
      }
      if (!cacheHit) {
        // Cache miss — query DB
        const result = await controlDb
          .select({
            userId: sessions.userId,
            email: users.email,
            name: users.name,
            tenantId: sessions.tenantId,
          })
          .from(sessions)
          .innerJoin(users, eq(users.id, sessions.userId))
          .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
          .limit(1);

        if (result[0]) {
          user = { id: result[0].userId, email: result[0].email, name: result[0].name };
          tenantId = result[0].tenantId;

          // Evict oldest if at capacity
          if (sessionCache.size >= SESSION_CACHE_MAX) {
            const firstKey = sessionCache.keys().next().value;
            if (firstKey) sessionCache.delete(firstKey);
          }
          sessionCache.set(sessionId, {
            data: { userId: result[0].userId, email: result[0].email, name: result[0].name, tenantId: result[0].tenantId },
            expires: Date.now() + SESSION_CACHE_TTL,
          });

          // Fire-and-forget: update lastUsedAt without blocking the request
          controlDb
            .update(sessions)
            .set({ lastUsedAt: new Date() })
            .where(eq(sessions.id, sessionId))
            .catch((err) => { logger.warn({ err }, "Failed to update lastUsedAt"); });
        } else {
          sessionCache.delete(sessionId);
        }
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
  };
}

export function invalidateSessionCache(sessionId: string) {
  sessionCache.delete(sessionId);
}

export type Context = Awaited<ReturnType<typeof createContext>>;

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
    // API keys are not session IDs — skip them
    if (!token.startsWith("hisaabo_key_")) return token;
  }
  return null;
}
