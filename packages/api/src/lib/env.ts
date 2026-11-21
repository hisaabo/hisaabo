import { logger } from "./logger.js";
import { opsConfig } from "../ops/config.js";
import { describeApiPublicUrlFallback, isValidHttpUrl } from "./public-url.js";

interface EnvCheck {
  key: string;
  required: boolean;
  condition?: () => boolean; // only required when condition returns true
  hint?: string;
  apiOnly?: boolean; // not needed by the queue worker process
}

const checks: EnvCheck[] = [
  { key: "DATABASE_URL", required: true, hint: "PostgreSQL connection string" },
  { key: "CORS_ORIGINS", required: true, apiOnly: true, hint: "Comma-separated allowed origins (e.g. https://app.hisaabo.in)" },
  { key: "APP_URL", required: false, hint: "Frontend URL for magic link emails" },
  { key: "ALLOW_OPEN_SIGNUP", required: false, hint: "Set to \"true\" to let anyone register on a self-hosted server (default: invite-only after the first owner)" },
  {
    key: "ENCRYPTION_KEY",
    required: false,
    condition: () =>
      process.env.NODE_ENV === "production" ||
      process.env.MULTI_TENANT === "true",
    hint: "Required in production and multi-tenant mode for field-level encryption of sensitive credentials (e-invoice, carrier API keys). Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  },
  {
    key: "RESEND_API_KEY",
    required: false,
    condition: () => process.env.NODE_ENV === "production",
    hint: "Required for email sending in production (magic links, invites)",
  },
];

export function isValidEncryptionKey(key: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(key);
}

/**
 * Validate required environment variables at startup.
 * Logs warnings for missing optional vars, throws for required vars.
 */
export function validateEnv(opts: { role?: "api" | "worker" } = {}): void {
  const errors: string[] = [];

  for (const check of checks) {
    if (check.apiOnly && opts.role === "worker") continue;
    const value = process.env[check.key];
    const isRequired = check.required || (check.condition ? check.condition() : false);

    if (!value) {
      if (isRequired) {
        errors.push(`${check.key} is required. ${check.hint || ""}`);
      } else if (check.hint) {
        logger.warn({ key: check.key }, `${check.key} not set — ${check.hint}`);
      }
    }
  }

  const encKey = process.env.ENCRYPTION_KEY;
  const isProd = process.env.NODE_ENV === "production";
  const isMultiTenant = process.env.MULTI_TENANT === "true";
  if (encKey && (isProd || isMultiTenant) && !isValidEncryptionKey(encKey)) {
    if (isMultiTenant) {
      // Multi-tenant stores per-tenant database passwords encrypted with this
      // key; provisioning and every tenant connection depend on it being valid.
      errors.push("ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) in multi-tenant mode.");
    } else {
      // Single-tenant: do NOT refuse to boot. v0.9.0 accepted any value here and
      // only failed when a credential was actually encrypted/decrypted, so
      // existing installs may carry a malformed key and must keep starting.
      // Nothing can have been encrypted under such a key (crypto.ts throws on a
      // key that is not 64 hex chars — it never falls back to plaintext), so the
      // only consequence is that encrypting/decrypting e-invoice and carrier
      // credentials fails until the key is fixed.
      logger.warn(
        "ENCRYPTION_KEY is not exactly 64 hex characters (32 bytes). The server will start, but saving or reading " +
          "encrypted credentials (e-invoice, carrier API keys) will fail until you set a valid key. " +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
  }
  if (
    isProd &&
    !process.env.ENCRYPTION_KEY &&
    !process.env.SESSION_SECRET &&
    !process.env.EXPORT_SECRET
  ) {
    errors.push("A signing secret is required in production: set ENCRYPTION_KEY (or SESSION_SECRET / EXPORT_SECRET).");
  }

  // /ops operator dashboard (docs/architecture/queue.md §7.2). TOTP secrets
  // are encrypted with ENCRYPTION_KEY, so the dashboard needs a real key in
  // every mode.
  if (opts.role !== "worker" && process.env.QUEUE_DASHBOARD_ENABLED === "true") {
    if (!encKey || !isValidEncryptionKey(encKey)) {
      errors.push("QUEUE_DASHBOARD_ENABLED=true requires ENCRYPTION_KEY (64 hex characters): operator TOTP secrets are encrypted with it.");
    }
    try {
      opsConfig();
    } catch (err) {
      errors.push((err as Error).message);
    }
    if (!process.env.OPS_IP_ALLOWLIST) {
      logger.warn("QUEUE_DASHBOARD_ENABLED=true without OPS_IP_ALLOWLIST: /ops is reachable from any IP (still behind sign-in + TOTP). Set OPS_IP_ALLOWLIST to restrict it.");
    }
  }

  // API_PUBLIC_URL is optional: it did not exist in v0.9.0, so an upgrade that
  // keeps the old env file must still boot. A SET value must be a valid URL;
  // an unset one falls back (see lib/public-url.ts) with a loud warning.
  const publicUrl = process.env.API_PUBLIC_URL?.trim();
  if (publicUrl) {
    if (!isValidHttpUrl(publicUrl)) {
      if (isProd) errors.push("API_PUBLIC_URL must be a valid http:// or https:// URL.");
      else logger.warn("API_PUBLIC_URL is not a valid http(s) URL and will be ignored.");
    }
  } else if (isProd) {
    const fallbackWarning = describeApiPublicUrlFallback();
    if (fallbackWarning) logger.warn(fallbackWarning);
  }

  if (errors.length > 0) {
    for (const err of errors) logger.error(err);
    throw new Error(`Missing required environment variables:\n  ${errors.join("\n  ")}`);
  }

  logger.info("Environment validation passed");
}
