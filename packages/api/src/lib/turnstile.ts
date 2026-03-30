/**
 * Cloudflare Turnstile server-side token verification.
 *
 * - Returns true immediately when TURNSTILE_SECRET_KEY is not set in non-production
 *   environments (dev / self-hosted installs).
 * - Returns false and logs a critical error when the key is absent in production,
 *   so self-hosted operators who deliberately omit it are not silently blocked.
 */
export async function verifyTurnstile(token: string, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[turnstile] CRITICAL: TURNSTILE_SECRET_KEY not set in production!");
      return false;
    }
    return true; // Allow in dev / self-hosted without the key
  }

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret,
      response: token,
      remoteip: ip || undefined,
    }),
  });
  const data = await res.json() as { success: boolean };
  return data.success;
}
