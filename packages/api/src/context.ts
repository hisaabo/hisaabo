import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { controlDb } from "@hisaabo/db";
import { sessions, users } from "@hisaabo/db";
import { eq, gt, and } from "drizzle-orm";

export async function createContext(opts: FetchCreateContextFnOptions) {
  const sessionId = getCookie(opts.req, "session_id");

  let user: { id: string; email: string; name: string } | null = null;
  let tenantId: string | null = null;

  if (sessionId) {
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

export type Context = Awaited<ReturnType<typeof createContext>>;

function getCookie(req: Request, name: string): string | null {
  const cookies = req.headers.get("cookie");
  if (!cookies) return null;
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
