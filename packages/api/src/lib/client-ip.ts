/**
 * Single source of truth for deriving the client IP from a request.
 *
 * Forwarding headers are attacker-controlled unless they were set by a proxy
 * we operate. Trust is therefore explicit and opt-in:
 *
 *   TRUST_CLOUDFLARE=true  honour `cf-connecting-ip` (only enable when the API
 *                          is reachable exclusively through Cloudflare).
 *   TRUST_PROXY_HOPS=N     number of trusted reverse proxies in front of the
 *                          API that each append to X-Forwarded-For. The client
 *                          IP is the Nth entry from the right. Default 1
 *                          (a single nginx/Caddy/load balancer). Use 0 when
 *                          the API is directly exposed: forwarding headers are
 *                          then ignored entirely.
 *
 * Returns null when no trustworthy address can be derived; callers fall back
 * to their own "unknown" bucket.
 */

export function getTrustedClientIp(headers: Headers): string | null {
  if (process.env.TRUST_CLOUDFLARE === "true") {
    const cfIp = headers.get("cf-connecting-ip")?.trim();
    if (cfIp) return cfIp;
  }

  const hopsRaw = process.env.TRUST_PROXY_HOPS;
  const hops = hopsRaw === undefined || hopsRaw === "" ? 1 : Number.parseInt(hopsRaw, 10);
  if (!Number.isFinite(hops) || hops <= 0) return null;

  const xff = headers.get("x-forwarded-for");
  if (!xff) return null;
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // Nth entry from the right; if the chain is shorter than expected, take the
  // left-most entry the trusted proxy could have written.
  return parts[Math.max(0, parts.length - hops)] ?? null;
}
