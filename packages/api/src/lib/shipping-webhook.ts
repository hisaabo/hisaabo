import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TOLERANCE_MS = 5 * 60_000;

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Parse epoch seconds/millis or an ISO string; null when not a valid date. */
export function parseWebhookTime(value: unknown): Date | null {
  let d: Date;
  if (typeof value === "number" && Number.isFinite(value)) {
    d = new Date(value < 1e12 ? value * 1000 : value);
  } else if (typeof value === "string" && value.trim() !== "") {
    const v = value.trim();
    d = /^\d+$/.test(v) ? new Date(Number(v) < 1e12 ? Number(v) * 1000 : Number(v)) : new Date(v);
  } else {
    return null;
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

export type WebhookVerdict = { ok: true } | { ok: false; status: 400 | 401; error: string };

/**
 * Signature scheme:
 *  - Preferred: `x-webhook-timestamp` header present; signature is
 *    HMAC-SHA256(secret, `${timestamp}.${rawBody}`) and the timestamp must be
 *    within +-5 minutes (replay protection).
 *  - Legacy (existing carriers): no timestamp header; HMAC over the raw body
 *    only. Set `requireTimestamp` to refuse this.
 */
export function verifyShippingWebhook(opts: {
  secret: string;
  rawBody: string;
  signature: string;
  timestampHeader?: string | null;
  requireTimestamp?: boolean;
  now?: number;
}): WebhookVerdict {
  const now = opts.now ?? Date.now();
  const sig = opts.signature.trim().toLowerCase();

  if (opts.timestampHeader) {
    const ts = parseWebhookTime(opts.timestampHeader);
    if (!ts) return { ok: false, status: 400, error: "Invalid timestamp" };
    if (Math.abs(now - ts.getTime()) > WEBHOOK_TOLERANCE_MS) {
      return { ok: false, status: 401, error: "Timestamp outside allowed window" };
    }
    const expected = createHmac("sha256", opts.secret).update(`${opts.timestampHeader}.${opts.rawBody}`).digest("hex");
    return safeEqualHex(expected, sig) ? { ok: true } : { ok: false, status: 401, error: "Invalid signature" };
  }

  if (opts.requireTimestamp) return { ok: false, status: 401, error: "Missing timestamp" };
  const expected = createHmac("sha256", opts.secret).update(opts.rawBody).digest("hex");
  return safeEqualHex(expected, sig) ? { ok: true } : { ok: false, status: 401, error: "Invalid signature" };
}
