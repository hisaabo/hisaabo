import { logger } from "./logger.js";

interface EnvCheck {
  key: string;
  required: boolean;
  condition?: () => boolean; // only required when condition returns true
  hint?: string;
}

const checks: EnvCheck[] = [
  { key: "DATABASE_URL", required: true, hint: "PostgreSQL connection string" },
  { key: "CORS_ORIGINS", required: true, hint: "Comma-separated allowed origins (e.g. https://app.hisaabo.in)" },
  { key: "APP_URL", required: false, hint: "Frontend URL for magic link emails" },
  {
    key: "API_PUBLIC_URL",
    required: false,
    condition: () => process.env.NODE_ENV === "production",
    hint: "Public base URL of this API (http:// or https://), used for absolute links and webhooks. Required in production",
  },
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

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validate required environment variables at startup.
 * Logs warnings for missing optional vars, throws for required vars.
 */
export function validateEnv(): void {
  const errors: string[] = [];

  for (const check of checks) {
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
  // Multi-tenant stores per-tenant DB passwords; without a valid key they would
  // be written in plaintext (crypto.ts encryptField falls back to plaintext).
  const needsStrictKey = process.env.NODE_ENV === "production" || process.env.MULTI_TENANT === "true";
  if (encKey && needsStrictKey && !isValidEncryptionKey(encKey)) {
    errors.push("ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) in production and multi-tenant mode.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.ENCRYPTION_KEY &&
    !process.env.SESSION_SECRET &&
    !process.env.EXPORT_SECRET
  ) {
    errors.push("A signing secret is required in production: set ENCRYPTION_KEY (or SESSION_SECRET / EXPORT_SECRET).");
  }

  const publicUrl = process.env.API_PUBLIC_URL;
  if (publicUrl && process.env.NODE_ENV === "production" && !isValidHttpUrl(publicUrl)) {
    errors.push("API_PUBLIC_URL must be a valid http:// or https:// URL.");
  }

  if (errors.length > 0) {
    for (const err of errors) logger.error(err);
    throw new Error(`Missing required environment variables:\n  ${errors.join("\n  ")}`);
  }

  logger.info("Environment validation passed");
}
