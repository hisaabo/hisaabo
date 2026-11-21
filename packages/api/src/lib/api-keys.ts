/**
 * api-keys.ts — the ONE place an API key is minted.
 *
 * Both callers go through createApiKeyRecord so the key format, hashing,
 * expiry rule and the tenant "API key created" security alert cannot drift:
 *
 *   - routers/apiKey.ts `create`  — a signed-in owner/admin, after the role
 *                                   check and the plan limit;
 *   - lib/admin/api-key.ts        — `admin api-key create`, the operator's
 *                                   shell-only path (same checks, run there).
 *
 * The raw key is returned to the caller exactly once and never stored or
 * logged: only its SHA-256 hash and a 20-character display prefix are kept.
 */

import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { controlDb, apiKeys } from "@hisaabo/db";
import { emitTenantEvent } from "./notifications/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const API_KEY_DEFAULT_TTL_MS = 90 * DAY_MS;
export const API_KEY_MAX_TTL_MS = 365 * DAY_MS;

/** Resolves the key expiry: 90 days when omitted, never more than 365 days out. */
export function resolveApiKeyExpiry(requested: string | Date | null | undefined, now = Date.now()): Date {
  if (!requested) return new Date(now + API_KEY_DEFAULT_TTL_MS);
  const at = new Date(requested).getTime();
  if (Number.isNaN(at) || at <= now) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Expiry must be in the future" });
  }
  if (at > now + API_KEY_MAX_TTL_MS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "API keys can be valid for at most 365 days" });
  }
  return new Date(at);
}

export interface CreateApiKeyRecordInput {
  /** The user the key acts as: requests made with it carry this user's role in the tenant. */
  userId: string;
  tenantId: string;
  /** Display label ("CLI", "CI/CD", "MCP"). */
  name: string;
  /** Requested expiry; defaults to 90 days, at most 365. */
  expiresAt?: string | Date | null;
  /** Who the "API key created" alert says created it: the user's name, or a label for an operator. */
  createdByName: string;
  /** The signed-in user who created it, or null when an operator did (alert actor becomes "system"). */
  actorUserId?: string | null;
}

export interface CreatedApiKey {
  id: string;
  name: string;
  /** The raw key. Shown to the caller once; not recoverable afterwards. */
  key: string;
  keyPrefix: string;
  expiresAt: Date | null;
}

/**
 * Generate, hash and insert a key, then raise the (locked, urgent) tenant
 * security alert. Authorization and plan limits are the CALLER's job: this
 * does not check who may create a key or how many the plan allows.
 */
export async function createApiKeyRecord(input: CreateApiKeyRecordInput): Promise<CreatedApiKey> {
  const rawKey = `hisaabo_key_${randomBytes(32).toString("base64url")}`;
  // SHA-256: API keys are high-entropy, so slow hashing (argon2) is unnecessary
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  // First 20 chars for display identification
  const keyPrefix = rawKey.slice(0, 20);
  const expiresAt = resolveApiKeyExpiry(input.expiresAt);

  // cache-guard: a brand-new key hash, so no cached entry can exist for it (the key cache holds
  // only hits); other processes learn of it through the api_keys DB trigger regardless.
  const [created] = await controlDb
    .insert(apiKeys)
    .values({
      userId: input.userId,
      tenantId: input.tenantId,
      keyHash,
      keyPrefix,
      name: input.name,
      expiresAt,
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      expiresAt: apiKeys.expiresAt,
    });

  // Tell the key's owner (and the tenant's other admins): a key is a standing credential.
  await emitTenantEvent(input.tenantId, {
    type: "api_key.created",
    payload: { keyName: created.name, keyPrefix: created.keyPrefix, createdByName: input.createdByName },
    actorUserId: input.actorUserId ?? null,
    subjectUserId: input.userId,
    dedupeKey: `api_key.created:${created.id}`,
  });

  return { id: created.id, name: created.name, key: rawKey, keyPrefix: created.keyPrefix, expiresAt: created.expiresAt };
}
