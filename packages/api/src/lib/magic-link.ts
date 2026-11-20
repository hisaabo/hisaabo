/**
 * magic-link.ts — the one place magic-link tokens and URLs are minted.
 *
 * Used by `auth.sendMagicLink` (emailed link) and by the operator break-glass
 * command `admin login-link` (printed link, for installs whose email delivery
 * is not working). Both write the same `magic_link_tokens` row shape and are
 * redeemed by `auth.verifyMagicLink`, which looks the row up by sha256 of the
 * raw token and consumes it atomically (single use).
 *
 * Pure: no database access, so it is safe to import from the admin CLI bundle
 * and from DB-free unit tests.
 */

import { randomUUID } from "node:crypto";
import { nanoid } from "nanoid";
import { sha256Hex } from "./native-auth.js";

/** Lifetime of an emailed magic link. */
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/** sha256 hex of the raw token — what `verifyMagicLink` computes and looks up. */
export function hashMagicLinkToken(rawToken: string): string {
  return sha256Hex(rawToken);
}

/** A fresh unguessable token and the hash that is stored in `magic_link_tokens.token_hash`. */
export function generateMagicLinkToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomUUID() + "-" + nanoid(32);
  return { rawToken, tokenHash: hashMagicLinkToken(rawToken) };
}

/**
 * The HTTPS URL the user opens to redeem a token (the web app's /auth/verify
 * page). `source` is only threaded through for older native clients.
 */
export function buildMagicLinkUrl(
  baseUrl: string,
  rawToken: string,
  source?: "desktop" | "mobile" | "web",
): string {
  const sourceSuffix = source === "desktop" || source === "mobile" ? `&source=${source}` : "";
  return `${baseUrl.replace(/\/+$/, "")}/auth/verify?token=${encodeURIComponent(rawToken)}${sourceSuffix}`;
}
