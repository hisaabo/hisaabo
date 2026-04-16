/**
 * Export token sign/verify utility.
 *
 * Tokens are HMAC-SHA256 signed JWTs-lite: base64url(header).base64url(payload).hmac
 * TTL: 5 minutes, single-use.
 *
 * NOTE: Consumed nonces are tracked in a process-local Map with TTL eviction.
 * This does NOT survive restarts — acceptable because the token TTL is only 5 min.
 * If the server restarts, all in-flight tokens are invalidated (users get a fresh URL).
 * In multi-instance deployments, a token issued on instance A can only be consumed
 * on instance A. For v1 this is acceptable; v2 can move to Redis.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getSecret(): string {
  // Reuse ENCRYPTION_KEY as the signing secret; fall back to a derived constant
  // for dev environments where the key is not set.
  const key = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!key) {
    // In dev, derive a stable secret from a fixed string so tokens survive hot reloads.
    return "hisaabo-export-dev-secret-NOT-FOR-PRODUCTION";
  }
  return key;
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function b64encode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function b64decode(s: string): unknown {
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// ── Consumed nonce registry (in-memory, TTL eviction) ─────────────────────────
// Key: nonce, Value: eviction timestamp
const consumedNonces = new Map<string, number>();

// Evict expired nonces every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [nonce, expires] of consumedNonces) {
    if (now >= expires) consumedNonces.delete(nonce);
  }
}, 10 * 60_000).unref();

// ── Public API ─────────────────────────────────────────────────────────────────

export interface ExportTokenPayload {
  tenantId: string;
  userId: string;
}

/**
 * Sign a new export token.
 * Returns the opaque token string and the absolute expiry Date.
 */
export function signExportToken(
  tenantId: string,
  userId: string,
): { token: string; expiresAt: Date } {
  const exp = Date.now() + TOKEN_TTL_MS;
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const payload = b64encode({ tenantId, userId, exp, nonce });
  const sig = sign(payload);
  const token = `${payload}.${sig}`;

  return { token, expiresAt: new Date(exp) };
}

/**
 * Verify an export token.
 * Returns the payload if valid and unused; null otherwise.
 *
 * Side effect: marks the nonce as consumed so the token cannot be replayed.
 */
export function verifyExportToken(token: string): ExportTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payload, receivedSig] = parts;

  // ── Signature check ──────────────────────────────────────────────────────────
  const expectedSig = sign(payload);
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  const receivedBuf = Buffer.from(receivedSig, "utf8");
  if (
    expectedBuf.length !== receivedBuf.length ||
    !timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    return null;
  }

  // ── Decode ───────────────────────────────────────────────────────────────────
  const data = b64decode(payload) as {
    tenantId: string;
    userId: string;
    exp: number;
    nonce: string;
  } | null;

  if (
    !data ||
    typeof data.tenantId !== "string" ||
    typeof data.userId !== "string" ||
    typeof data.exp !== "number" ||
    typeof data.nonce !== "string"
  ) {
    return null;
  }

  // ── Expiry check ─────────────────────────────────────────────────────────────
  if (Date.now() > data.exp) return null;

  // ── Single-use check ─────────────────────────────────────────────────────────
  if (consumedNonces.has(data.nonce)) return null;

  // Mark consumed — eviction set to exp + 1 minute buffer
  consumedNonces.set(data.nonce, data.exp + 60_000);

  return { tenantId: data.tenantId, userId: data.userId };
}
