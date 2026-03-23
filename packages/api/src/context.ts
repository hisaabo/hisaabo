import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { db } from "@billbook/db";
import { sessions, users } from "@billbook/db";
import { eq, gt } from "drizzle-orm";

export async function createContext(opts: FetchCreateContextFnOptions) {
  const sessionId = getCookie(opts.req, "session_id");

  let user: { id: string; email: string; name: string } | null = null;
  let currentBusinessId: string | null = null;

  if (sessionId) {
    const result = await db
      .select({
        userId: sessions.userId,
        email: users.email,
        name: users.name,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(gt(sessions.expiresAt, new Date()))
      .limit(1);

    if (result[0]) {
      user = { id: result[0].userId, email: result[0].email, name: result[0].name };
    }
  }

  // Business ID from header (set by frontend after business selection)
  const businessId = opts.req.headers.get("x-business-id");
  if (businessId && user) {
    currentBusinessId = businessId;
  }

  return {
    user,
    businessId: currentBusinessId,
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
