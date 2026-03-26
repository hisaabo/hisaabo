import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { controlDb } from "@hisaabo/db";
import { sessions, users } from "@hisaabo/db";
import { eq, gt, and } from "drizzle-orm";

// Session cache — avoids DB hit on every request (60s TTL, max 1000 entries)
const sessionCache = new Map<string, { data: { userId: string; email: string; name: string | null; tenantId: string | null }; expires: number }>();
const SESSION_CACHE_TTL = 60_000;
const SESSION_CACHE_MAX = 1000;

export async function createContext(opts: FetchCreateContextFnOptions) {
  let sessionId = getCookie(opts.req, "session_id");

  if (!sessionId) {
    const authHeader = opts.req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      sessionId = authHeader.slice(7);
    }
  }

  let user: { id: string; email: string; name: string | null } | null = null;
  let tenantId: string | null = null;

  if (sessionId) {
    // Check cache first
    const cached = sessionCache.get(sessionId);
    if (cached && Date.now() < cached.expires) {
      user = { id: cached.data.userId, email: cached.data.email, name: cached.data.name };
      tenantId = cached.data.tenantId;
    } else {
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
