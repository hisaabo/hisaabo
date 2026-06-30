import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss.l" },
    },
  }),
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
  | "login_lockout";

export function logSecurityEvent(
  event: SecurityEvent,
  fields: { ip: string | null | undefined; path?: string; reason?: string },
): void {
  logger.warn(
    {
      sec: true,
      event,
      ip: fields.ip || "unknown",
      ...(fields.path !== undefined && { path: fields.path }),
      ...(fields.reason !== undefined && { reason: fields.reason }),
    },
    `sec ${event}`,
  );
}
