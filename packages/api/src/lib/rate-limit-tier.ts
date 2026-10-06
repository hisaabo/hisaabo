/**
 * Helpers for picking a rate-limit tier for /api/trpc/* requests.
 *
 * A request only qualifies for the elevated (authenticated) tier when it
 * carries a credential with a plausible shape. This is a cheap pre-auth filter
 * (the limiter runs before any DB lookup), not proof of authentication: it
 * stops `Authorization: Bearer x` / `session_id=` from selecting the 300/min
 * tier, but a correctly shaped forged token still passes. Credential-guessing
 * endpoints are therefore limited per IP regardless of headers.
 */

const TOKEN_CHARS = "[A-Za-z0-9_-]";
const ACCESS_TOKEN = new RegExp(`^at_${TOKEN_CHARS}{32,256}$`);
const API_KEY = new RegExp(`^hisaabo_key_${TOKEN_CHARS}{32,256}$`);
// Session ids are nanoid(64); accept a little slack for legacy rows.
const SESSION_ID = new RegExp(`^${TOKEN_CHARS}{40,128}$`);

export function isPlausibleBearerToken(token: string): boolean {
  return ACCESS_TOKEN.test(token) || API_KEY.test(token) || SESSION_ID.test(token);
}

export function extractSessionCookie(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)session_id=([^;]*)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function hasPlausibleCredential(headers: {
  authorization?: string | null;
  cookie?: string | null;
}): boolean {
  const auth = headers.authorization;
  if (auth?.startsWith("Bearer ")) return isPlausibleBearerToken(auth.slice(7).trim());
  const cookie = extractSessionCookie(headers.cookie);
  return cookie !== null && SESSION_ID.test(cookie);
}

/** Procedures that accept or probe credentials; limited per IP, never tiered. */
export const STRICT_PROCEDURES = new Set([
  "auth.login",
  "auth.register",
  "auth.sendMagicLink",
  "auth.verifyMagicLink",
  "auth.confirmEmailChange",
  "tenant.peekInvitation",
]);

/** Procedure names addressed by a /api/trpc/<a>,<b> request path. */
export function trpcProcedures(requestPath: string): string[] {
  const prefix = "/api/trpc/";
  if (!requestPath.startsWith(prefix)) return [];
  let rest = requestPath.slice(prefix.length);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    // keep raw
  }
  return rest.split(",").filter(Boolean);
}

export function countStrictProcedures(requestPath: string): number {
  return trpcProcedures(requestPath).filter((p) => STRICT_PROCEDURES.has(p)).length;
}

export type RateTier = "same-auth" | "same-anon" | "ext-auth" | "ext-anon";

export function pickRateTier(opts: { sameOrigin: boolean; hasCredential: boolean }): { tier: RateTier; limit: number } {
  if (opts.sameOrigin && opts.hasCredential) return { tier: "same-auth", limit: 300 };
  if (opts.sameOrigin) return { tier: "same-anon", limit: 60 };
  if (opts.hasCredential) return { tier: "ext-auth", limit: 120 };
  return { tier: "ext-anon", limit: 10 };
}

export const STRICT_AUTH_LIMIT_PER_MIN = 20;
export const MAX_TRPC_BATCH = 25;
