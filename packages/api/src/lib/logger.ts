import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
// HISAABO_LOG_STDERR=1 sends log lines to stderr. Set by operator CLIs whose stdout is the product
// (`admin api-key create` prints a key there), so scripted capture of stdout stays clean.
const logToStderr = process.env.HISAABO_LOG_STDERR === "1";
const level = process.env.LOG_LEVEL || (isProduction ? "info" : "debug");

export const logger = isProduction
  ? logToStderr
    ? pino({ level }, pino.destination(2))
    : pino({ level })
  : pino({
      level,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss.l", ...(logToStderr && { destination: 2 }) },
      },
    });

/** Create a child logger with request context */
export function createRequestLogger(requestId: string, method: string, path: string) {
  return logger.child({ requestId, method, path });
}

export type Logger = pino.Logger;

// ── Security events (consumed by fail2ban on the host) ────────
// Stable JSON shape — operators write fail2ban regexes against these
// fields and any rename here is a breaking change for installed jails.
// See docs/fail2ban/ for the matching filters.
export type SecurityEvent =
  | "rate_limit"
  | "rate_limit_pdf"
  | "rate_limit_store"
  | "rate_limit_store_post"
  | "rate_limit_order"
  | "csrf_fail"
  | "origin_block"
  | "login_fail"
  | "login_lockout"
  | "ops_auth_fail"
  | "turnstile_legacy_exempt"
  | "unverified_account_claimed"
  | "email_change_wrong_account"
  // `admin api-key create|revoke` (shell-only operator path). Ids and flags only, never the key.
  | "api_key_operator_issued"
  | "api_key_operator_revoked";

export function logSecurityEvent(
  event: SecurityEvent,
  fields: {
    ip: string | null | undefined;
    path?: string;
    reason?: string;
    /** Extra non-PII scalars (ids, counts). Appended after the stable fields. */
    extra?: Record<string, string | number | boolean>;
  },
): void {
  logger.warn(
    {
      sec: true,
      event,
      ip: fields.ip || "unknown",
      ...(fields.path !== undefined && { path: fields.path }),
      ...(fields.reason !== undefined && { reason: fields.reason }),
      ...fields.extra,
    },
    `sec ${event}`,
  );
}
